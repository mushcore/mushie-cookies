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
const FRACTIONS = []; // candidate thresholds as fractions of the resting value
for (let f = 0.1; f <= 2.51; f += 0.05) FRACTIONS.push(Math.round(f * 100) / 100);

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

const table = { generated: new Date().toISOString().slice(0, 10), ticks: TICKS, bankLevels: BANK_LEVELS, overheads: OVERHEADS, entries: {} };
const report = [];
const started = Date.now();
for (const bankLevel of BANK_LEVELS) {
    const { vals, modes } = history(bankLevel, 1000 + bankLevel);
    for (const overhead of OVERHEADS) {
        for (let id = 0; id < GOODS; id++) {
            const rest = restingValue(id, bankLevel);
            let best = { profit: -Infinity };
            for (const modeAware of [false, true]) {
                for (const b of FRACTIONS) {
                    for (const s of FRACTIONS) {
                        if (s <= b) continue;
                        const p = profit(vals[id], modes[id], b * rest, s * rest, overhead, modeAware);
                        if (p > best.profit) best = { profit: p, buy: b, sell: s, modeAware };
                    }
                }
            }
            const published = profit(vals[id], modes[id], 0.5 * rest, 1.25 * rest, overhead, false);
            table.entries[`${bankLevel}/${overhead}/${id}`] = { buy: best.buy, sell: best.sell, modeAware: best.modeAware, profitPerTick: +best.profit.toFixed(5) };
            report.push({ bankLevel, overhead, id, best: best.profit, published });
        }
    }
    process.stderr.write(`bank level ${bankLevel} done (${Math.round((Date.now() - started) / 1000)} s)\n`);
}

// Check against a fresh history the search never saw, so the table is not just fitted to noise.
let heldOut = { ours: 0, published: 0 };
for (const bankLevel of [1, 5]) {
    const { vals, modes } = history(bankLevel, 99999 + bankLevel);
    for (let id = 0; id < GOODS; id++) {
        const e = table.entries[`${bankLevel}/0.05/${id}`];
        const rest = restingValue(id, bankLevel);
        heldOut.ours += profit(vals[id], modes[id], e.buy * rest, e.sell * rest, 0.05, e.modeAware);
        heldOut.published += profit(vals[id], modes[id], 0.5 * rest, 1.25 * rest, 0.05, false);
    }
}
table.heldOut = { ours: +heldOut.ours.toFixed(4), published: +heldOut.published.toFixed(4) };

const out = path.join(root, 'src', 'data', 'market-thresholds.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(table) + '\n');
const sum = (key) => report.reduce((s, r) => s + r[key], 0);
console.log(`in-sample profit per tick, all goods and settings: searched ${sum('best').toFixed(3)} against the 50%/125% rule ${sum('published').toFixed(3)}`);
console.log(`held-out history (bank levels 1 and 5, 5% overhead): searched ${table.heldOut.ours} against ${table.heldOut.published}`);
console.log(`mode-aware chosen for ${Object.values(table.entries).filter((e) => e.modeAware).length} of ${Object.keys(table.entries).length} entries; wrote ${path.relative(root, out)}`);
