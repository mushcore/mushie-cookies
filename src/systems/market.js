// Trades the stock market with prices derived by simulating the game's own price model
// (tools/gen-market.mjs), and runs its bank: office upgrades and brokers are offered to the buyer
// as purchases ranked with everything else, and loans are taken on the combos that pay for them.
// Buying stock spends only what the buyer is neither holding in reserve nor saving for its next
// purchase, unless the trade returns more per cookie than that purchase (src/core/bank.js).
import { restingValue, tradeDecision } from '../core/market.js';
import { OFFICES, officeIncome, overhead as overheadWith, brokerIncome, brokerWorthHiring, expectedRunLeft, tradeReturn, marketBudget } from '../core/bank.js';
import { LOANS, chooseLoan, secondsToAscension, comboProfile, castTimes, loanOccasion } from '../core/loans.js';
import { classifyBuffs, unbuffedFactors } from '../core/buffs.js';
import { estimateIncome } from '../core/income.js';
import { simulate } from '../core/sim.js';
import { readState } from '../game/measure.js';
import { awardForBuildings } from '../game/awards.js';
import { forecastMany } from '../game/fate.js';
import table from '../data/market-thresholds.json';

const TICK_EVERY = 30; // frames; the market itself ticks once a minute
const SAMPLE_SECONDS = 60; // growth, earnings and the ascension forecast are sampled once a minute
const GROWTH_SECONDS = 30 * 60; // the window CpS growth and earnings are measured over
const FILL_WEIGHT = 0.05; // each buy signal's weight in the running fill estimate
const MIN_VOLUME_SECONDS = 3600; // buy volume is averaged over at least an hour
const FORECAST_CASTS = 20; // Force the Hand of Fate outcomes looked at for combos ahead

function nearest(list, value, below = false) {
    let best = list[0];
    for (const x of list) {
        if (below ? x <= value : Math.abs(x - value) < Math.abs(best - value)) best = x;
    }
    return best;
}

/** Buy and sell prices for one good at the market's current bank level and broker overhead, with the table's return figures. */
export function thresholdsFor(id, bankLevel, overhead) {
    const level = nearest(table.bankLevels, bankLevel, true);
    const oh = nearest(table.overheads, overhead);
    const entry = table.entries[`${level}/${oh}/${id}`];
    const rest = restingValue(id, bankLevel);
    return {
        buyAt: entry.buy * rest,
        sellAt: entry.sell * rest,
        modeAware: entry.modeAware,
        profitPerTick: entry.profitPerTick,
        heldPerTick: entry.heldPerTick,
    };
}

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings   autoMarket, autoBank, autoBroker, autoLoan
 * @param {object} deps.loop
 * @param {() => number} [deps.reserve]  cookies the buyer is holding back
 * @param {{committed(): number, ranking(): Array<object>}} [deps.buyer]  what it is saving for, and its ranking
 * @param {{verdict(): object, runSeconds(): number}} [deps.ascension]  its verdict, for forecasting
 *   when the run ends, and its run clock
 * @param {(what: string) => void} [deps.log]
 */
export function createMarket({ game, settings, loop, reserve = () => 0, buyer = null, ascension = null, log = () => {} }) {
    // 'committed' is the allocator this system is built on; 'reserve' (spend all above the
    // reserve, the rule it replaces) is kept so the two can be compared in the harness.
    const options = { allocator: 'committed' };
    const state = {
        buys: 0,
        sells: 0,
        profitAtStart: null,
        heldForBuyer: 0, // buy signals the buyer's saving held back
        offices: 0,
        brokers: 0,
        loans: [],
        run: null, // the start date of the run the figures below belong to
        volume: 0, // $ of goods bought this run, before overhead
        volumeSince: 0,
        fill: 1, // how often a buy signal found the market able to fill its room
        sampled: new Map(), // good id -> the market tick its fill was last sampled
        samples: [], // [{t, raw, earned}], one a minute
        gaps: [], // [{t, gap}] of the ascension verdict, one a minute
        lastSampleAt: -Infinity,
        allocation: null, // the inputs of the last buy decision
        loan: null, // the last loan decision
        office: null, // the last office offer: its price and the income it adds
        frame: 0, // the loop's frame at the last tick
    };

    const market = () => {
        const M = game.Objects['Bank'].minigame;
        return M && M.goodsById ? M : null;
    };
    // Everything here is timed by play, not the wall clock: the game makes nothing while the
    // machine sleeps or the loop stalls (it catches up at most 5 s, main.js:16788), and a rate or
    // a run length measured across that gap is wrong. `now` counts the loop's frames; the run's
    // length is the ascension system's run clock, which counts them the same way.
    const now = () => state.frame / game.fps;
    const runSeconds = () =>
        ascension && typeof ascension.runSeconds === 'function' ? ascension.runSeconds() : Math.max(0, (Date.now() - game.startDate) / 1000);

    /** A new run starts with no brokers, no offices, and a raw CpS record of 0 (main.js:3504, 3619). */
    function trackRun() {
        if (state.run === game.startDate) return;
        state.run = game.startDate;
        state.volume = 0;
        state.volumeSince = now();
        state.samples = [];
        state.gaps = [];
        state.lastSampleAt = -Infinity;
    }

    function sample() {
        const t = now();
        if (t - state.lastSampleAt < SAMPLE_SECONDS) return;
        state.lastSampleAt = t;
        state.samples.push({ t, raw: game.cookiesPsRawHighest, earned: game.cookiesEarned });
        while (state.samples.length > 2 && state.samples[1].t <= t - GROWTH_SECONDS) state.samples.shift();
        // A first ascension waits for a prestige target, not for growth to slow (src/core/ascension.js).
        const verdict = ascension && settings.autoAscendToggle == 1 && game.prestige > 0 ? ascension.verdict() : null;
        if (verdict && verdict.startDate === game.startDate && Number.isFinite(verdict.instantRate) && Number.isFinite(verdict.averageRate)) {
            state.gaps.push({ t, gap: verdict.instantRate - verdict.averageRate });
            while (state.gaps.length > 2 && state.gaps[1].t <= t - GROWTH_SECONDS) state.gaps.shift();
        }
    }

    /** Rate the run's raw CpS record is rising at, per second, over the last half hour. */
    function growth() {
        const first = state.samples[0];
        const last = state.samples[state.samples.length - 1];
        if (!first || !(first.raw > 0) || !(last.t - first.t >= SAMPLE_SECONDS * 5)) return 0;
        return Math.max(0, Math.log(last.raw / first.raw) / (last.t - first.t));
    }

    /** Cookies earned per second over the last half hour: combos, clicks and all. */
    function earnedRate() {
        const first = state.samples[0];
        const last = state.samples[state.samples.length - 1];
        if (!first || !(last.t - first.t >= SAMPLE_SECONDS * 5)) return 0;
        return Math.max(0, (last.earned - first.earned) / (last.t - first.t));
    }

    /** The buyer's next purchase other than the market's own offers: what money in the market is taken from. */
    function buyerNext() {
        if (!buyer || !settings.autoBuy) return null;
        return buyer.ranking().find((c) => Number.isFinite(c.payback) && c.kind !== 'office' && c.kind !== 'broker') || null;
    }
    const buyerReturn = () => {
        const next = buyerNext();
        return next && next.purePayback > 0 && Number.isFinite(next.purePayback) ? 1 / next.purePayback : 0;
    };
    const committed = () => (options.allocator === 'committed' && buyer && buyer.committed ? buyer.committed() : 0);

    /** One sample per good per market tick: could the market fill all the room it had? */
    function sampleFill(M, good, filled) {
        if (state.sampled.get(good.id) === M.ticks) return;
        state.sampled.set(good.id, M.ticks);
        state.fill += FILL_WEIGHT * ((filled ? 1 : 0) - state.fill);
    }

    function trade(M) {
        const bankLevel = game.Objects['Bank'].level;
        const overhead = overheadWith(M.brokers);
        const g = growth();
        const bR = buyerReturn();
        for (const good of M.goodsById) {
            if (!good.active) continue;
            const t = thresholdsFor(good.id, bankLevel, overhead);
            const action = tradeDecision({ good, thresholds: t, modeAware: t.modeAware });
            if (action === 'sell' && good.stock > 0) {
                if (M.sellGood(good.id, good.stock)) {
                    state.sells++;
                    log(`market: sold ${good.name} at $${good.val.toFixed(2)}`);
                }
            } else if (action === 'buy') {
                const room = M.getGoodMaxStock(good) - good.stock;
                if (room <= 0) {
                    sampleFill(M, good, true);
                    continue;
                }
                state.allocation = { reserve: reserve(), committed: committed(), tradeReturn: tradeReturn(t, g), buyerReturn: bR };
                const unit = game.cookiesPsRawHighest * good.val * (1 + overhead);
                const budget = marketBudget({ bank: game.cookies, ...state.allocation });
                const n = unit > 0 ? Math.min(room, Math.floor(budget / unit)) : 0;
                if (n < room && unit > 0 && Math.floor((game.cookies - state.allocation.reserve) / unit) > n) state.heldForBuyer++;
                sampleFill(M, good, n >= room);
                if (n > 0 && M.buyGood(good.id, n)) {
                    state.buys++;
                    state.volume += good.val * n;
                    log(`market: bought ${n} ${good.name} at $${good.val.toFixed(2)}`);
                }
            }
        }
    }

    // A player upgrades the office, hires a broker and takes a loan with the bank's buttons; the
    // game's handlers make their own checks (minigameMarket.js:542-571).
    function press(id) {
        const button = document.getElementById(id);
        if (button) button.click();
    }

    /** What buying `building` from `from` owned to `to` costs, the way getSumPrice prices it (main.js:7797-7806). */
    function rangePrice(building, from, to) {
        let sum = 0;
        for (let i = Math.max(0, from); i < to; i++) sum += building.basePrice * Math.pow(game.priceIncrease, Math.max(0, i - building.free));
        return Math.ceil(game.modifyBuildingPrice(building, sum));
    }

    function activeGoods(M) {
        const overhead = overheadWith(M.brokers);
        const bankLevel = game.Objects['Bank'].level;
        return M.goodsById
            .filter((good) => good.active)
            .map((good) => ({ highest: good.building.highest, level: good.building.level, ...thresholdsFor(good.id, bankLevel, overhead) }));
    }

    /**
     * The next office as one purchase: cursors up to what it sacrifices, the upgrade, and buying the
     * sacrificed cursors back, since the sacrifice takes the most expensive ones and gives nothing
     * for them (main.js:7920-7947). Its cursors end where they started or at the threshold; its
     * gain on top of theirs is the market profit the larger warehouse allows.
     */
    function officeCandidate(M, policy) {
        const level = M.officeLevel;
        const office = OFFICES[level];
        const cursor = game.Objects['Cursor'];
        if (!office || cursor.level < office.level) return null;
        if (policy.excludedBuildings === 'all' || policy.excludedBuildings.has(cursor.id)) return null;
        const top = Math.max(cursor.amount, office.cursors);
        const limit = policy.limits && policy.limits[cursor.id];
        if (limit !== undefined && top > limit) return null;
        const missing = top - cursor.amount;
        const extraIncome = officeIncome({
            goods: activeGoods(M),
            officeLevel: level,
            rawCps: game.cookiesPsRawHighest,
            buyerReturn: buyerReturn(),
            growth: growth(),
            fill: state.fill,
        });
        const price = rangePrice(cursor, cursor.amount, top) + rangePrice(cursor, top - office.cursors, top);
        state.office = { level: level + 1, price, extraIncome, fill: state.fill };
        if (!(extraIncome > 0)) return null;
        return {
            key: `office:${level + 1}`,
            kind: 'office',
            name: `${missing ? `${missing} × Cursor + ` : ''}${M.offices[level + 1].name}, buying back ${office.cursors} cursors`,
            price,
            extraIncome,
            apply() {
                cursor.amount += missing;
                cursor.bought += missing + office.cursors;
                game.BuildingsOwned += missing;
                awardForBuildings(game, cursor);
            },
            purchase({ buyBuilding }) {
                if (M.officeLevel !== level) return;
                if (missing > 0) buyBuilding(cursor, missing);
                if (cursor.amount < office.cursors) return;
                press('bankOfficeUpgrade');
                if (M.officeLevel <= level) return;
                buyBuilding(cursor, office.cursors);
                state.offices++;
                log(`market: upgraded the office to ${M.offices[M.officeLevel].name}`);
            },
        };
    }

    /** Buy volume per second this run, in $ before overhead. */
    const volumeRate = () => state.volume / Math.max(MIN_VOLUME_SECONDS, now() - state.volumeSince);

    /** The next broker, when the overhead it saves on the measured buy volume repays it before the run is expected to end. */
    function brokerCandidate(M) {
        if (M.brokers >= M.getMaxBrokers()) return null;
        const price = M.getBrokerPrice();
        const income = brokerIncome({ brokers: M.brokers, buyVolume: volumeRate(), rawCps: game.cookiesPsRawHighest });
        if (!brokerWorthHiring({ price, income, runSeconds: runSeconds() })) return null;
        const hired = M.brokers;
        return {
            key: `broker:${hired + 1}`,
            kind: 'broker',
            name: 'Stockbroker',
            price,
            extraIncome: income,
            apply() {},
            purchase() {
                if (M.brokers !== hired) return;
                press('bankBrokersBuy');
                if (M.brokers > hired) {
                    state.brokers++;
                    log(`market: hired broker ${M.brokers}`);
                }
            },
        };
    }

    /**
     * Purchases the buyer may rank: the next office and the next broker, when their settings are
     * on. Both pay only through trading, so neither is offered while the market does not trade.
     */
    function candidates(policy) {
        const M = market();
        if (!M || game.OnAscend || settings.autoMarket != 1) return [];
        trackRun();
        const out = [];
        if (settings.autoBank == 1) {
            const office = officeCandidate(M, policy);
            if (office) out.push(office);
        }
        if (settings.autoBroker == 1) {
            const broker = brokerCandidate(M);
            if (broker) out.push(broker);
        }
        return out;
    }

    /**
     * Cookies per click that scale with CpS now: each mouse upgrade adds 1% of the buffed CpS to a
     * click (main.js:4692-4708), so a loan multiplies that part of every click too. Read by pricing
     * a click at double the CpS inside a what-if, which restores what it touched.
     */
    function clickCpsShare() {
        return simulate(game, {
            apply() {},
            measure() {
                const cps = game.cookiesPs;
                const base = game.mouseCps();
                game.cookiesPs = cps * 2;
                const doubled = game.mouseCps();
                game.cookiesPs = cps;
                return Math.max(0, doubled - base);
            },
        });
    }

    /** The buffs running now, as seconds left and multipliers, read by the shared classifier. */
    const runningBuffs = () =>
        classifyBuffs(game.buffs, { fps: game.fps })
            .filter((c) => c.secondsLeft > 0)
            .map((c) => ({ seconds: c.secondsLeft, multCpS: c.cpsMult, multClick: c.clickMult }));

    /**
     * Click frenzies forecast from Force the Hand of Fate inside `window` seconds, each timed at
     * the soonest the mana covers it, as the income a loan would scale over them. Valued landing
     * alone, though the grimoire lands them on a buff when it can: waiting for one is never
     * overstated.
     */
    function forecastCombos(window, { durationMult, clicksPerSecond, share }) {
        const grimoire = game.Objects['Wizard tower'].minigame;
        if (!grimoire || !grimoire.spells || settings.autoFate != 1) return [];
        const factors = unbuffedFactors(game.buffs);
        const buffed = factors.cps * factors.click;
        // A click frenzy lasts 13 s times the golden cookie duration bonus, at ×777 (main.js:5561).
        const profile = comboProfile({
            buffs: [{ seconds: Math.ceil(13 * durationMult), multClick: 777 }],
            cps: game.unbuffedCps,
            clicksPerSecond,
            clickShare: buffed > 0 ? (share / buffed) * 777 : 0,
        });
        const outcomes = forecastMany(game, grimoire, FORECAST_CASTS);
        const times = castTimes({ mana: grimoire.magic, maxMana: grimoire.magicM, cost: grimoire.getSpellCost(grimoire.spells['hand of fate']), count: outcomes.length, window });
        return times
            .map((inSeconds, i) => ({ inSeconds, next: outcomes[i] }))
            .filter(({ next }) => next.success && next.outcome === 'click frenzy')
            .map(({ inSeconds }) => ({ inSeconds, profile }));
    }

    function takeLoans(M) {
        const allowed = settings.autoLoan == 2 ? 3 : 2; // the setting's choices: loans 1 and 2, or all three
        const loans = LOANS.filter(
            (l) => l.id <= allowed && M.officeLevel >= l.office && !game.hasBuff(`Loan ${l.id}`) && !game.hasBuff(`Loan ${l.id} (interest)`)
        );
        if (!loans.length) return;
        const secondsLeft = settings.autoAscendToggle == 1 ? secondsToAscension(state.gaps) : Infinity;
        // Nothing but a combo or the run's end in sight can make a loan pay (src/core/loans.js).
        if (!loanOccasion({ buffs: game.buffs, secondsLeft, loans, fps: game.fps })) {
            state.loan = { taken: null, reason: 'no combo running and no ascension in sight' };
            return;
        }
        const live = readState(game, settings);
        const share = clickCpsShare();
        const buffs = runningBuffs();
        const profile = comboProfile({ buffs, cps: game.unbuffedCps, clicksPerSecond: live.clicksPerSecond, clickShare: share });
        const expected = Math.max(estimateIncome(live).total, earnedRate());
        const window = Math.max(...loans.map((l) => l.seconds + l.interestSeconds));
        const next = buyerNext();
        const choice = chooseLoan({
            loans,
            now: { profile, expected, bank: game.cookies, secondsLeft },
            spendable: game.cookies - reserve(),
            committed: committed(),
            buyerReturn: next && Number.isFinite(next.purePayback) && next.purePayback > 0 ? 1 / next.purePayback : 0,
            ahead: forecastCombos(window, { durationMult: live.golden.durationMult, clicksPerSecond: live.clicksPerSecond, share }),
        });
        if (!choice) {
            state.loan = { taken: null, reason: 'no loan is worth its cost', secondsLeft };
            return;
        }
        press(`bankLoan${choice.loan.id}`);
        if (!game.hasBuff(`Loan ${choice.loan.id}`)) return;
        const record = { id: choice.loan.id, net: choice.net, gain: choice.gain, cost: choice.cost, secondsLeft, at: runSeconds() };
        state.loans.push(record);
        state.loan = { taken: record };
        log(`market: took loan ${choice.loan.id}, worth ${Math.round(choice.net).toLocaleString()} cookies over its cost`);
    }

    function tick(frame) {
        state.frame = frame;
        const M = market();
        if (!M || game.OnAscend) return;
        if (state.profitAtStart === null) state.profitAtStart = M.profit;
        trackRun();
        sample();
        if (settings.autoMarket == 1) trade(M);
        if (settings.autoLoan >= 1) takeLoans(M);
    }

    loop.add('market', tick, {
        everyFrames: TICK_EVERY,
        enabled: () => settings.autoMarket == 1 || settings.autoBank == 1 || settings.autoBroker == 1 || settings.autoLoan >= 1,
    });

    return {
        options,
        candidates,
        /** The inputs of the last buy decision: reserve, committed, and the two returns compared. */
        allocation: () => state.allocation,
        report() {
            const M = market();
            return {
                buys: state.buys,
                sells: state.sells,
                profit: M && state.profitAtStart !== null ? M.profit - state.profitAtStart : 0,
                heldForBuyer: state.heldForBuyer,
                fill: state.fill,
                growth: growth(),
                volumePerSecond: volumeRate(),
                // What the next broker would take to repay, against the time the run is expected to have left.
                brokerPayback: M ? M.getBrokerPrice() / brokerIncome({ brokers: M.brokers, buyVolume: volumeRate(), rawCps: game.cookiesPsRawHighest }) : Infinity,
                runLeft: expectedRunLeft(runSeconds()),
                offices: state.offices,
                office: state.office,
                brokers: state.brokers,
                loans: state.loans.slice(),
                loan: state.loan,
                secondsToAscension: secondsToAscension(state.gaps),
            };
        },
    };
}
