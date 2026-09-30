import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payback, rankCandidates, chooseReserve, decide } from '../../src/core/buyer.js';

const income = { total: 100, basket: 1000 };

test('payback is time to afford plus time to repay', () => {
    assert.equal(payback({ price: 1000, deltaIncome: 10, income: 100, bank: 0 }), 10 + 100);
    assert.equal(payback({ price: 1000, deltaIncome: 10, income: 100, bank: 5000 }), 100, 'a bank that covers the price has no wait');
    assert.equal(payback({ price: 1000, deltaIncome: 0, income: 100, bank: 0 }), Infinity);
    assert.equal(payback({ price: 1000, deltaIncome: -5, income: 100, bank: 0 }), Infinity);
});

test('ranks by payback, then by the larger gain', () => {
    const candidates = [
        { key: 'a', price: 1000 },
        { key: 'b', price: 100 },
        { key: 'c', price: 100 },
        { key: 'd', price: 50 },
    ];
    const measured = [{ total: 200 }, { total: 105 }, { total: 110 }, { total: 100 }];
    const ranked = rankCandidates({ candidates, measured, income, bank: 0 });
    assert.deepEqual(ranked.map((c) => c.key), ['c', 'a', 'b', 'd']);
    assert.equal(ranked[3].payback, Infinity);
    assert.equal(ranked[0].deltaIncome, 10);
});

test('a discount counts as the share of income it saves', () => {
    const candidates = [{ key: 'faberge', price: 500 }];
    const measured = [{ total: 100, basket: 990 }];
    const [c] = rankCandidates({ candidates, measured, income, bank: 0 });
    assert.ok(Math.abs(c.deltaIncome - 1) < 1e-9, 'one percent of income');
    assert.ok(Number.isFinite(c.payback));
});

test('a chain is judged on its whole price and whole gain', () => {
    const candidates = [
        { key: 'chain', kind: 'chain', price: 3000, steps: 3 },
        { key: 'single', kind: 'building', price: 1000 },
    ];
    const measured = [{ total: 200 }, { total: 120 }];
    const ranked = rankCandidates({ candidates, measured, income, bank: 0 });
    assert.equal(ranked[0].key, 'chain'); // 30 + 30 = 60 against 10 + 50 = 60, chain wins on the larger gain
});

test('the reserve is kept only when it pays back as fast as the best purchase', () => {
    const reserves = [
        { amount: 0, incomeAt: 100 },
        { amount: 600000, incomeAt: 250 }, // pays back in 4000 s
        { amount: 4200000, incomeAt: 400 }, // pays back in 14000 s
    ];
    assert.equal(chooseReserve({ best: { payback: 5000 }, reserves, income }), 600000);
    assert.equal(chooseReserve({ best: { payback: 20000 }, reserves, income }), 4200000);
    assert.equal(chooseReserve({ best: { payback: 100 }, reserves, income }), 0);
    assert.equal(chooseReserve({ best: null, reserves, income }), 4200000, 'with nothing to buy, keep the largest');
});

test('a reserve that does not raise income is never kept', () => {
    const reserves = [{ amount: 600000, incomeAt: 100 }];
    assert.equal(chooseReserve({ best: null, reserves, income }), 0);
});

test('decide buys the best only when the bank covers it and the reserve', () => {
    const ranked = [
        { key: 'best', price: 1000, payback: 10 },
        { key: 'cheap', price: 10, payback: 20 },
    ];
    assert.equal(decide({ ranked, reserve: 0, bank: 1000 }).key, 'best');
    assert.equal(decide({ ranked, reserve: 0, bank: 999 }), null, 'waits rather than buying the worse deal');
    assert.equal(decide({ ranked, reserve: 500, bank: 1200 }), null, 'the reserve is not spent');
    assert.equal(decide({ ranked, reserve: 500, bank: 1500 }).key, 'best');
});

test('decide skips candidates with no gain', () => {
    const ranked = [
        { key: 'useless', price: 1, payback: Infinity },
    ];
    assert.equal(decide({ ranked, reserve: 0, bank: 1e9 }), null);
});
