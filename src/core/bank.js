/**
 * The stock market's bank: office upgrades, stockbrokers, and the cash the market may spend.
 * Pure: the adapter in src/systems/market.js reads the game into these arguments. Money in the
 * market is counted in $, where $1 is one second of the highest raw CpS of the run
 * (minigameMarket.js:210-213), so every value here converts to cookies by that CpS.
 */

/** The market ticks once a minute (minigameMarket.js secondsPerTick). */
export const TICK_SECONDS = 60;

/** What each office upgrade sacrifices in cursors, and the Cursor level it needs (minigameMarket.js:291-298). */
export const OFFICES = [
    { cursors: 100, level: 2 },
    { cursors: 200, level: 4 },
    { cursors: 350, level: 8 },
    { cursors: 500, level: 10 },
    { cursors: 700, level: 12 },
];

/** Shares of one good the warehouse holds (minigameMarket.js:194-202). */
export function storage({ highest, level, officeLevel }) {
    let bonus = 0;
    if (officeLevel > 0) bonus += 25;
    if (officeLevel > 1) bonus += 50;
    if (officeLevel > 2) bonus += 75;
    if (officeLevel > 3) bonus += 100;
    return Math.ceil(highest * (officeLevel > 4 ? 1.5 : 1) + bonus + level * 10);
}

/**
 * What a cookie put into a good's trades returns per second: the trading table's profit per tick
 * over the money those trades keep tied up per tick (tools/gen-market.mjs), plus `growth`, the
 * rate the highest raw CpS of the run is rising at. Goods are bought and sold at that CpS
 * (minigameMarket.js:211, 252), so money held in stock grows with it.
 */
export function tradeReturn({ profitPerTick, heldPerTick }, growth = 0) {
    return heldPerTick > 0 ? profitPerTick / heldPerTick / TICK_SECONDS + growth : 0;
}

/**
 * Cookies per second one more share of a good's storage earns, net of what the money it ties up
 * would earn in the buyer's next purchase: extra room is worth only the return above that.
 * @param {{profitPerTick: number, heldPerTick: number}} good   the trading table's entry
 * @param {{rawCps: number, buyerReturn?: number, growth?: number}} at  buyerReturn: 1 / purePayback
 *   of that purchase; growth: see tradeReturn
 */
export function shareIncome({ profitPerTick, heldPerTick }, { rawCps, buyerReturn = 0, growth = 0 }) {
    const excess = profitPerTick + heldPerTick * (growth - buyerReturn) * TICK_SECONDS; // $ a tick
    return (Math.max(0, excess) * rawCps) / TICK_SECONDS;
}

/**
 * Cookies per second the next office upgrade adds: every active good's extra storage times what a
 * share earns, times `fill`, how often the market could afford all the room it already has. Room
 * a market cannot afford to fill earns nothing.
 * @param {object} args
 * @param {Array<{highest, level, profitPerTick, heldPerTick}>} args.goods  the active goods
 */
export function officeIncome({ goods, officeLevel, rawCps, buyerReturn = 0, growth = 0, fill = 1 }) {
    if (officeLevel >= OFFICES.length) return 0;
    let income = 0;
    for (const good of goods) {
        const added = storage({ ...good, officeLevel: officeLevel + 1 }) - storage({ ...good, officeLevel });
        income += added * shareIncome(good, { rawCps, buyerReturn, growth });
    }
    return income * fill;
}

/** The overhead on buying goods with `brokers` hired (minigameMarket.js:211-212). */
export const overhead = (brokers) => 0.2 * Math.pow(0.95, brokers);

/**
 * Cookies per second the next broker saves: the overhead it removes from the buy volume.
 * @param {{brokers: number, buyVolume: number, rawCps: number}} args  buyVolume in $ a second, before overhead
 */
export function brokerIncome({ brokers, buyVolume, rawCps }) {
    return (overhead(brokers) - overhead(brokers + 1)) * buyVolume * rawCps;
}

/**
 * Time the run is expected to have left: one that has lasted t is expected to last about as long
 * again (the Lindy rule; nothing better is known about when the ascension comes), and at least
 * an hour.
 */
export const expectedRunLeft = (runSeconds) => Math.max(3600, runSeconds);

/**
 * Whether a broker repays its price before the run is expected to end: brokers are dismissed at
 * every ascension (minigameMarket.js:767-768, main.js:3619), so savings after that never come.
 */
export function brokerWorthHiring({ price, income, runSeconds }) {
    return income > 0 && price / income <= expectedRunLeft(runSeconds);
}

/**
 * What the market may spend now. Never the buyer's reserve. What the buyer is saving for its next
 * purchase (`committed`) only when a cookie in the trade returns more per second than a cookie in
 * that purchase (`buyerReturn`, 1 / its purePayback).
 */
export function marketBudget({ bank, reserve, committed, tradeReturn: returns, buyerReturn }) {
    const floor = reserve + (returns > buyerReturn ? 0 : committed);
    return Math.max(0, bank - floor);
}
