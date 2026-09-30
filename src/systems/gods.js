// Pantheon gods and dragon auras, chosen by what they add to income.
//
// Each candidate move is measured with a what-if against the game's own calculation and the
// income model, which already reflects the gods' and auras' effects on CpS, milk, clicks and
// golden cookie timing. A move is made the way a player makes it (dragging a god, confirming an
// aura), and only when it is clearly worth what it costs: a swap, or a building sacrificed.
import { simulate } from '../core/sim.js';
import { estimateIncome } from '../core/income.js';
import { readState } from '../game/measure.js';

const TICK_EVERY = 30 * 60 * 5; // five minutes of frames
const GOD_GAIN = 0.01; // a swap must add at least 1% of income
const AURA_GAIN = 0.02;


// Gods whose worth the income model cannot see, or that would work against the mod:
// Holobore unslots itself (and empties the swaps) when a golden cookie is clicked; Godzamok pays
// only when buildings are sold; Cyclius follows the clock, which would have the mod chase it;
// Rigidel affects only sugar lump timing. These are the keys of the Pantheon's `gods` table; the
// gods themselves carry no key (minigamePantheon.js:12, 123).
const SKIP_GODS = new Set(['asceticism', 'ruin', 'ages', 'order']);
// Auras whose effect is not income: selling, discounts, drops, minigames, lumps, orbs.
const SKIP_AURAS = new Set(['Earth Shatterer', 'Master of the Armory', 'Fierce Hoarder', 'Mind Over Matter', "Dragon's Curve", 'Supreme Intellect', 'Dragon Orbs']);

export function createGods({ game, settings, loop, buyer = null, log = () => {} }) {
    const invalidate = () => buyer && buyer.invalidate();
    const state = { swaps: 0, auraChanges: 0, last: null };
    const income = () => estimateIncome(readState(game, settings)).total;

    // --- Pantheon -----------------------------------------------------------------------------
    function measureGodMove(M, god, slot) {
        const before = { slot: M.slot.slice(), gods: M.godsById.map((g) => g.slot) };
        return simulate(game, {
            apply: () => M.slotGod(god, slot),
            measure: income,
            revert() {
                M.slot = before.slot;
                M.godsById.forEach((g, i) => {
                    g.slot = before.gods[i];
                });
            },
        });
    }

    function dragGod(M, god, slot) {
        M.dragGod(god);
        M.slotHovered = slot;
        M.dropGod();
        M.slotHovered = -1;
    }

    function pantheon() {
        const M = game.Objects['Temple'].minigame;
        if (!M || !M.godsById || M.swaps < 1) return;
        const now = income();
        let best = null;
        for (const key of Object.keys(M.gods)) {
            if (SKIP_GODS.has(key)) continue;
            const god = M.gods[key];
            for (let slot = 0; slot < 3; slot++) {
                if (god.slot === slot) continue;
                const after = measureGodMove(M, god, slot);
                const gain = (after - now) / now;
                if (gain > GOD_GAIN && (!best || gain > best.gain)) best = { god, slot, gain };
            }
        }
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

    // Switching costs one of the highest-tier buildings (main.js:14900-14909). Its price is not
    // the cost: the buyer rebuys it only if that is worth it. The cost is that building's output,
    // so the what-if removes it along with switching the aura and the gain is net of it.
    function measureAura(slot, aura) {
        const before = [game.dragonAura, game.dragonAura2];
        const sacrificed = highestBuilding();
        return simulate(game, {
            apply() {
                if (slot === 0) game.dragonAura = aura;
                else game.dragonAura2 = aura;
                if (sacrificed) {
                    sacrificed.amount -= 1;
                    game.BuildingsOwned -= 1;
                }
            },
            measure: income,
            revert() {
                [game.dragonAura, game.dragonAura2] = before;
            },
        });
    }

    function auras() {
        if (!game.dragonAuras || game.dragonLevel < 5) return;
        const slots = game.dragonLevel >= 27 ? [0, 1] : [0];
        const now = income();
        let best = null;
        for (const slot of slots) {
            const other = slot === 0 ? game.dragonAura2 : game.dragonAura;
            for (const [key, aura] of Object.entries(game.dragonAuras)) {
                const id = Number(key);
                if (id === 0 || game.dragonLevel < id + 4 || id === other || SKIP_AURAS.has(aura.name)) continue;
                if (id === (slot === 0 ? game.dragonAura : game.dragonAura2)) continue;
                const gain = (measureAura(slot, id) - now) / now;
                if (gain > AURA_GAIN && (!best || gain > best.gain)) best = { slot, id, gain, name: aura.name };
            }
        }
        if (!best) return;
        game.SetDragonAura(best.id, best.slot);
        game.ConfirmPrompt();
        if ((best.slot === 0 ? game.dragonAura : game.dragonAura2) === best.id) {
            state.auraChanges++;
            invalidate();
            state.last = `switched to ${best.name} (+${(best.gain * 100).toFixed(1)}%)`;
            log(`dragon: ${state.last}`);
        }
    }

    // Inherited settings that slot gods or pick auras on their own; running both would fight.
    const inheritedGods = () => settings.autoWorshipToggle == 1 || settings.autoCyclius == 1;
    const inheritedAuras = () => settings.autoDragonToggle == 1;

    loop.add(
        'gods',
        () => {
            if (game.OnAscend) return;
            if (!inheritedGods()) pantheon();
            if (!inheritedAuras()) auras();
        },
        { everyFrames: TICK_EVERY, enabled: () => settings.autoGods == 1 }
    );

    return {
        report() {
            return { swaps: state.swaps, auraChanges: state.auraChanges, last: state.last };
        },
    };
}
