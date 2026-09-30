import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    OFFICES,
    storage,
    tradeReturn,
    shareIncome,
    officeIncome,
    overhead,
    brokerIncome,
    brokerWorthHiring,
    expectedRunLeft,
    marketBudget,
} from '../../src/core/bank.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

test('the office costs and Cursor levels are the game\'s', () => {
    // minigameMarket.js:291-298
    assert.deepEqual(
        OFFICES.map((o) => [o.cursors, o.level]),
        [[100, 2], [200, 4], [350, 8], [500, 10], [700, 12]]
    );
});

test('storage follows the game: +25, +50, +75, +100 by office, then half again of the highest count', () => {
    // minigameMarket.js:194-202, for a good whose building peaked at 50 and is level 3.
    const at = (officeLevel) => storage({ highest: 50, level: 3, officeLevel });
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(at), [80, 105, 155, 230, 330, 355]);
    assert.equal(storage({ highest: 51, level: 0, officeLevel: 5 }), Math.ceil(51 * 1.5 + 250), 'rounded up like the game');
});

test('a trade returns its profit over the money it ties up, per second', () => {
    // $0.15 a tick on $3 held: 5% a minute.
    assert.ok(close(tradeReturn({ profitPerTick: 0.15, heldPerTick: 3 }), 0.05 / 60));
    assert.equal(tradeReturn({ profitPerTick: 0.15, heldPerTick: 0 }), 0);
});

test('a share of storage earns its profit, less what its money would earn in the buyer', () => {
    const good = { profitPerTick: 0.15, heldPerTick: 3 };
    // With nothing better to buy, a share earns $0.15 a minute: 0.0025 of raw CpS a second.
    assert.ok(close(shareIncome(good, { rawCps: 100, buyerReturn: 0 }), 0.15 * 100 / 60));
    // A purchase repaying in 2400 s returns 1/2400 a second: the $3 held would earn $0.075 a
    // minute there, so the share adds only the other $0.075.
    assert.ok(close(shareIncome(good, { rawCps: 100, buyerReturn: 1 / 2400 }), 0.075 * 100 / 60));
    // A purchase repaying faster than the trade leaves the share worth nothing, never less.
    assert.equal(shareIncome(good, { rawCps: 100, buyerReturn: 1 / 600 }), 0);
});

test('a share bought in seconds of CpS and sold in seconds of CpS gains as CpS grows', () => {
    // Goods are bought and sold at the highest raw CpS of the run (minigameMarket.js:211, 252), so
    // money held in stock grows with it. At 1/2400 a second of growth the $3 held adds $0.075 a
    // minute, which pays for a purchase returning the same.
    const good = { profitPerTick: 0.15, heldPerTick: 3 };
    assert.ok(close(shareIncome(good, { rawCps: 100, buyerReturn: 1 / 2400, growth: 1 / 2400 }), 0.15 * 100 / 60));
    assert.ok(close(tradeReturn(good, 1e-4), 0.05 / 60 + 1e-4));
});

test('an office adds each active good\'s extra storage at what a share earns, scaled by how often the room is filled', () => {
    const goods = [
        { highest: 50, level: 3, profitPerTick: 0.15, heldPerTick: 3 },
        { highest: 20, level: 0, profitPerTick: 0.3, heldPerTick: 6 },
    ];
    const perShare = goods.map((g) => shareIncome(g, { rawCps: 10, buyerReturn: 0 }));
    // Office 0 to 1 adds 25 shares of each; 4 to 5 adds half again of each highest count.
    assert.ok(close(officeIncome({ goods, officeLevel: 0, rawCps: 10, buyerReturn: 0 }), 25 * perShare[0] + 25 * perShare[1]));
    assert.ok(close(officeIncome({ goods, officeLevel: 4, rawCps: 10, buyerReturn: 0 }), 25 * perShare[0] + 10 * perShare[1]));
    assert.ok(close(officeIncome({ goods, officeLevel: 0, rawCps: 10, buyerReturn: 0, fill: 0.5 }), 12.5 * (perShare[0] + perShare[1])));
    assert.equal(officeIncome({ goods, officeLevel: 0, rawCps: 10, buyerReturn: 0, fill: 0 }), 0, 'a market that cannot fill its room gains nothing');
    assert.equal(officeIncome({ goods, officeLevel: 5, rawCps: 10, buyerReturn: 0 }), 0, 'there is no office after the fifth');
});

test('overhead is 20% × 0.95 per broker, and a broker saves the overhead it removes on the buy volume', () => {
    // minigameMarket.js:211-212
    assert.ok(close(overhead(0), 0.2));
    assert.ok(close(overhead(10), 0.2 * Math.pow(0.95, 10)));
    // The first broker takes 1% off: $1000 of buying a second saves $10 a second, at 5 cookies per $.
    assert.ok(close(brokerIncome({ brokers: 0, buyVolume: 1000, rawCps: 5 }), 0.01 * 1000 * 5));
    assert.ok(close(brokerIncome({ brokers: 3, buyVolume: 1000, rawCps: 5 }), 0.01 * Math.pow(0.95, 3) * 1000 * 5));
    assert.equal(brokerIncome({ brokers: 0, buyVolume: 0, rawCps: 5 }), 0);
});

test('the run is expected to last as long again as it has, and at least another hour', () => {
    assert.equal(expectedRunLeft(0), 3600);
    assert.equal(expectedRunLeft(1800), 3600);
    assert.equal(expectedRunLeft(5 * 3600), 5 * 3600);
});

test('a broker is hired only when it repays inside the time the run is expected to have left', () => {
    // Brokers are dismissed at every ascension (minigameMarket.js:767-768).
    assert.equal(brokerWorthHiring({ price: 1200, income: 1, runSeconds: 600 }), true, '1200 s against an hour');
    assert.equal(brokerWorthHiring({ price: 7200, income: 1, runSeconds: 600 }), false, 'two hours against one');
    assert.equal(brokerWorthHiring({ price: 7200, income: 1, runSeconds: 4 * 3600 }), true, 'two hours against four');
    assert.equal(brokerWorthHiring({ price: 1200, income: 0, runSeconds: 1e9 }), false, 'saves nothing');
});

test('the market spends above the reserve and what the buyer is saving for, unless a trade out-earns that purchase', () => {
    const base = { bank: 1000, reserve: 300, committed: 500 };
    assert.equal(marketBudget({ ...base, tradeReturn: 1e-4, buyerReturn: 1e-3 }), 200, 'the saving is kept for a better purchase');
    assert.equal(marketBudget({ ...base, tradeReturn: 1e-3, buyerReturn: 1e-4 }), 700, 'a better trade may use the saving');
    assert.equal(marketBudget({ ...base, tradeReturn: 1, buyerReturn: 0 }), 700, 'never the reserve');
    assert.equal(marketBudget({ bank: 200, reserve: 300, committed: 0, tradeReturn: 1, buyerReturn: 0 }), 0, 'nothing below the reserve');
});
