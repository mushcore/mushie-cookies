import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeLayout, agePerTick, plantNow } from '../../src/core/garden.js';

const grid = (w, h) => {
    const out = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push({ x, y });
    return out;
};
const neighboursOf = (tiles, layout, i) => {
    const t = tiles[i];
    const counts = {};
    tiles.forEach((u, j) => {
        if (j !== i && Math.abs(u.x - t.x) <= 1 && Math.abs(u.y - t.y) <= 1 && layout[j]) counts[layout[j]] = (counts[layout[j]] || 0) + 1;
    });
    return counts;
};

test('a two-parent recipe gets a layout where empty tiles touch both parents', () => {
    const tiles = grid(6, 6);
    const chance = (c) => ((c.a || 0) >= 1 && (c.b || 0) >= 1 ? 0.01 : 0);
    const { layout, score } = optimizeLayout({ tiles, parents: ['a', 'b'], chance });
    const empty = layout.map((p, i) => (p === null ? i : -1)).filter((i) => i >= 0);
    const productive = empty.filter((i) => chance(neighboursOf(tiles, layout, i)) > 0);
    assert.ok(productive.length >= 16, `only ${productive.length} productive tiles`);
    assert.ok(Math.abs(score - productive.length * 0.01) < 1e-9);
    assert.ok(layout.includes('a') && layout.includes('b'));
});

test('a recipe needing eight of one parent gets a ring around an empty tile', () => {
    const tiles = grid(3, 3);
    const chance = (c) => ((c.q || 0) >= 8 ? 0.001 : 0);
    const { layout, score } = optimizeLayout({ tiles, parents: ['q'], chance });
    assert.equal(score, 0.001);
    assert.equal(layout[4], null, 'the centre is left empty');
    assert.equal(layout.filter((p) => p === 'q').length, 8);
});

test('an upper limit on a parent is respected through the chance function', () => {
    // Like clover: two mature clovers breed more, but not with five or more around.
    const tiles = grid(4, 4);
    const chance = (c) => ((c.c || 0) >= 2 && (c.c || 0) < 5 ? 0.007 : 0);
    const { layout } = optimizeLayout({ tiles, parents: ['c'], chance });
    layout.forEach((p, i) => {
        if (p === null) {
            const n = neighboursOf(tiles, layout, i).c || 0;
            assert.ok(n < 5 || chance({ c: n }) === 0);
        }
    });
});

test('the same inputs give the same layout', () => {
    const tiles = grid(5, 5);
    const chance = (c) => ((c.a || 0) >= 1 && (c.b || 0) >= 1 ? 0.03 : 0);
    const a = optimizeLayout({ tiles, parents: ['a', 'b'], chance, seed: 7 });
    const b = optimizeLayout({ tiles, parents: ['a', 'b'], chance, seed: 7 });
    assert.deepEqual(a, b);
});

test('a plot with missing tiles is handled', () => {
    const tiles = grid(4, 4).filter((t) => !(t.x === 0 && t.y === 0));
    const chance = (c) => ((c.a || 0) >= 1 ? 0.05 : 0);
    const { layout } = optimizeLayout({ tiles, parents: ['a'], chance });
    assert.equal(layout.length, 15);
});

test('age per tick is the base plus half the random extra', () => {
    assert.equal(agePerTick({ ageTick: 7, ageTickR: 2 }), 8);
    assert.equal(agePerTick({ ageTick: 0.4, ageTickR: 0.7 }, 1.05), (0.4 + 0.35) * 1.05);
});

test('the slowest parent is planted first and the faster one waits until it would catch up', () => {
    const slots = [
        { key: 'slow', planted: false, ticksLeft: 70 },
        { key: 'fast', planted: false, ticksLeft: 5 },
    ];
    assert.deepEqual([...plantNow(slots)], ['slow']);
    const later = [
        { key: 'slow', planted: true, ticksLeft: 5 },
        { key: 'fast', planted: false, ticksLeft: 5 },
    ];
    assert.deepEqual([...plantNow(later)], ['fast']);
    const both = [
        { key: 'a', planted: false, ticksLeft: 20 },
        { key: 'b', planted: false, ticksLeft: 20 },
    ];
    assert.deepEqual([...plantNow(both)].sort(), ['a', 'b']);
});
