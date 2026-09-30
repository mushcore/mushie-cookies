// The buyer: ranks everything for sale by the income it adds, keeps a reserve for golden
// cookies when that pays, and buys. Runs on the loop; reads settings live.
import { estimateIncome } from '../core/income.js';
import { rankCandidates, chooseReserve, decide } from '../core/buyer.js';
import { readState, measureCandidates } from '../game/measure.js';
import { listCandidates } from '../game/candidates.js';

const RERANK_FRAMES = 150; // five seconds
const PURCHASES_PER_TICK = 2; // each purchase re-ranks; two keep a tick well inside a frame
const BULK = 10;
const FAILED_COOLDOWN_FRAMES = 30 * 60; // a purchase the game refused is not tried again for a minute

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
 * @param {(policy: object) => Array<object>} [deps.extraCandidates]  purchases other systems offer
 *   (the bank office, brokers), each with `apply` for the what-if, `extraIncome` for what the
 *   income model cannot see, and `purchase` to make it
 * @param {(what: string) => void} [deps.log]
 */
export function createBuyer({ game, settings, policy, loop, extraReserve = () => 0, extraCandidates = () => [], log = () => {} }) {
    // The reserve is kept only once the best purchase repays more slowly than this (seconds).
    // Measured over six game hours on two seeds: with 0 the reserve engages around hour four or
    // five and was never behind holding none; with 6000 or more it never engaged in that span.
    const options = { reserveMinPayback: 0 };
    const state = {
        ranked: [],
        income: null,
        reserve: 0,
        rankedAt: -Infinity,
        stale: true,
        stamp: '',
        last: null, // the last decision, for the menu
        purchases: 0,
        failed: new Map(), // candidate key -> frame it may be tried again
        frame: 0,
    };

    // A CpS buff inflates click power in a way the model cannot fully divide out (mouse upgrades
    // add a share of the buffed CpS, main.js:4692-4708), so rankings are made between buffs and
    // the last one is kept while a buff runs.
    const cpsBuffRunning = () => Object.values(game.buffs).some((b) => b.multCpS && b.multCpS !== 1);

    // Anything here changing means the ranking may be wrong.
    const stampOf = () =>
        [
            game.UpgradesInStore.length,
            game.elderWrath,
            game.AchievementsOwned,
            game.BuildingsOwned,
            game.UpgradesOwned,
            game.season,
        ].join('|');

    function rank(frame) {
        const pol = policy();
        const candidates = listCandidates(game, pol)
            .concat(extraCandidates(pol))
            .filter((c) => !((state.failed.get(c.key) || 0) > frame));
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
        const held = chooseReserve({ best, reserves, income: empty, minPurchasePayback: options.reserveMinPayback });
        state.reserve = Math.max(held, extraReserve() || 0);
        state.ranked = ranked;
        state.income = income;
        state.limits = pol.limits || {};
        state.rankedAt = frame;
        state.stale = false;
        state.stamp = stampOf();
    }

    function refreshIfStale(frame) {
        const due = state.stale || !state.income || frame - state.rankedAt >= RERANK_FRAMES || state.stamp !== stampOf();
        if (!due) return;
        if (state.income && cpsBuffRunning() && !state.stale) return;
        rank(frame);
    }

    /** How many more of a building the settings allow. */
    const room = (building) => {
        const max = state.limits && state.limits[building.id];
        return max === undefined ? Infinity : Math.max(0, max - building.amount);
    };

    function buy(candidate) {
        const before = game.cookies;
        if (candidate.kind === 'building') {
            // Ten at once only when the bank covers all ten above the reserve and the limit allows.
            const ten = candidate.building.getSumPrice(BULK);
            const n = game.cookies - ten >= state.reserve && room(candidate.building) >= BULK ? BULK : 1;
            if (room(candidate.building) >= 1) buyBuilding(candidate.building, n);
        } else if (candidate.kind === 'upgrade') {
            // bypass: the game's confirmation prompt ("One mind", ...) is the player saying yes.
            candidate.upgrade.buy(1);
        } else if (candidate.kind === 'chain') {
            if (candidate.steps.every((s) => room(s.building) >= s.missing)) {
                for (const step of candidate.steps) buyBuilding(step.building, step.missing);
                if (candidate.upgrade.unlocked && !candidate.upgrade.bought) candidate.upgrade.buy(1);
            }
        } else if (typeof candidate.purchase === 'function') {
            candidate.purchase({ buyBuilding });
        }
        const spent = before - game.cookies;
        if (spent > 0) {
            state.purchases++;
            log(`bought ${candidate.name} for ${spent < 1e21 ? Math.round(spent).toLocaleString() : spent.toExponential(2)}`);
        } else {
            // The game refused: do not keep choosing it.
            state.failed.set(candidate.key, state.frame + FAILED_COOLDOWN_FRAMES);
            state.stale = true;
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
        const excluded = policy().excludedUpgrades;
        if (excluded === 'all') return;
        const minute = state.income.total * 60;
        for (const upgrade of game.UpgradesInStore) {
            if (!ENABLERS.has(upgrade.name) || upgrade.bought || excluded.has(upgrade.id)) continue;
            const price = upgrade.getPrice();
            if (price <= minute && game.cookies - price >= state.reserve) {
                upgrade.buy(1);
                log(`bought ${upgrade.name} (enabler)`);
            }
        }
    }

    function tick(frame) {
        state.frame = frame;
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

    // No store while ascending: the animation and the heavenly screen come first.
    loop.add('buyer', tick, { everyFrames: 3, enabled: () => !!settings.autoBuy && !game.OnAscend && !game.AscendTimer });

    return {
        options,
        /** Forces a fresh ranking on the next tick or the next report. */
        invalidate() {
            state.stale = true;
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
        /**
         * What the buyer is saving for above its reserve: the price of its next purchase, from the
         * last ranking. Other spenders keep it (the market's allocator), unless what they would buy
         * returns more per cookie than that purchase.
         */
        committed() {
            if (!settings.autoBuy) return 0;
            const next = state.ranked.find((c) => Number.isFinite(c.payback));
            return next ? next.price : 0;
        },
        /** What the next purchase is, or null; ranks first if the ranking is stale. */
        next() {
            refreshIfStale(state.frame);
            return state.ranked.find((c) => Number.isFinite(c.payback)) || null;
        },
        /** A plain summary for the menu. */
        report() {
            refreshIfStale(state.frame);
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
