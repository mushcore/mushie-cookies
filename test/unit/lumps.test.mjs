import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLevelUp } from '../../src/core/lumps.js';

const building = (name, over = {}) => ({ name, level: 0, amount: 10, share: 0.05, ...over });
const bakery = (over = {}) =>
    ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower'].map((name) => building(name, over[name] || {}));

test('minigames are unlocked first, in order, and only for buildings that are owned', () => {
    assert.equal(nextLevelUp({ buildings: bakery(), lumps: 1, sugarBaking: false }).name, 'Wizard tower');
    const noTowers = bakery({ 'Wizard tower': { amount: 0 } });
    assert.equal(nextLevelUp({ buildings: noTowers, lumps: 1, sugarBaking: false }).name, 'Temple');
});

test('then the Farm to 9 and the Cursor to 12', () => {
    const minigamesDone = { 'Wizard tower': { level: 1 }, Temple: { level: 1 }, Farm: { level: 1 }, Bank: { level: 1 } };
    const out = nextLevelUp({ buildings: bakery(minigamesDone), lumps: 5, sugarBaking: false });
    assert.deepEqual([out.name, out.cost], ['Farm', 2]);
    const farmDone = { ...minigamesDone, Farm: { level: 9 } };
    const cursor = nextLevelUp({ buildings: bakery(farmDone), lumps: 5, sugarBaking: false });
    assert.deepEqual([cursor.name, cursor.cost], ['Cursor', 1]);
});

test('a level it cannot afford yet is waited for, not skipped', () => {
    const state = { 'Wizard tower': { level: 1 }, Temple: { level: 1 }, Farm: { level: 5 }, Bank: { level: 1 } };
    assert.equal(nextLevelUp({ buildings: bakery(state), lumps: 5, sugarBaking: false }), null, 'Farm 6 costs 6');
});

test('after the targets, the building with the best CpS gain per lump', () => {
    const done = {
        'Wizard tower': { level: 1 }, Temple: { level: 1 }, Farm: { level: 9 }, Bank: { level: 1 }, Cursor: { level: 12 },
        Grandma: { share: 0.4 }, Mine: { share: 0.2, level: 0 },
    };
    const out = nextLevelUp({ buildings: bakery(done), lumps: 10, sugarBaking: false });
    assert.equal(out.name, 'Grandma');
    // A level-3 Grandma costs 4 lumps: 0.4/4 = 0.1 per lump, against the Mine's 0.2/1.
    const later = nextLevelUp({ buildings: bakery({ ...done, Grandma: { share: 0.4, level: 3 } }), lumps: 10, sugarBaking: false });
    assert.equal(later.name, 'Mine');
});

test('with Sugar baking, a hundred lumps are held and only the excess is spent', () => {
    const done = { 'Wizard tower': { level: 1 }, Temple: { level: 1 }, Farm: { level: 9 }, Bank: { level: 1 }, Cursor: { level: 12 } };
    assert.equal(nextLevelUp({ buildings: bakery(done), lumps: 100, sugarBaking: true }), null);
    assert.ok(nextLevelUp({ buildings: bakery(done), lumps: 101, sugarBaking: true }));
    assert.ok(nextLevelUp({ buildings: bakery(done), lumps: 2, sugarBaking: false }), 'without Sugar baking nothing is held');
});

test('the guard alone holds a jar for Sugar baking but lets the community targets go first', () => {
    const minigamesDone = { 'Wizard tower': { level: 1 }, Temple: { level: 1 }, Farm: { level: 1 }, Bank: { level: 1 } };
    const out = nextLevelUp({ buildings: bakery(minigamesDone), lumps: 50, sugarBaking: false, guard: true });
    assert.equal(out.name, 'Farm');
    const done = { ...minigamesDone, Farm: { level: 9 }, Cursor: { level: 12 } };
    assert.equal(nextLevelUp({ buildings: bakery(done), lumps: 100, sugarBaking: false, guard: true }), null);
    assert.ok(nextLevelUp({ buildings: bakery(done), lumps: 101, sugarBaking: false, guard: true }));
});

test('once Sugar baking is owned, the Farm and Cursor targets respect the hold too', () => {
    // Defect: with Sugar baking owned the targets spent up to 44 + 78 lumps below 100, each lump
    // costing 1/(100 + L) of all CpS until it grew back (main.js:5095).
    const minigamesDone = { 'Wizard tower': { level: 1 }, Temple: { level: 1 }, Farm: { level: 1 }, Bank: { level: 1 } };
    assert.equal(nextLevelUp({ buildings: bakery(minigamesDone), lumps: 100, sugarBaking: true }), null, 'Farm 2 would leave 98');
    assert.equal(nextLevelUp({ buildings: bakery(minigamesDone), lumps: 101, sugarBaking: true }), null, 'Farm 2 costs 2: 99 left');
    assert.deepEqual(
        (({ name, cost }) => ({ name, cost }))(nextLevelUp({ buildings: bakery(minigamesDone), lumps: 102, sugarBaking: true })),
        { name: 'Farm', cost: 2 }
    );
    const farmDone = { ...minigamesDone, Farm: { level: 9 } };
    assert.equal(nextLevelUp({ buildings: bakery(farmDone), lumps: 100, sugarBaking: true }), null, 'Cursor 1 would leave 99');
    assert.equal(nextLevelUp({ buildings: bakery(farmDone), lumps: 101, sugarBaking: true }).name, 'Cursor');
});

test('the four minigame unlocks are never held: a lump each opens a whole minigame', () => {
    assert.equal(nextLevelUp({ buildings: bakery(), lumps: 1, sugarBaking: true }).name, 'Wizard tower');
    assert.equal(nextLevelUp({ buildings: bakery({ 'Wizard tower': { level: 1 } }), lumps: 50, sugarBaking: true, guard: true }).name, 'Temple');
});

test('nothing owned, nothing to level', () => {
    const empty = bakery(Object.fromEntries(['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower'].map((n) => [n, { amount: 0 }])));
    assert.equal(nextLevelUp({ buildings: empty, lumps: 500, sugarBaking: false }), null);
});
