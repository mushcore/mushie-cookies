// Heavenly upgrades and permanent slots. Watches each run for the moment the buyer buys every
// upgrade, measured in cookies baked, because that is what a permanent slot saves the next run:
// the income lost until the upgrade is bought again. The ascension system asks it for the plan
// and the slot ranking at the moment it ascends, while the bakery still stands.
import { planHeavenly, rankPermanentSlots } from '../game/prestige.js';

const TICK_EVERY = 30; // frames

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings  the mod's settings (autoAscendToggle)
 * @param {object} deps.loop
 */
export function createHeavenly({ game, settings, loop }) {
    const state = {
        run: null,
        // This run: upgrade id -> cookies baked when first seen bought; null when it was owned
        // before the run could be watched (a permanent slot, or the mod starting mid-run).
        seen: new Map(),
        // Earlier runs: the latest record for each upgrade, for one a slot hands the run at its start.
        known: new Map(),
        owned: -1,
    };

    function trackRun() {
        const run = `${game.resets}/${game.startDate}`;
        if (state.run === run) return;
        for (const [id, cookies] of state.seen) if (cookies !== null) state.known.set(id, cookies);
        state.run = run;
        state.seen = new Map();
        state.owned = -1;
        for (const u of Object.values(game.UpgradesById)) if (u.bought) state.seen.set(u.id, null);
    }

    function tick() {
        // The ascension screen empties the bakery; the next run is watched from its start.
        if (game.OnAscend || game.AscendTimer) return;
        trackRun();
        // Only look through the upgrades when the count says one was bought.
        if (game.UpgradesOwned === state.owned) return;
        state.owned = game.UpgradesOwned;
        for (const u of Object.values(game.UpgradesById)) {
            if (u.bought && !state.seen.has(u.id)) state.seen.set(u.id, game.cookiesEarned);
        }
    }

    /** Upgrade id -> cookies baked in its run when the buyer bought it, this run first. */
    function reacquired() {
        const out = {};
        for (const [id, cookies] of state.known) out[id] = cookies;
        for (const [id, cookies] of state.seen) if (cookies !== null) out[id] = cookies;
        return out;
    }

    function rankSlots() {
        return rankPermanentSlots(game, settings, { reacquire: reacquired(), runCookies: game.cookiesEarned });
    }

    loop.add('heavenly', tick, { everyFrames: TICK_EVERY, enabled: () => settings.autoAscendToggle == 1 });

    return {
        reacquired,
        rankSlots,
        /** The heavenly plan for `chips` at `prestigeAfter`, with the slot ranking it values slots by. */
        plan(chips, prestigeAfter, { slotRanking = rankSlots(), runSeconds } = {}) {
            return planHeavenly(game, settings, chips, prestigeAfter, { slotRanking, runSeconds });
        },
    };
}
