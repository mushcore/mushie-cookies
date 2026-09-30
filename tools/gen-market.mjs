// Derives stock market buy and sell prices by simulation, with the price model proven identical
// to the game's (test/game/market.test.mjs), and writes src/data/market-thresholds.json.
// Usage: node tools/gen-market.mjs [ticks=60000]
import fs from 'node:fs';
import path from 'node:path';
import { tickMarket, restingValue, tradeDecision } from '../src/core/market.js';

const root = path.resolve(import.meta.dirname, '..');
const TICKS = Number(process.argv[2] || 60000);
const GOODS = 18;
const BANK_LEVELS = [1, 3, 5, 8, 12, 20];
const OVERHEADS = [0.2, 0.05, 0.01]; // 20% × 0.95^brokers: none, about 27 brokers, about 58
// Candidate thresholds as fractions of the resting value: fine steps to 2.5, then a coarse tail
// to 10. Cheap goods rest at $10 to $40 but often trade far above it (the first good at bank
// level 1 spends half its ticks above 2.5×; the game damps rises only past $100,
// minigameMarket.js:840), so a grid that stopped at 2.5 chose their sell price by its edge.
const FRACTIONS = [];
for (let i = 1; i <= 50; i++) FRACTIONS.push(i / 20); // 0.05 to 2.5
for (let i = 26; i <= 50; i++) FRACTIONS.push(i / 10); // 2.6 to 5
for (let i = 21; i <= 40; i++) FRACTIONS.push(i / 4); // 5.25 to 10

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A price history of every good at one bank level, started the way the game starts (minigameMarket.js:776-795). */
function history(bankLevel, seed) {
    const random = mulberry32(seed);
    const goods = Array.from({ length: GOODS }, (_, id) => ({
        id,
        val: restingValue(id, bankLevel),
        d: random() * 0.2 - 0.1,
        mode: Math.floor(random() * 6),
        dur: Math.floor(10 + random() * 690),
    }));
    const env = { bankLevel, dragonBoost: 0 };
    for (let i = 0; i < 15; i++) tickMarket(goods, env, random);
    const vals = goods.map(() => new Float64Array(TICKS));
    const modes = goods.map(() => new Uint8Array(TICKS));
    for (let t = 0; t < TICKS; t++) {
        tickMarket(goods, env, random);
        goods.forEach((g, i) => {
            vals[i][t] = g.val;
            modes[i][t] = g.mode;
        });
    }
    return { vals, modes };
}

/** Profit per tick, per share of storage, of trading one good's history with given prices. */
function profit(vals, modes, buyAt, sellAt, overhead, modeAware) {
    let holding = false;
    let paid = 0;
    let total = 0;
    const good = { val: 0, mode: 0, stock: 0 };
    const thresholds = { buyAt, sellAt };
    for (let t = 0; t < vals.length; t++) {
        good.val = vals[t];
        good.mode = modes[t];
        good.stock = holding ? 1 : 0;
        const action = tradeDecision({ good, thresholds, modeAware });
        if (action === 'buy' && !holding) {
            holding = true;
            paid = good.val * (1 + overhead);
        } else if (action === 'sell' && holding) {
            holding = false;
            total += good.val - paid;
        }
    }
    if (holding) total += vals[vals.length - 1] - paid; // mark to market
    return total / vals.length;
}

/**
 * Money tied up per tick, per share of storage, by the same trades as `profit`: what a share
 * cost, counted for every tick it is held. Profit over this is the return on the money a trade
 * takes away from buying, which the cash allocator weighs against the buyer's best purchase.
 */
function heldPerTick(vals, modes, buyAt, sellAt, overhead, modeAware) {
    let holding = false;
    let paid = 0;
    let held = 0;
    const good = { val: 0, mode: 0, stock: 0 };
    const thresholds = { buyAt, sellAt };
    for (let t = 0; t < vals.length; t++) {
        good.val = vals[t];
        good.mode = modes[t];
        good.stock = holding ? 1 : 0;
        const action = tradeDecision({ good, thresholds, modeAware });
        if (action === 'buy' && !holding) {
            holding = true;
            paid = good.val * (1 + overhead);
        } else if (action === 'sell' && holding) {
            holding = false;
        }
        if (holding) held += paid;
    }
    return held / vals.length;
}

// The grid search runs `profit` for thousands of price pairs per good. Flat, a pair costs a pass
// over every tick; this makes it cost one step per trade. Holding nothing, `profit` acts only on
// a buy, which depends on the buy price alone; holding, only on a sell, which depends on the sell
// price alone. So for each candidate price, the first tick at or after t where tradeDecision
// would buy (or sell) is tabulated once, and a pair's trades are read by jumping between them.
// The winner of every search is scored again by `profit` and must match to the last bit.

/** For every tick t, the first tick at or after t where `acts(t)`; the history's length if none. */
function firstFrom(out, length, acts) {
    out[length] = length;
    for (let t = length - 1; t >= 0; t--) out[t] = acts(t) ? t : out[t + 1];
}

function tabulate(vals, modes, rest, modeAware, buyNext, sellNext) {
    const n = vals.length;
    const good = { val: 0, mode: 0, stock: 0 };
    const decide = (t, stock, thresholds) => {
        good.val = vals[t];
        good.mode = modes[t];
        good.stock = stock;
        return tradeDecision({ good, thresholds, modeAware });
    };
    FRACTIONS.forEach((f, i) => {
        // Holding nothing, tradeDecision never reads the sell price; holding, a sell never depends on the buy price.
        const buyOnly = { buyAt: f * rest, sellAt: Infinity };
        const sellOnly = { buyAt: -Infinity, sellAt: f * rest };
        firstFrom(buyNext[i], n, (t) => decide(t, 0, buyOnly) === 'buy');
        firstFrom(sellNext[i], n, (t) => decide(t, 1, sellOnly) === 'sell');
    });
}

/** `profit` for one pair, from the tables: the same arithmetic in the same order. */
function profitFromTables(vals, buyNext, sellNext, overhead) {
    const n = vals.length;
    let total = 0;
    let t = buyNext[0];
    while (t < n) {
        const paid = vals[t] * (1 + overhead);
        const s = sellNext[t + 1];
        if (s >= n) {
            total += vals[n - 1] - paid; // mark to market
            break;
        }
        total += vals[s] - paid;
        t = buyNext[s + 1];
    }
    return total / n;
}

const table = { generated: new Date().toISOString().slice(0, 10), ticks: TICKS, bankLevels: BANK_LEVELS, overheads: OVERHEADS, entries: {} };
const report = [];
const started = Date.now();
const tables = () => FRACTIONS.map(() => new Int32Array(TICKS + 1));
const next = { false: { buy: tables(), sell: tables() }, true: { buy: tables(), sell: tables() } };
for (const bankLevel of BANK_LEVELS) {
    const { vals, modes } = history(bankLevel, 1000 + bankLevel);
    for (let id = 0; id < GOODS; id++) {
        const rest = restingValue(id, bankLevel);
        for (const modeAware of [false, true]) tabulate(vals[id], modes[id], rest, modeAware, next[modeAware].buy, next[modeAware].sell);
        for (const overhead of OVERHEADS) {
            let best = { profit: -Infinity };
            for (const modeAware of [false, true]) {
                const { buy, sell } = next[modeAware];
                for (let bi = 0; bi < FRACTIONS.length; bi++) {
                    for (let si = 0; si < FRACTIONS.length; si++) {
                        if (FRACTIONS[si] <= FRACTIONS[bi]) continue;
                        const p = profitFromTables(vals[id], buy[bi], sell[si], overhead);
                        if (p > best.profit) best = { profit: p, buy: FRACTIONS[bi], sell: FRACTIONS[si], modeAware };
                    }
                }
            }
            const check = profit(vals[id], modes[id], best.buy * rest, best.sell * rest, overhead, best.modeAware);
            if (check !== best.profit) throw new Error(`search and simulation disagree at ${bankLevel}/${overhead}/${id}: ${best.profit} against ${check}`);
            const published = profit(vals[id], modes[id], 0.5 * rest, 1.25 * rest, overhead, false);
            const held = heldPerTick(vals[id], modes[id], best.buy * rest, best.sell * rest, overhead, best.modeAware);
            table.entries[`${bankLevel}/${overhead}/${id}`] = { buy: best.buy, sell: best.sell, modeAware: best.modeAware, profitPerTick: +best.profit.toFixed(5), heldPerTick: +held.toFixed(4) };
            report.push({ bankLevel, overhead, id, best: best.profit, published });
        }
    }
    process.stderr.write(`bank level ${bankLevel} done (${Math.round((Date.now() - started) / 1000)} s)\n`);
}

// Check against a fresh history the search never saw, so the table is not just fitted to noise.
function heldOutFor(levels, overheads) {
    const sum = { ours: 0, published: 0 };
    for (const bankLevel of levels) {
        const { vals, modes } = history(bankLevel, 99999 + bankLevel);
        for (const overhead of overheads) {
            for (let id = 0; id < GOODS; id++) {
                const e = table.entries[`${bankLevel}/${overhead}/${id}`];
                const rest = restingValue(id, bankLevel);
                sum.ours += profit(vals[id], modes[id], e.buy * rest, e.sell * rest, overhead, e.modeAware);
                sum.published += profit(vals[id], modes[id], 0.5 * rest, 1.25 * rest, overhead, false);
            }
        }
    }
    return { ours: +sum.ours.toFixed(4), published: +sum.published.toFixed(4) };
}
table.heldOut = heldOutFor([1, 5], [0.05]);
table.heldOutAll = heldOutFor(BANK_LEVELS, OVERHEADS);

const out = path.join(root, 'src', 'data', 'market-thresholds.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(table) + '\n');
const sum = (key) => report.reduce((s, r) => s + r[key], 0);
const entries = Object.values(table.entries);
const lo = FRACTIONS[0];
const hi = FRACTIONS[FRACTIONS.length - 1];
console.log(`in-sample profit per tick, all goods and settings: searched ${sum('best').toFixed(3)} against the 50%/125% rule ${sum('published').toFixed(3)}`);
console.log(`held-out history (bank levels 1 and 5, 5% overhead): searched ${table.heldOut.ours} against ${table.heldOut.published}`);
console.log(`held-out history (every bank level and overhead): searched ${table.heldOutAll.ours} against ${table.heldOutAll.published}`);
console.log(`at the grid's edge: ${entries.filter((e) => e.buy === lo).length} buy at ${lo}, ${entries.filter((e) => e.sell === hi).length} sell at ${hi}`);
console.log(`mode-aware chosen for ${entries.filter((e) => e.modeAware).length} of ${entries.length} entries; wrote ${path.relative(root, out)}`);
