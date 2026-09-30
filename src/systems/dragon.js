// The dragon: trains it when the aura a level leads to repays the buildings it sacrifices within
// the time the run is expected to last, and pets it for the drops it does not have yet.
//
// Auras are chosen by the gods system (src/systems/gods.js), which picks the one that adds the
// most income; each level is valued here the same way, by measuring every aura the level would
// make available against the game's own calculation and the income model. Training and petting
// go through the dragon menu, as a player does it.
import { simulateEach } from '../core/sim.js';
import { estimateIncome } from '../core/income.js';
import { readState } from '../game/measure.js';
import { privateGenerator } from '../game/fate.js';
import { AURA_GAIN } from '../core/gods.js';
import { FULLY_TRAINED, SECOND_SLOT, DROPS, trainableChain, chooseTarget, horizonSeconds, magicCap, shuffleWith, dropFor, shouldPet } from '../core/dragon.js';

const TICK_EVERY = 30; // frames: a second, as often as a player could reasonably click
const DECIDE_EVERY = 30 * 30; // a level found not worth training is looked at again after 30 s
const BUFF_WAIT_SECONDS = 10 * 60; // a short income buff is let finish before a sacrifice
const REALITY_BENDING = 18; // a tenth of every aura learned, so its worth depends on the level (main.js:14877)
const LAST_AURA = 21;
const DRAGON_COOKIE_LEVEL = 26; // level 25's sacrifice unlocks the Dragon cookie (main.js:14816)

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings  autoDragon, petDragon, and the casting settings the mana rule reads
 * @param {object} deps.loop
 * @param {() => number} [deps.reserve]  cookies the buyer is holding
 * @param {{invalidate(): void}} [deps.buyer]
 * @param {(what: string) => void} [deps.log]
 */
export function createDragon({ game, settings, loop, reserve = () => 0, buyer = null, log = () => {} }) {
    // 'measured' is the rule this system is built on; 'eager' (train whatever the game's own cost
    // check allows, the inherited rule, fc_gods.js:562-589 before this system) is kept so the two
    // can be compared in the harness.
    const options = { rule: 'measured' };
    const state = { levelsGained: 0, decision: null, nextDecisionAt: 0, pets: 0, last: null, order: null, orderSeed: null };
    const listeners = [];

    const income = () => estimateIncome(readState(game, settings)).total;
    const runSeconds = () => Math.max(0, (Date.now() - game.startDate) / 1000);

    // --- Measuring auras ----------------------------------------------------------------------

    /**
     * Income with the dragon at each configuration: { level, auras: [first, second], cookie }.
     * The dragon's fields are not in the what-if snapshot, so they are put back after every trial,
     * before the snapshot restore recalculates. Golden cookies on screen are set aside, as the gods
     * system does: each multiplies CpS under Dragon's Fortune only while it is there
     * (main.js:5108-5110), which is next to never with golden cookies clicked on sight.
     */
    function incomes(configs) {
        const golden = game.shimmerTypes.golden;
        const cookie = game.Upgrades['Dragon cookie'];
        const saved = [game.dragonLevel, game.dragonAura, game.dragonAura2, golden.n];
        const restore = () => {
            [game.dragonLevel, game.dragonAura, game.dragonAura2, golden.n] = saved;
        };
        const trials = configs.map((c) => ({
            apply() {
                game.dragonLevel = c.level;
                game.dragonAura = c.auras[0];
                game.dragonAura2 = c.auras[1];
                golden.n = 0;
                if (c.cookie && cookie && !cookie.bought) {
                    cookie.bought = 1;
                    game.UpgradesOwned++;
                }
            },
        }));
        try {
            return simulateEach(game, trials, () => {
                try {
                    return income();
                } finally {
                    restore();
                }
            });
        } finally {
            restore();
        }
    }

    const learnedBy = (level) => {
        const out = [];
        for (let id = 1; id <= LAST_AURA && id + 4 <= level; id++) out.push(id);
        return out;
    };

    /**
     * The best income the gods system could reach with the dragon at each level from `level` to
     * `top`, and the auras that reach it: out[i] is for level + i. One aura is measured at a time;
     * at level 27 the second slot is filled given the best first aura.
     */
    function bestByLevel(level, top) {
        const singles = [0].concat(learnedBy(top).filter((id) => id !== REALITY_BENDING));
        const bending = [];
        for (let t = Math.max(level, REALITY_BENDING + 4); t <= top; t++) bending.push(t);
        const values = incomes(
            singles.map((id) => ({ level: top, auras: [id, 0] })).concat(bending.map((t) => ({ level: t, auras: [REALITY_BENDING, 0] })))
        );
        const single = new Map(singles.map((id, i) => [id, values[i]]));
        const bendingAt = new Map(bending.map((t, i) => [t, values[singles.length + i]]));
        const bestSingle = (t) => {
            let best = { id: 0, income: single.get(0) };
            for (const id of singles) if (id + 4 <= t && single.get(id) > best.income) best = { id, income: single.get(id) };
            if (bendingAt.has(t) && bendingAt.get(t) > best.income) best = { id: REALITY_BENDING, income: bendingAt.get(t) };
            return best;
        };

        const out = [];
        for (let t = level; t <= top; t++) {
            const b = bestSingle(t);
            out.push({ income: b.income, auras: [b.id, 0] });
        }
        // From level 26 the Dragon cookie is there to buy (+5%, main.js:10673): measured with it.
        const late = [];
        for (let t = Math.max(level, DRAGON_COOKIE_LEVEL); t <= Math.min(top, SECOND_SLOT - 1); t++) late.push({ t, config: { level: t, auras: [bestSingle(t).id, 0], cookie: true } });
        if (top >= SECOND_SLOT) {
            const first = bestSingle(SECOND_SLOT).id;
            for (const id of [0].concat(learnedBy(SECOND_SLOT))) {
                if (id !== first) late.push({ t: SECOND_SLOT, config: { level: SECOND_SLOT, auras: [first, id], cookie: true } });
            }
        }
        if (late.length) {
            const lateValues = incomes(late.map((x) => x.config));
            for (let t = Math.max(level, DRAGON_COOKIE_LEVEL); t <= top; t++) {
                let best = null;
                late.forEach((x, i) => {
                    if (x.t === t && (!best || lateValues[i] > best.income)) best = { income: lateValues[i], auras: x.config.auras };
                });
                if (best) out[t - level] = best;
            }
        }
        return out;
    }

    // --- Training -----------------------------------------------------------------------------

    // The grimoire's mana cap follows the tower count (minigameGrimoire.js:263-287, recomputed
    // every 5 frames at :485), so a level that sacrifices Wizard towers clamps away whatever mana
    // is above the cap it leaves. While the mod casts, that mana is being saved for a cast; the
    // level waits until the grimoire has spent it.
    const modCasts = () => settings.autoFate == 1 || Number(settings.autoCasting) > 0 || settings.autoFTHOFCombo == 1 || settings.auto100ConsistencyCombo == 1;
    function manaRule() {
        const tower = game.Objects['Wizard tower'];
        const grimoire = tower.minigame;
        if (!grimoire || !grimoire.spells || !modCasts()) return () => true;
        let magic = grimoire.magic;
        return (level, after, taken) => {
            if (!taken[tower.id]) return true;
            const cap = magicCap(after[tower.id], tower.level);
            if (magic > cap) return false;
            magic = Math.min(magic, cap);
            return true;
        };
    }

    function chain() {
        const buildings = game.ObjectsById.map((b) => ({ basePrice: b.basePrice, amount: b.amount, free: b.free || 0, modifier: game.modifyBuildingPrice(b, 1) }));
        return trainableChain({
            level: game.dragonLevel,
            buildings,
            spendable: game.cookies - (reserve() || 0),
            allowed: manaRule(),
            priceIncrease: game.priceIncrease,
        });
    }

    function highestPrice() {
        let top = null;
        for (const b of game.ObjectsById) if (b.amount > 0) top = b;
        return top ? top.getPrice() : 0;
    }

    function decide(steps) {
        const level = game.dragonLevel;
        const best = bestByLevel(level, level + steps.length);
        // Every aura slot whose best aura changes costs the gods system a switch: one of the
        // highest building (main.js:14900-14909), and is made only for more than AURA_GAIN.
        const switchPrice = highestPrice();
        const switches = best.map((b) => [0, 1].filter((s) => b.auras[s] !== best[0].auras[s]).length);
        const switchCost = switches.map((n) => n * switchPrice);
        const horizon = horizonSeconds(runSeconds());
        const choice = chooseTarget({ level, steps, income: best.map((b) => b.income), horizon, switchCost, switches, minSwitchGain: AURA_GAIN });
        return { ...choice, level, horizon, auras: choice.target ? best[choice.target - level].auras.map((a) => game.dragonAuras[a].name) : null };
    }

    /** A short buff that raises income: a sacrifice now would forfeit part of it. */
    function incomeBuffRunning() {
        for (const buff of Object.values(game.buffs)) {
            const raises = (buff.multCpS || 1) > 1 || (buff.multClick || 1) > 1;
            if (raises && buff.time <= BUFF_WAIT_SECONDS * game.fps) return true;
        }
        return false;
    }

    // The inherited rule's own pause (fc_main.js hasClickBuff).
    function clickBuffRunning() {
        if (game.hasBuff('Cursed finger')) return true;
        let mult = 1;
        for (const buff of Object.values(game.buffs)) if (buff.multClick) mult *= buff.multClick;
        return mult > 1;
    }

    /** Opens the dragon menu for `act`, then leaves the menus as the player had them. */
    function inDragonMenu(act) {
        const had = game.specialTab;
        game.specialTab = 'dragon';
        try {
            act();
        } finally {
            if (had !== 'dragon') {
                if (had) {
                    game.specialTab = had;
                    game.ToggleSpecialMenu(1);
                } else game.ToggleSpecialMenu(0);
            }
        }
    }

    /** The crumbly egg is a store upgrade the buyer never values (it adds no income); bought here. */
    function haveEgg(eager) {
        const egg = game.Upgrades['A crumbly egg'];
        if (!egg || egg.bought) return !!egg;
        if (!egg.unlocked) return false;
        if (eager || game.cookies - egg.getPrice() >= (reserve() || 0)) egg.buy();
        return !!egg.bought;
    }

    function train(why) {
        const before = game.dragonLevel;
        inDragonMenu(() => game.UpgradeDragon());
        if (game.dragonLevel <= before) return;
        state.levelsGained++;
        const level = game.dragonLevel;
        let learned = game.dragonLevels[level].name; // the egg's stages teach nothing
        if (level >= 5 && level <= 25) learned = game.dragonAuras[level - 4].name;
        else if (level === DRAGON_COOKIE_LEVEL) learned = 'the Dragon cookie';
        else if (level === SECOND_SLOT) learned = 'the second aura slot';
        state.last = { level, learned, why };
        log(`dragon: trained to level ${level}, ${learned}${why ? `: ${why}` : ''}`);
        if (buyer) buyer.invalidate();
        for (const listener of listeners) {
            try {
                listener(level);
            } catch (error) {
                log(`dragon: a level listener failed: ${error.message}`);
            }
        }
    }

    function trainTick(frame) {
        const eager = options.rule === 'eager';
        if (!haveEgg(eager)) return;
        const level = game.dragonLevel;
        if (level >= FULLY_TRAINED || !game.dragonLevels[level].cost()) return;
        if (eager) {
            if (!clickBuffRunning()) train('affordable');
            return;
        }
        if (incomeBuffRunning() || frame < state.nextDecisionAt) return;
        const steps = chain();
        if (!steps.length) return; // the egg's price is held by the buyer, or the grimoire's mana is
        const decision = decide(steps);
        state.decision = decision;
        if (!decision.train) {
            state.nextDecisionAt = frame + DECIDE_EVERY;
            return;
        }
        train(`toward level ${decision.target} (${decision.auras.filter((a) => a !== 'No aura').join(' + ') || 'no aura'}), repaid in ${Math.round(decision.payback)} s`);
    }

    // --- Petting ------------------------------------------------------------------------------

    /**
     * The drop a pet gives in this minute of the hour. The game shuffles the list with its seed
     * (main.js:14959-14962); the same shuffle runs here on a private generator, so the game's own
     * is never reseeded. The seed changes at each ascension.
     */
    function forecast(minutes) {
        if (state.orderSeed !== game.seed) {
            state.order = shuffleWith(DROPS, privateGenerator(game.seed + '/dragonTime'));
            state.orderSeed = game.seed;
        }
        return dropFor(state.order, minutes);
    }

    function petTick() {
        const egg = game.Upgrades['A crumbly egg'];
        if (!egg || !egg.bought) return;
        const drop = forecast(new Date().getMinutes());
        const owned = game.Has(drop) || game.HasUnlocked(drop);
        if (!shouldPet({ level: game.dragonLevel, petUpgrade: game.Has('Pet the dragon'), drop, owned })) return;
        // The picture exists only while the menu is open (main.js:14983).
        inDragonMenu(() => {
            game.ToggleSpecialMenu(1);
            game.ClickSpecialPic();
        });
        state.pets++;
    }

    const busy = () => game.OnAscend || game.AscendTimer;
    loop.add('dragon', (frame) => !busy() && trainTick(frame), { everyFrames: TICK_EVERY, enabled: () => settings.autoDragon == 1 });
    loop.add('dragon-pet', () => !busy() && petTick(), { everyFrames: TICK_EVERY, enabled: () => settings.petDragon == 1 });

    return {
        options,
        /** How many levels this system has trained: the gods system re-picks auras when it moves. */
        levelsGained: () => state.levelsGained,
        /** Calls `listener(level)` each time this system trains a level. */
        onLevelGained(listener) {
            listeners.push(listener);
        },
        forecast,
        /** What training would do now, without doing it: for the console and the tests. */
        plan() {
            const steps = game.dragonLevel < FULLY_TRAINED ? chain() : [];
            return { steps, decision: steps.length ? decide(steps) : null };
        },
        report() {
            return { level: game.dragonLevel, levelsGained: state.levelsGained, decision: state.decision, last: state.last, pets: state.pets, rule: options.rule };
        },
    };
}
