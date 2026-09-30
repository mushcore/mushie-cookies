import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeLayout, agePerTick, plantNow, expectedUnlock } from '../../src/core/garden.js';
import { findRecipes, findRecipe, chanceFunction, chooseSoil, soilFor } from '../../src/game/garden.js';

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
    // Like clover: two mature clovers breed more, but not with five or more around. A 4×4 plot
    // has 2^16 layouts, few enough to score them all and know the true best.
    const tiles = grid(4, 4);
    const chance = (c) => ((c.c || 0) >= 2 && (c.c || 0) < 5 ? 0.007 : 0);
    const scoreOf = (layout) => layout.reduce((sum, p, i) => sum + (p === null ? chance(neighboursOf(tiles, layout, i)) : 0), 0);
    let optimum = 0;
    for (let mask = 0; mask < 1 << tiles.length; mask++) optimum = Math.max(optimum, scoreOf(tiles.map((t, i) => (mask & (1 << i) ? 'c' : null))));

    // The limit matters here: the best layout for "two or more" crowds some empty tiles.
    const crowded = optimizeLayout({ tiles, parents: ['c'], chance: (c) => ((c.c || 0) >= 2 ? 0.007 : 0) });
    assert.ok(scoreOf(crowded.layout) < optimum - 1e-12, 'fixture: ignoring the limit loses tiles');

    const { layout, score } = optimizeLayout({ tiles, parents: ['c'], chance });
    assert.ok(Math.abs(score - scoreOf(layout)) < 1e-12, `reported ${score}, real ${scoreOf(layout)}`);
    assert.ok(Math.abs(score - optimum) < 1e-12, `${score} against the best possible ${optimum}`);
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

// Cost and time of a plan.

const plan = (over = {}) => ({ score: 0.05, cost: 1000, replantCost: 1000, growTicks: 10, windowTicks: Infinity, growSeconds: 180, waitSeconds: 300, budgetRate: 1e9, ...over });

test('a layout that cannot produce the target is never worth planting', () => {
    assert.deepEqual(expectedUnlock(plan({ score: 0 })), { cost: Infinity, seconds: Infinity });
});

test('immortal parents are paid for once; the wait is growing plus the expected ticks to a mutation', () => {
    const out = expectedUnlock(plan());
    assert.equal(out.cost, 1000);
    assert.equal(out.seconds, 10 * 180 + (1 / 0.05) * 300);
});

test('parents that die before a mutation lands are paid for again', () => {
    // 1 - e^(-0.05 × 10) of plantings succeed, so 1 / that many are needed on average.
    const out = expectedUnlock(plan({ windowTicks: 10, cost: 600 }));
    const plantings = 1 / (1 - Math.exp(-0.5));
    assert.ok(Math.abs(out.cost - (600 + 1000 * (plantings - 1))) < 1e-9, String(out.cost));
    assert.ok(out.cost > 600);
    assert.ok(out.seconds > expectedUnlock(plan()).seconds, 'failed plantings take time too');
});

test('when seed money is the bottleneck, the time is what the budget takes to pay for the seeds', () => {
    const out = expectedUnlock(plan({ budgetRate: 0.01 }));
    assert.equal(out.seconds, 1000 / 0.01);
    // Of two equally likely plans, the cheaper one is sooner.
    assert.ok(expectedUnlock(plan({ budgetRate: 0.01, cost: 100, replantCost: 100 })).seconds < out.seconds);
    // Plants already in place cost nothing more.
    assert.equal(expectedUnlock(plan({ budgetRate: 0.01, cost: 0 })).seconds, 10 * 180 + 20 * 300);
});

// Recipes, asked of a small stand-in for the game's mutation table.

function fakeGarden(unlocked) {
    const costs = { wheat: 1, corn: 5, rice: 15, gold: 60, lily: 1 };
    const plants = {};
    Object.keys(costs).forEach((key, id) => (plants[key] = { key, id, cost: costs[key], unlocked: unlocked.includes(key) ? 1 : 0, plantable: true }));
    const M = { plants, calls: 0 };
    M.getMuts = (neighs, neighsM) => {
        M.calls++;
        const muts = [];
        if (neighsM.wheat >= 2) muts.push(['corn', 0.05]);
        if (neighsM.wheat >= 1 && neighsM.corn >= 1) muts.push(['rice', 0.01]);
        if (neighsM.corn >= 1 && neighsM.rice >= 1) muts.push(['gold', 0.03]);
        if (neighsM.lily >= 3) muts.push(['gold', 0.01]);
        if (neighsM.lily >= 1 && neighs.lily <= 4) muts.push(['lily', 0.2]);
        return muts;
    };
    return M;
}

test('recipes for every target come from one pass over the plantable seeds, and are kept until a seed unlocks', () => {
    const M = fakeGarden(['wheat', 'corn']);
    const first = findRecipes(M);
    assert.deepEqual(first.corn[0].parents, ['wheat']);
    assert.deepEqual([...first.rice[0].parents].sort(), ['corn', 'wheat']);
    assert.equal(first.gold, undefined, 'no recipe from what can be planted');
    const calls = M.calls;
    findRecipes(M);
    assert.equal(M.calls, calls, 'the same seeds: nothing is asked again');
    M.plants.rice.unlocked = 1;
    assert.deepEqual([...findRecipes(M).gold[0].parents].sort(), ['corn', 'rice']);
    assert.ok(M.calls > calls, 'a new seed: asked again');
    assert.deepEqual(findRecipe(M, 'gold'), findRecipes(M).gold[0]);
});

test('a recipe whose parents are cheaper per unit of chance is offered beside the likeliest one', () => {
    // gold: corn + rice at 3% costs 20 minutes of CpS for one tile; three lilies at about 1% cost 3.
    const M = fakeGarden(['wheat', 'corn', 'rice', 'lily']);
    const gold = findRecipes(M).gold;
    assert.deepEqual([...gold[0].parents].sort(), ['corn', 'rice'], 'the likeliest first');
    assert.ok(gold.some((r) => r.parents.length === 1 && r.parents[0] === 'lily'), JSON.stringify(gold));
});

test('the chance function gives the same answer however often it is asked', () => {
    const M = fakeGarden(['wheat', 'corn', 'rice']);
    const reused = chanceFunction(M, 'rice');
    const a = reused({ wheat: 1, corn: 1 });
    reused({ wheat: 8 });
    assert.equal(reused({ corn: 1 }), 0, 'nothing is left over from the question before');
    assert.equal(reused({ wheat: 1, corn: 1 }), a);
    assert.equal(a, chanceFunction(M, 'rice')({ wheat: 1, corn: 1 }));
});

// Soil.

function fakeSoils({ soil = 'dirt', farms = 400, cooldown = false } = {}) {
    const soils = { dirt: { id: 0, req: 0 }, fertilizer: { id: 1, req: 50 }, clay: { id: 2, req: 100 }, pebbles: { id: 3, req: 200 }, woodchips: { id: 4, req: 300 } };
    const M = { soils, soil: soils[soil].id, nextSoil: cooldown ? Date.now() + 600000 : 0, freeze: 0, parent: { amount: farms }, clicks: 0 };
    const buttons = {};
    for (const s of Object.values(soils)) {
        buttons['gardenSoil-' + s.id] = {
            click() {
                // The game's handler (minigameGarden.js:1349-1355).
                if (M.freeze || M.soil === s.id || M.nextSoil > Date.now() || M.parent.amount < s.req) return;
                M.clicks++;
                M.soil = s.id;
                M.nextSoil = Date.now() + 600000;
            },
        };
    }
    return { M, document: { getElementById: (id) => buttons[id] || null } };
}

test('the wanted soil already in use is success, with no click', () => {
    const { M, document } = fakeSoils({ soil: 'woodchips' });
    globalThis.document = document;
    try {
        assert.equal(chooseSoil(M, 'woodchips'), true);
        assert.equal(M.clicks, 0);
        assert.equal(M.soil, 4);
    } finally {
        delete globalThis.document;
    }
});

test('another soil is clicked once the cooldown allows, and not before', () => {
    const { M, document } = fakeSoils({ soil: 'fertilizer' });
    globalThis.document = document;
    try {
        assert.equal(chooseSoil(M, 'woodchips'), true);
        assert.equal(M.soil, 4);
        assert.equal(chooseSoil(M, 'fertilizer'), false, 'ten minutes must pass');
        assert.equal(M.soil, 4);
        assert.equal(M.clicks, 1);
    } finally {
        delete globalThis.document;
    }
});

test('the first soil the farms unlock is wanted; a soil in use is never a reason to fall back', () => {
    assert.equal(soilFor(fakeSoils({ farms: 400 }).M, ['woodchips', 'fertilizer', 'dirt']), 'woodchips');
    assert.equal(soilFor(fakeSoils({ farms: 120 }).M, ['woodchips', 'fertilizer', 'dirt']), 'fertilizer');
    assert.equal(soilFor(fakeSoils({ farms: 10 }).M, ['woodchips', 'fertilizer', 'dirt']), 'dirt');
    assert.equal(soilFor(fakeSoils({ farms: 400, soil: 'woodchips', cooldown: true }).M, ['woodchips', 'fertilizer']), 'woodchips');
});
