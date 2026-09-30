// Pantheon gods and dragon auras, chosen by what they add to income.
//
// Each candidate move is measured with a what-if against the game's own calculation and the
// income model, which already reflects the gods' and auras' effects on CpS, milk, clicks and
// golden cookie timing. A move is made the way a player makes it (dragging a god, confirming an
// aura), and only when it is clearly worth what it costs: a swap, or a building sacrificed.
import { simulate } from '../core/sim.js';
import { estimateIncome } from '../core/income.js';
import { chooseAura, inheritedGodsOn, inheritedAurasOn, lindyHorizon, auraHorizon, RETURN_BLOCK_SECONDS } from '../core/gods.js';
import { readState } from '../game/measure.js';

const DECIDE_EVERY = 30 * 60 * 5; // five minutes of frames between decisions
const TICK_EVERY = 30; // frames between checks for a due decision
const GOD_GAIN = 0.01; // a swap must add at least 1% of income

// Gods whose worth the income model cannot see, or that would work against the mod:
// Holobore unslots itself (and empties the swaps) when a golden cookie is clicked; Godzamok pays
// only when buildings are sold; Cyclius follows the clock, which would have the mod chase it;
// Rigidel affects only sugar lump timing. These are the keys of the Pantheon's `gods` table; the
// gods themselves carry no key (minigamePantheon.js:12, 123).
const SKIP_GODS = new Set(['asceticism', 'ruin', 'ages', 'order']);
// Auras whose effect is not income: selling, discounts, drops, minigames, lumps, orbs. They are
// never chosen, and one already in place was chosen by the player, so it is never replaced.
const SKIP_AURAS = new Set(['Earth Shatterer', 'Master of the Armory', 'Fierce Hoarder', 'Mind Over Matter', "Dragon's Curve", 'Supreme Intellect', 'Dragon Orbs']);

export function createGods({ game, settings, loop, buyer = null, log = () => {} }) {
    // See chooseAura in src/core/gods.js.
    //  - auraHorizon: an aura switch must repay the building it sacrifices within this many
    //    seconds of the income it adds: a number, or a function of the run's age in seconds.
    //    By default, as long as the run has lasted, and at least an hour.
    //  - returnBlockSeconds: how long after a switch the aura it left is not taken back.
    const options = { auraHorizon: lindyHorizon, returnBlockSeconds: RETURN_BLOCK_SECONDS };
    const runSeconds = () => Math.max(0, (Date.now() - game.startDate) / 1000);
    const invalidate = () => buyer && buyer.invalidate();
    const state = { swaps: 0, auraChanges: 0, last: null, dueAt: DECIDE_EVERY, recent: {} };
    const income = () => estimateIncome(readState(game, settings)).total;

    // Every what-if measures the bakery as it is between golden cookies and buffs, so that a
    // move is judged by what it adds for as long as it stays, not for the seconds or hours a
    // passing effect lasts:
    //  - no golden cookie on screen. Each one on screen multiplies CpS by 1 + 1.23 × Dragon's
    //    Fortune (main.js:5108-5110) for the seconds it is there, which is next to none with
    //    golden cookies clicked as they appear (the income model assumes as much,
    //    src/game/measure.js:105). Counted, it made Dragon's Fortune look worth a building
    //    whenever a golden cookie happened to be on screen, and not worth one once it was gone;
    //  - no buff or debuff. The mouse upgrades add a share of the buffed CpS to click power
    //    (main.js:4692-4708), which the model cannot divide out, so under a Frenzy or a loan
    //    (x1.5 for two hours, x1.2 for two days: minigameMarket.js:350-352, 376) Muridal and
    //    Dragon Cursor looked better than they are. The game empties its buffs the same way,
    //    by replacing the table (main.js:13828).
    // Measured this way, a decision need not wait for any of them to end.
    function whatIf(apply, revert, measure = income) {
        const golden = game.shimmerTypes.golden;
        const onScreen = golden.n;
        const buffs = game.buffs;
        return simulate(game, {
            apply() {
                golden.n = 0;
                game.buffs = {};
                apply();
            },
            measure,
            revert() {
                try {
                    revert();
                } finally {
                    golden.n = onScreen;
                    game.buffs = buffs;
                }
            },
        });
    }
    const incomeNow = () => whatIf(() => {}, () => {});

    // --- Pantheon -----------------------------------------------------------------------------
    function measureGodMove(M, god, slot) {
        const before = { slot: M.slot.slice(), gods: M.godsById.map((g) => g.slot) };
        return whatIf(
            () => M.slotGod(god, slot),
            () => {
                M.slot = before.slot;
                M.godsById.forEach((g, i) => {
                    g.slot = before.gods[i];
                });
            }
        );
    }

    function dragGod(M, god, slot) {
        M.dragGod(god);
        M.slotHovered = slot;
        M.dropGod();
        M.slotHovered = -1;
    }

    function godMoves(M) {
        const now = incomeNow();
        const moves = [];
        for (const key of Object.keys(M.gods)) {
            if (SKIP_GODS.has(key)) continue;
            const god = M.gods[key];
            for (let slot = 0; slot < 3; slot++) {
                if (god.slot === slot) continue;
                const after = measureGodMove(M, god, slot);
                moves.push({ god, key, slot, gain: (after - now) / now });
            }
        }
        return moves;
    }

    function pantheon() {
        const M = game.Objects['Temple'].minigame;
        if (!M || !M.gods || M.swaps < 1) return;
        let best = null;
        for (const move of godMoves(M)) if (move.gain > GOD_GAIN && (!best || move.gain > best.gain)) best = move;
        if (!best) return;
        dragGod(M, best.god, best.slot);
        if (M.slot[best.slot] === best.god.id) {
            state.swaps++;
            invalidate();
            state.last = `slotted ${best.god.name} in the ${['diamond', 'ruby', 'jade'][best.slot]} slot (+${(best.gain * 100).toFixed(1)}%)`;
            log(`gods: ${state.last}`);
        }
    }

    // --- Dragon auras -------------------------------------------------------------------------
    function highestBuilding() {
        let top = null;
        for (const b of game.ObjectsById) if (b.amount > 0) top = b;
        return top;
    }

    // Switching costs one of the highest-tier buildings (main.js:14900-14909). Each switch is
    // measured twice: with every building (what it adds once the building is rebought), and with
    // that building gone too (what it adds until then), along with the price to rebuy it.
    function measureAura(slot, aura) {
        const before = [game.dragonAura, game.dragonAura2];
        const setAura = () => {
            if (slot === 0) game.dragonAura = aura;
            else game.dragonAura2 = aura;
        };
        const revert = () => {
            [game.dragonAura, game.dragonAura2] = before;
        };
        const gross = whatIf(setAura, revert);
        const sacrificed = highestBuilding();
        if (!sacrificed) return { gross, net: gross, rebuy: 0 };
        const after = whatIf(
            () => {
                setAura();
                sacrificed.amount -= 1;
                game.BuildingsOwned -= 1;
            },
            revert,
            () => ({ net: income(), rebuy: sacrificed.getPrice() })
        );
        return { gross, net: after.net, rebuy: after.rebuy };
    }

    function measureAuras() {
        if (!game.dragonAuras || game.dragonLevel < 5) return { now: 0, moves: [] };
        const slots = game.dragonLevel >= 27 ? [0, 1] : [0];
        const now = incomeNow();
        const moves = [];
        for (const slot of slots) {
            const current = slot === 0 ? game.dragonAura : game.dragonAura2;
            const other = slot === 0 ? game.dragonAura2 : game.dragonAura;
            if (SKIP_AURAS.has(game.dragonAuras[current].name)) continue;
            for (const [key, aura] of Object.entries(game.dragonAuras)) {
                const id = Number(key);
                if (id === 0 || id === current || id === other || game.dragonLevel < id + 4 || SKIP_AURAS.has(aura.name)) continue;
                const m = measureAura(slot, id);
                moves.push({ slot, id, name: aura.name, ...m, gain: (m.net - now) / now, payback: m.rebuy / (m.gross - now) });
            }
        }
        return { now, moves };
    }

    function auras(frame) {
        const t = frame / game.fps;
        const { now, moves } = measureAuras();
        const best = chooseAura({
            now,
            moves,
            horizonSeconds: auraHorizon(options.auraHorizon, runSeconds()),
            returnBlockSeconds: options.returnBlockSeconds,
            t,
            recent: state.recent,
        });
        if (!best) return;
        const left = best.slot === 0 ? game.dragonAura : game.dragonAura2;
        game.SetDragonAura(best.id, best.slot);
        game.ConfirmPrompt();
        if ((best.slot === 0 ? game.dragonAura : game.dragonAura2) === best.id) {
            state.recent[best.slot] = { left, at: t };
            state.auraChanges++;
            invalidate();
            state.last = `switched to ${best.name} (+${(best.gain * 100).toFixed(1)}%)`;
            log(`dragon: ${state.last}`);
        }
    }

    loop.add(
        'gods',
        (frame) => {
            if (game.OnAscend || frame < state.dueAt) return;
            state.dueAt = frame + DECIDE_EVERY;
            // Inherited options that slot gods or pick auras on their own, or run combos around
            // them, would fight this system; while one is on, it stands aside.
            if (!inheritedGodsOn(settings)) pantheon();
            if (!inheritedAurasOn(settings)) auras(frame);
        },
        { everyFrames: TICK_EVERY, enabled: () => settings.autoGods == 1 }
    );

    return {
        options,
        /** Every move measured now, without making any: for the console and the tests. */
        plan() {
            const M = game.Objects['Temple'].minigame;
            const gods = M && M.gods ? godMoves(M).map((m) => ({ god: m.key, slot: m.slot, gain: m.gain })) : [];
            return { gods, auras: measureAuras().moves };
        },
        report() {
            return { swaps: state.swaps, auraChanges: state.auraChanges, last: state.last };
        },
    };
}
