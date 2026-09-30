// Trades the stock market with prices derived by simulating the game's own price model
// (tools/gen-market.mjs). Buying spends only what the buyer is not holding in reserve.
import { restingValue, tradeDecision } from '../core/market.js';
import table from '../data/market-thresholds.json';

const TICK_EVERY = 30; // frames; the market itself ticks once a minute

function nearest(list, value, below = false) {
    let best = list[0];
    for (const x of list) {
        if (below ? x <= value : Math.abs(x - value) < Math.abs(best - value)) best = x;
    }
    return best;
}

/** Buy and sell prices for one good at the market's current bank level and broker overhead. */
export function thresholdsFor(id, bankLevel, overhead) {
    const level = nearest(table.bankLevels, bankLevel, true);
    const oh = nearest(table.overheads, overhead);
    const entry = table.entries[`${level}/${oh}/${id}`];
    const rest = restingValue(id, bankLevel);
    return { buyAt: entry.buy * rest, sellAt: entry.sell * rest, modeAware: entry.modeAware };
}

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings   autoMarket
 * @param {object} deps.loop
 * @param {() => number} [deps.reserve]  cookies the buyer is holding back
 * @param {(what: string) => void} [deps.log]
 */
export function createMarket({ game, settings, loop, reserve = () => 0, log = () => {} }) {
    const state = { buys: 0, sells: 0, profitAtStart: null };

    function tick() {
        const M = game.Objects['Bank'].minigame;
        if (!M || !M.goodsById || game.OnAscend) return;
        if (state.profitAtStart === null) state.profitAtStart = M.profit;
        const bankLevel = game.Objects['Bank'].level;
        const overhead = 0.2 * Math.pow(0.95, M.brokers);
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
                const unit = game.cookiesPsRawHighest * good.val * (1 + overhead);
                const budget = game.cookies - reserve();
                const n = unit > 0 ? Math.min(room, Math.floor(budget / unit)) : 0;
                if (n > 0 && M.buyGood(good.id, n)) {
                    state.buys++;
                    log(`market: bought ${n} ${good.name} at $${good.val.toFixed(2)}`);
                }
            }
        }
    }

    loop.add('market', tick, { everyFrames: TICK_EVERY, enabled: () => settings.autoMarket == 1 });

    return {
        report() {
            const M = game.Objects['Bank'].minigame;
            return {
                buys: state.buys,
                sells: state.sells,
                profit: M && state.profitAtStart !== null ? M.profit - state.profitAtStart : 0,
            };
        },
    };
}
