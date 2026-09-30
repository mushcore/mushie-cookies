import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankHeavenly, planChips } from '../../src/core/heavenly.js';

const income = { total: 1000 };
const after = (mult) => ({ total: 1000 * mult });

test('ranks by income share per chip', () => {
    const candidates = [
        { id: 1, name: 'Heavenly cookies', price: 3 },
        { id: 2, name: 'Kitten angels', price: 9000 },
        { id: 3, name: 'Heavenly key', price: 25000000 },
    ];
    const measured = [after(1.1), after(1.5), after(1.25)];
    const ranked = rankHeavenly({ candidates, measured, income });
    assert.deepEqual(ranked.map((c) => c.name), ['Heavenly cookies', 'Kitten angels', 'Heavenly key']);
    assert.ok(Math.abs(ranked[0].share - 0.1) < 1e-9);
    assert.ok(Math.abs(ranked[0].valuePerChip - 0.1 / 3) < 1e-9);
});

test('enablers the model cannot see get their fixed share, and Legacy comes first', () => {
    const candidates = [
        { id: 1, name: 'Legacy', price: 1 },
        { id: 2, name: 'Heavenly cookies', price: 3 },
        { id: 3, name: 'How to bake your dragon', price: 9 },
        { id: 4, name: 'Twin Gates of Transcendence', price: 1 },
    ];
    const measured = [after(1), after(1.1), after(1), after(1)];
    const ranked = rankHeavenly({ candidates, measured, income });
    assert.equal(ranked[0].name, 'Legacy');
    assert.ok(ranked.find((c) => c.name === 'How to bake your dragon').share > 0);
    assert.ok(ranked.find((c) => c.name === 'Twin Gates of Transcendence').valuePerChip < ranked[1].valuePerChip);
});

test('a measured share beats the fixed one when it is larger', () => {
    const candidates = [{ id: 1, name: 'How to bake your dragon', price: 9 }];
    const [c] = rankHeavenly({ candidates, measured: [after(3)], income });
    assert.ok(Math.abs(c.share - 2) < 1e-9);
});

test('planChips buys down the ranking while chips last', () => {
    const ranked = [
        { id: 1, name: 'a', price: 1, valuePerChip: 10 },
        { id: 2, name: 'b', price: 3, valuePerChip: 5 },
        { id: 3, name: 'c', price: 9, valuePerChip: 1 },
        { id: 4, name: 'd', price: 25, valuePerChip: 0.5 },
    ];
    const plan = planChips({ ranked, chips: 40 });
    assert.deepEqual(plan.buy.map((c) => c.name), ['a', 'b', 'c', 'd']);
    assert.equal(plan.left, 2);
    assert.equal(plan.saving, null);
});

test('saves for an unaffordable item that is far better than the rest', () => {
    const ranked = [
        { id: 1, name: 'cheap', price: 1, valuePerChip: 10 },
        { id: 2, name: 'prize', price: 100, valuePerChip: 5 },
        { id: 3, name: 'filler', price: 3, valuePerChip: 0.5 },
    ];
    const plan = planChips({ ranked, chips: 50 });
    assert.deepEqual(plan.buy.map((c) => c.name), ['cheap']);
    assert.equal(plan.saving.name, 'prize');
    assert.equal(plan.left, 49, 'the filler is not bought while saving');
});

test('skips an unaffordable item when what follows is nearly as good', () => {
    const ranked = [
        { id: 1, name: 'big', price: 100, valuePerChip: 2 },
        { id: 2, name: 'next', price: 5, valuePerChip: 1.5 },
    ];
    const plan = planChips({ ranked, chips: 50 });
    assert.deepEqual(plan.buy.map((c) => c.name), ['next']);
    assert.equal(plan.saving, null);
});

test('items with no value are never bought or saved for', () => {
    const ranked = [
        { id: 1, name: 'useless', price: 1, valuePerChip: 0 },
        { id: 2, name: 'pricey', price: 1e9, valuePerChip: 0 },
    ];
    const plan = planChips({ ranked, chips: 1e12 });
    assert.deepEqual(plan.buy, []);
    assert.equal(plan.saving, null);
});
