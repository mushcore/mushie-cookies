// The buyer: ranks everything for sale by the income it adds, keeps a reserve for golden
// cookies when that pays, and buys. Runs on the loop; reads settings live.
import { estimateIncome } from '../core/income.js';
import { rankCandidates, chooseReserve, decide } from '../core/buyer.js';
import { readState, measureCandidates } from '../game/measure.js';
import { listCandidates } from '../game/candidates.js';

const RERANK_FRAMES = 150; // five seconds
const PURCHASES_PER_TICK = 2; // each purchase re-ranks; two keep a tick well inside a frame
const BULK_WHEN_BANK_EXCEEDS = 100; // times the price: then ten at once is safe

/** Upgrades whose worth the income model cannot see; bought when they cost under a minute of income. */
const ENABLERS = new Set([
    'Faberge egg', 'Omelette', '"egg"', 'Weighted sleighs', "Santa's bottomless bag", 'Dragon fang',
    'Dragon teddy bear', 'Sacrificial rolling pins', 'Green yeast digestives', 'Fern tea', 'Ichor syrup', 'Fortune #102',
]);

/**
 * @param {object} deps
 * @param {object} deps.game        the Game object
 * @param {object} deps.settings    the mod's settings object (autoBuy, autoClick, cookieClickSpeed, ...)
 * @param {() => object} deps.policy  builds the candidate policy from the settings
 * @param {object} deps.loop        the mod's loop
 * @param {() => number} [deps.extraReserve]  bank the settings ask to hold beyond the golden cookie reserve
 * @param {(what: string) => void} [deps.log]
 */
export function createBuyer({ game, settings, policy, loop, extraReserve = () => 0, log = () => {} }) {
    const options = { holdReserve: true };
    const state = {
        ranked: [],
        income: null,
        reserve: 0,
        rankedAt: -Infinity,
        stamp: '',
        last: null, // the last decision, for the menu
        purchases: 0,
    };

    // Anything here changing means the ranking may be wrong.
    const stampOf = () =>
        [
            game.UpgradesInStore.length,
            Object.keys(game.buffs).join(','),
            game.elderWrath,
            game.AchievementsOwned,
            game.BuildingsOwned,
            game.UpgradesOwned,
            game.season,
        ].join('|');

    function rank(frame) {
        const candidates = listCandidates(game, policy());
        const now = readState(game, settings);
        const income = estimateIncome(now);
        const measured = measureCandidates(game, settings, candidates).map(estimateIncome);
        const ranked = rankCandidates({ candidates, measured, income, bank: game.cookies });
        const best = ranked.find((c) => Number.isFinite(c.payback)) || null;
        // A reserve is valued against an empty bank: what it adds is what spending it would lose.
        const empty = estimateIncome({ ...now, bank: 0 });
        const reserves = [6000 * now.cps].map((amount) => ({
            amount,
            incomeAt: estimateIncome({ ...now, bank: amount }).total,
        }));
        const held = options.holdReserve ? chooseReserve({ best, reserves, income: empty }) : 0;
        state.reserve = Math.max(held, extraReserve() || 0);
        state.ranked = ranked;
        state.income = income;
        state.rankedAt = frame;
        state.stamp = stampOf();
    }

    function refreshIfStale(frame) {
        if (!state.income || frame - state.rankedAt >= RERANK_FRAMES || state.stamp !== stampOf()) rank(frame);
    }

    function buy(candidate) {
        const before = game.cookies;
        if (candidate.kind === 'building') {
            const bulk = game.cookies > BULK_WHEN_BANK_EXCEEDS * candidate.price ? 10 : 1;
            buyBuilding(candidate.building, bulk);
        } else if (candidate.kind === 'upgrade') {
            candidate.upgrade.buy();
        } else if (candidate.kind === 'chain') {
            buyBuilding(candidate.building, candidate.steps);
            if (candidate.upgrade.unlocked && !candidate.upgrade.bought) candidate.upgrade.buy();
        }
        const spent = before - game.cookies;
        if (spent > 0) {
            state.purchases++;
            log(`bought ${candidate.name} for ${game.cookies < 1e21 ? Math.round(spent).toLocaleString() : spent.toExponential(2)}`);
        }
        return spent > 0;
    }

    // The game's buy() sells when the store is in sell mode; buying must not depend on the mode.
    function buyBuilding(building, amount) {
        const mode = game.buyMode;
        game.buyMode = 1;
        try {
            building.buy(amount);
        } finally {
            game.buyMode = mode;
        }
    }

    function enablers() {
        if (!state.income) return;
        const minute = state.income.total * 60;
        for (const upgrade of game.UpgradesInStore) {
            if (!ENABLERS.has(upgrade.name) || upgrade.bought) continue;
            const price = upgrade.getPrice();
            if (price <= minute && game.cookies - price >= state.reserve) {
                upgrade.buy();
                log(`bought ${upgrade.name} (enabler)`);
            }
        }
    }

    function tick(frame) {
        refreshIfStale(frame);
        for (let i = 0; i < PURCHASES_PER_TICK; i++) {
            const choice = decide({ ranked: state.ranked, reserve: state.reserve, bank: game.cookies });
            state.last = { choice, reserve: state.reserve };
            if (!choice) break;
            if (!buy(choice)) break;
            rank(frame);
        }
        enablers();
    }

    loop.add('buyer', tick, { everyFrames: 3, enabled: () => !!settings.autoBuy });

    return {
        options,
        /** Forces a fresh ranking on the next tick. */
        invalidate() {
            state.rankedAt = -Infinity;
        },
        ranking() {
            return state.ranked;
        },
        income() {
            return state.income;
        },
        reserve() {
            return state.reserve;
        },
        /** What the next purchase is, or null; ranks first if the ranking is stale. */
        next() {
            refreshIfStale(state.rankedAt);
            return state.ranked.find((c) => Number.isFinite(c.payback)) || null;
        },
        /** A plain summary for the menu. */
        report() {
            refreshIfStale(state.rankedAt);
            const top = state.ranked.slice(0, 8).map((c) => ({
                name: c.name,
                kind: c.kind,
                price: c.price,
                deltaIncome: c.deltaIncome,
                payback: c.payback,
            }));
            return { income: state.income, reserve: state.reserve, next: this.next(), top, purchases: state.purchases };
        },
    };
}
