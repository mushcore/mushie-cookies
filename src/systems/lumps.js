// Sugar lumps: harvests ripe lumps (a golden one timed by its payout), switches Sugar frenzy on
// near the end of a run, and spends lumps on building levels. The only thing that clicks the lump.
import { nextLevelUp, bestLevel, lumpWorth, decideHarvest, decideFrenzy, GOLDEN } from '../core/lumps.js';
import { readState } from '../game/measure.js';

const TICK_EVERY = 30; // frames
const SUGAR_FRENZY = 'Sugar frenzy';

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings  autoSL (harvest), sugarFrenzy, autoLumps (spend), sugarBakingGuard
 * @param {object} deps.loop
 * @param {{invalidate(): void, ranking(): Array}} [deps.buyer]  holds the bank a golden lump pays on
 * @param {() => ({instantRate: number, averageRate: number, rated: boolean} | null)} [deps.run]
 *        the ascension's growth verdict; null when nothing ends runs
 * @param {() => boolean} [deps.ascending]  the ascension has collected and is about to ascend
 * @param {() => number} [deps.goldenWait]  expected seconds to the next golden cookie
 * @param {(what: string) => void} [deps.log]
 */
export function createLumps({
    game,
    settings,
    loop,
    buyer = null,
    run = () => null,
    ascending = () => false,
    goldenWait = () => readState(game, settings).golden.meanInterval,
    log = () => {},
}) {
    const state = {
        last: null,
        spent: 0,
        harvests: 0,
        lastHarvest: null,
        hold: 0,
        frenzy: null,
        frenzyAt: null,
        settlingTicks: 0,
    };

    // The game shows the lump and the level buttons only outside Born again (main.js:3547, 4440,
    // 4600; style.css:1624, 2630-2631), and levels add nothing there (main.js:5058).
    const playable = () => game.canLumps() && !game.OnAscend && !game.AscendTimer && game.ascensionMode != 1;

    // Ownership, not Has(): Has() is false for heavenly upgrades in Born again mode.
    const sugarBakingOwned = () => !!(game.Upgrades['Sugar baking'] && game.Upgrades['Sugar baking'].bought);

    function buildingsNow() {
        const total = game.ObjectsById.reduce((sum, b) => sum + (b.storedTotalCps || 0), 0);
        return game.ObjectsById.map((b) => ({
            name: b.name,
            level: b.level,
            amount: b.amount,
            share: total > 0 ? (b.storedTotalCps || 0) / total : 0,
        }));
    }

    // The game asks the player to confirm spending lumps when that preference is on; this is the
    // player saying yes.
    function spendingLumps(act) {
        const ask = game.prefs.askLumps;
        game.prefs.askLumps = 0;
        try {
            act();
        } finally {
            game.prefs.askLumps = ask;
        }
    }

    function worthOfALump() {
        const best = bestLevel(buildingsNow());
        const age = Date.now() - game.lumpT;
        return lumpWorth({
            bestPerLump: best ? best.valuePerLump : 0,
            lumps: game.lumps,
            sugarBaking: sugarBakingOwned(),
            secondsToLump: Math.max(0, (game.lumpRipeAge - age) / 1000),
            lumpSeconds: game.lumpRipeAge / 1000,
        });
    }

    /** Seconds the buyer's best purchase takes to repay; Infinity when nothing would be bought. */
    function bestPayback() {
        if (!buyer || !settings.autoBuy) return Infinity;
        const best = buyer.ranking().find((c) => Number.isFinite(c.payback));
        return best ? best.purePayback : Infinity;
    }

    function setHold(amount) {
        const was = state.hold;
        state.hold = amount;
        // The buyer reads the hold when it ranks; a hold starting or ending forces a ranking.
        if ((was > 0) !== (amount > 0) && buyer) buyer.invalidate();
    }

    // The ascension collects wrinklers and stock, then ascends two of its ticks later; the popped
    // wrinklers pay on the frames between (systems/ascension.js SETTLE_TICKS). A golden lump is
    // collected on the second tick, on the biggest bank.
    function collecting() {
        if (!ascending()) {
            state.settlingTicks = 0;
            return false;
        }
        state.settlingTicks++;
        return state.settlingTicks >= 2;
    }

    function harvest() {
        const collectingNow = collecting();
        if (!playable()) return setHold(0);
        const age = Date.now() - game.lumpT;
        const golden = game.lumpCurrentType === GOLDEN;
        const decision = decideHarvest({
            age,
            matureAge: game.lumpMatureAge,
            ripeAge: game.lumpRipeAge,
            overripeAge: game.lumpOverripeAge,
            type: game.lumpCurrentType,
            bank: game.cookies,
            cps: game.cookiesPs,
            unbuffedCps: game.unbuffedCps,
            // Only a golden lump's timing reads these, and it is rare: they are not read otherwise.
            payback: golden ? bestPayback() : Infinity,
            lumpWorth: golden ? worthOfALump() : 0,
            goldenWait: golden && age >= game.lumpRipeAge ? goldenWait() : Infinity,
            ascending: collectingNow,
        });
        setHold(decision.hold);
        if (!decision.harvest) return;
        const started = game.lumpT;
        const lumps = game.lumps;
        game.clickLump();
        if (game.lumpT === started) return; // the harvest resets lumpT (main.js:4488)
        state.harvests++;
        state.lastHarvest = {
            at: Date.now(),
            golden,
            gained: game.lumps - lumps,
            secondsRipe: Math.round((age - game.lumpRipeAge) / 1000),
            reason: decision.reason,
        };
        log(`harvested a sugar lump (+${state.lastHarvest.gained}): ${decision.reason}`);
    }

    function frenzy() {
        if (!playable()) return;
        const upgrade = game.Upgrades[SUGAR_FRENZY];
        // Sugar craving unlocks it (main.js:16349); bought marks it used for this ascension. Two
        // lumps, not one: the game takes the lump before its own purchase checks for one, so with
        // a single lump the buff comes but the upgrade is not marked used (main.js:11039-11043).
        const available = !!upgrade && !!upgrade.unlocked && !upgrade.bought && game.lumps >= 2;
        if (!available) {
            state.frenzy = null;
            return;
        }
        const decision = decideFrenzy({
            available,
            buffs: Object.values(game.buffs).map((b) => ({ multCpS: b.multCpS, secondsLeft: b.time / game.fps })),
            worth: worthOfALump(),
            run: run(),
            ascending: ascending(),
        });
        state.frenzy = decision;
        if (!decision.activate) return;
        spendingLumps(() => upgrade.buy());
        if (!upgrade.bought) return;
        state.frenzyAt = Date.now();
        log(`switched Sugar frenzy on for a lump: ${decision.reason}`);
    }

    function spend() {
        if (!playable()) return;
        const choice = nextLevelUp({
            buildings: buildingsNow(),
            lumps: game.lumps,
            sugarBaking: sugarBakingOwned(),
            guard: settings.sugarBakingGuard == 1,
        });
        if (!choice) return;
        const building = game.Objects[choice.name];
        const before = building.level;
        spendingLumps(() => building.levelUp());
        if (building.level > before) {
            state.spent += choice.cost;
            state.last = { ...choice, level: building.level };
            log(`levelled ${choice.name} to ${building.level} for ${choice.cost} lumps: ${choice.reason}`);
        }
    }

    // Harvest first, so a lump just harvested can be spent; the frenzy before levels, so the lump it
    // needs is not spent from under it. The inherited Sugar frenzy option (tied to the inherited
    // combos) keeps the frenzy while a player has it on.
    loop.add('lumpHarvest', harvest, { everyFrames: TICK_EVERY, enabled: () => settings.autoSL == 1 });
    loop.add('sugarFrenzy', frenzy, { everyFrames: TICK_EVERY, enabled: () => settings.sugarFrenzy == 1 && !Number(settings.autoSugarFrenzy) });
    loop.add('lumps', spend, { everyFrames: TICK_EVERY, enabled: () => settings.autoLumps == 1 });

    return {
        /** Bank the buyer should keep for a golden lump's payout; 0 for none. */
        hold() {
            return settings.autoSL == 1 ? state.hold : 0;
        },
        report() {
            return {
                lumps: game.lumps,
                last: state.last,
                spent: state.spent,
                harvests: state.harvests,
                lastHarvest: state.lastHarvest,
                hold: this.hold(),
                frenzy: state.frenzy,
                frenzyAt: state.frenzyAt,
            };
        },
    };
}
