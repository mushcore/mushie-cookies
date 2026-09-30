import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CRAWL_SECONDS,
    popMultiplier,
    suckRate,
    spawnChance,
    incomeMultiplier,
    gapCost,
    decidePops,
    expectedAttached,
    attachedAfter,
    halloweenFailRate,
    halloweenDrops,
    easterFailRate,
    easterDrops,
    huntDecision,
} from '../../src/core/wrinklers.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test('the pop multiplier has every factor the game applies, Dragon Guts and Skruuia included', () => {
    assert.ok(close(popMultiplier({}), 1.1));
    // main.js:14467-14479: 1.1, x1.05 Sacrilegious corruption, x1.2 Dragon Guts, x3 shiny,
    // x1.05 Wrinklerspawn, x1.15/1.1/1.05 for Skruuia in the diamond/ruby/jade slot.
    assert.ok(close(popMultiplier({ dragonGuts: 1 }), 1.1 * 1.2));
    assert.ok(close(popMultiplier({ scorn: 1 }), 1.1 * 1.15));
    assert.ok(close(popMultiplier({ scorn: 2 }), 1.1 * 1.1));
    assert.ok(close(popMultiplier({ scorn: 3 }), 1.1 * 1.05));
    const all = popMultiplier({ sacrilegious: true, wrinklerspawn: true, dragonGuts: 1, scorn: 1, shiny: true });
    assert.ok(close(all, 1.1 * 1.05 * 1.2 * 3 * 1.05 * 1.15));
});

test('each attached wrinkler withers a twentieth of CpS, a fifth more with Dragon Guts', () => {
    assert.ok(close(suckRate({}), 0.05));
    assert.ok(close(suckRate({ dragonGuts: 1 }), 0.06));
    assert.ok(close(suckRate({ wrinklerEat: 1.1 }), 0.055));
});

test('an empty slot spawns with the game chance per frame', () => {
    // main.js:14363-14373
    assert.ok(close(spawnChance({ elderWrath: 1 }), 1e-5));
    assert.ok(close(spawnChance({ elderWrath: 3, unholyBait: true }), 1.5e-4));
    assert.ok(close(spawnChance({ elderWrath: 2, scorn: 1 }), 2e-5 * 2.5));
    assert.ok(close(spawnChance({ elderWrath: 2, scorn: 3, wrinklerSpawn: 1.1 }), 2e-5 * 1.5 * 1.1));
    assert.equal(spawnChance({ elderWrath: 0, unholyBait: true }), 0);
    assert.equal(spawnChance({ elderWrath: 1, doormat: true }), 0.1);
});

test('ten fed wrinklers make six times CpS, nine make 5.005 times', () => {
    assert.ok(close(incomeMultiplier({ attached: 10, suck: 0.05, payoutSum: 11 }), 6));
    assert.ok(close(incomeMultiplier({ attached: 9, suck: 0.05, payoutSum: 9.9 }), 5.005));
    assert.equal(incomeMultiplier({ attached: 0, suck: 0.05, payoutSum: 0 }), 1);
    // The game caps the withered share at all of CpS (main.js:5128).
    assert.ok(close(incomeMultiplier({ attached: 14, suck: 0.1, payoutSum: 14 * 1.1 }), 14 * 1.1));
});

test('one pop costs the gap to the next spawn at the marginal wrinkler\'s income', () => {
    const lambda = 1 / 222; // Unholy bait at wrath 3: 1.5e-4 a frame
    const cost = gapCost({ attached: 10, count: 1, suck: 0.05, payoutSum: 11, popMult: 1.1, cps: 1000, spawnPerSecond: lambda });
    const marginal = incomeMultiplier({ attached: 10, suck: 0.05, payoutSum: 11 }) - incomeMultiplier({ attached: 9, suck: 0.05, payoutSum: 9.9 });
    assert.ok(close(cost, 1000 * marginal * (CRAWL_SECONDS + 222)), `${cost}`);
});

test('two pops cost more than one and less than two single gaps', () => {
    const args = { attached: 10, suck: 0.05, payoutSum: 11, popMult: 1.1, cps: 1000, spawnPerSecond: 1 / 222 };
    const one = gapCost({ ...args, count: 1 });
    const two = gapCost({ ...args, count: 2 });
    // Two empty slots refill in parallel; the second-marginal wrinkler is cheaper (convexity),
    // but both gaps are paid.
    assert.ok(two > one && two < 2 * one, `one ${one}, two ${two}`);
    // Exact: crawl*[f(10)-f(8)] + [f(10)-f(9)]/λ + [f(10)-f(8)]/(2λ).
    const f = (n) => incomeMultiplier({ attached: n, suck: 0.05, payoutSum: n * 1.1 });
    const expected = 1000 * (CRAWL_SECONDS * (f(10) - f(8)) + 222 * (f(10) - f(9)) + 111 * (f(10) - f(8)));
    assert.ok(close(two, expected), `${two} vs ${expected}`);
    assert.equal(gapCost({ ...args, count: 0 }), 0);
    assert.equal(gapCost({ ...args, count: 1, spawnPerSecond: 0 }), Infinity, 'no spawns: a popped slot stays empty');
});

// A bakery at 10/10 wrinklers, Unholy bait at wrath 3, 1000 CpS: each attached wrinkler holds
// its share of payout; one pop costs about 1000 * 1.0 * 232 s = 232,000 cookies of feeding.
const bakery = (over = {}) => ({
    candidates: Array.from({ length: 10 }, (_, i) => ({ id: i, payout: 2e6 - i * 1e5, shiny: false })),
    attached: 10,
    payoutSum: 11,
    popMult: 1.1,
    suck: 0.05,
    cps: 1000,
    bank: 0,
    price: 1e6,
    reserve: 0,
    deltaIncome: 100,
    liquidIncome: 500,
    spawnPerSecond: 1 / 222,
    ...over,
});

test('nothing is popped when the next purchase is already affordable', () => {
    const out = decidePops(bakery({ bank: 2e6, price: 1e6 }));
    assert.deepEqual(out.pop, []);
    assert.equal(out.reason, 'affordable');
});

test('the fattest wrinkler is popped when buying sooner is worth more than the lost feeding', () => {
    // Waiting: 1e6 / 500 = 2000 s; buying now gains 100 * 2000 = 200,000... below 232,000.
    assert.deepEqual(decidePops(bakery()).pop, [], 'a gain below the lost feeding is not taken');
    // With twice the income gain it is.
    const out = decidePops(bakery({ deltaIncome: 200 }));
    assert.deepEqual(out.pop, [0]);
});

test('a cheap purchase the bank reaches in seconds is not worth a pop', () => {
    const out = decidePops(bakery({ price: 1e4, deltaIncome: 50 }));
    assert.deepEqual(out.pop, []);
});

test('a protected shiny as the fattest does not stop the others from being popped', () => {
    const candidates = bakery().candidates.map((c) => ({ ...c }));
    candidates[0] = { id: 0, payout: 9e6, shiny: true };
    const out = decidePops(bakery({ candidates, deltaIncome: 400 }));
    assert.ok(out.pop.length > 0, 'something should be popped');
    assert.ok(!out.pop.includes(0), 'never the shiny');
    assert.deepEqual(out.pop, [1]);
});

test('below the maximum it still pops when worth it, and pops several when one is not enough', () => {
    const candidates = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ id: i, payout: 4e5, shiny: false }));
    // 7 of 10 attached; the next purchase needs 1e6: three wrinklers cover it, and the wait
    // without them (1e6 / 500 = 2000 s) at 2000 income is worth 4e6.
    const out = decidePops(bakery({ candidates, attached: 7, payoutSum: 7.7, deltaIncome: 2000 }));
    assert.deepEqual(out.pop.slice().sort(), [0, 1, 2]);
});

test('it waits for one wrinkler to grow rather than pop two now when that is cheaper', () => {
    // Two cover the need now; the fattest alone covers it in (1e6 - 9.9e5) / (500 + 550) ≈ 9.5 s.
    const candidates = [{ id: 0, payout: 9.9e5 }, { id: 1, payout: 9e5 }, { id: 2, payout: 1e5 }];
    const out = decidePops(bakery({ candidates, deltaIncome: 400 }));
    assert.deepEqual(out.pop, []);
    assert.equal(out.reason, 'waiting');
});

test('only the wrinklers it is given are ever chosen', () => {
    const out = decidePops(bakery({ candidates: [{ id: 7, payout: 5e6 }], deltaIncome: 1000 }));
    assert.deepEqual(out.pop, [7]);
    assert.deepEqual(decidePops(bakery({ candidates: [], deltaIncome: 1000 })).pop, []);
});

test('with no next purchase nothing is popped', () => {
    assert.deepEqual(decidePops(bakery({ price: Infinity })).pop, []);
    assert.deepEqual(decidePops(bakery({ deltaIncome: 0 })).pop, []);
});

test('the expected attached count follows the popping and the refill', () => {
    const lambda = 1 / 1111; // wrath 3, no bait
    // Steady state: pops at rate R leave R * (crawl + 1/λ) slots empty on average (Little's law).
    const steady = expectedAttached({ max: 10, now: 10, popRate: 3 / 3600, spawnPerSecond: lambda, horizon: Infinity });
    assert.ok(close(steady, 10 - (3 / 3600) * (CRAWL_SECONDS + 1111), 1e-6), `${steady}`);
    // Nobody pops: all slots stay full.
    assert.equal(expectedAttached({ max: 10, now: 10, popRate: 0, spawnPerSecond: lambda }), 10);
    // Just after wrath begins: none attached, and at wrath 1 a slot takes ~55 minutes to fill,
    // so the next hour averages well under the maximum.
    const early = expectedAttached({ max: 10, now: 0, popRate: 0, spawnPerSecond: 3e-4, horizon: 3600 });
    assert.ok(early > 3 && early < 4.5, `${early}`);
    // No spawning at all: what is attached is all there is.
    assert.equal(expectedAttached({ max: 10, now: 4, popRate: 0, spawnPerSecond: 0 }), 4);
    assert.equal(expectedAttached({ max: 10, now: 0, popRate: 1, spawnPerSecond: lambda, horizon: Infinity }), 0, 'never negative');
});

test('the attached count some seconds on follows the refill that the expected count averages', () => {
    const lambda = 1 / 1111;
    const steady = expectedAttached({ max: 10, now: 10, popRate: 3 / 3600, spawnPerSecond: lambda, horizon: Infinity });
    assert.equal(attachedAfter({ max: 10, now: 4, popRate: 3 / 3600, spawnPerSecond: lambda, seconds: 0 }), 4);
    const later = attachedAfter({ max: 10, now: 4, popRate: 3 / 3600, spawnPerSecond: lambda, seconds: 1111 });
    assert.ok(close(later, steady + (4 - steady) * Math.exp(-1), 1e-9), `${later}`);
    assert.ok(close(attachedAfter({ max: 10, now: 4, popRate: 3 / 3600, spawnPerSecond: lambda, seconds: 1e9 }), steady, 1e-9));
    // Averaged over an hour, the refill it follows is expectedAttached's.
    let sum = 0;
    for (let t = 0.5; t < 3600; t += 1) sum += attachedAfter({ max: 10, now: 0, spawnPerSecond: lambda, seconds: t });
    assert.ok(close(sum / 3600, expectedAttached({ max: 10, now: 0, spawnPerSecond: lambda, horizon: 3600 }), 1e-4));
    assert.equal(attachedAfter({ max: 10, now: 4, spawnPerSecond: 0, seconds: 3600 }), 4, 'no spawning: nothing refills');
});

test('Halloween drops: the game fail rate and one of seven cookies per success', () => {
    assert.ok(close(halloweenFailRate({}), 0.95));
    assert.ok(close(halloweenFailRate({ spooky: true, starterror: true, dropRateMult: 1.1, selebrak: 1, shiny: true }), (0.8 * 0.9 * 0.9 * 0.9) / 1.1));
    const drops = halloweenDrops({ failRate: 0.8, owned: ['Skull cookies', 'Ghost cookies'] });
    assert.equal(drops.length, 5);
    for (const d of drops) assert.ok(close(d.chance, 0.2 / 7));
    assert.deepEqual(halloweenDrops({ failRate: 0.8, owned: ['Skull cookies', 'Ghost cookies', 'Bat cookies', 'Slime cookies', 'Pumpkin cookies', 'Eyeball cookies', 'Spider cookies'] }), []);
});

test('Easter drops: rare eggs a tenth of the time, and one reroll of an egg already owned', () => {
    assert.ok(close(easterFailRate({}), 0.98));
    assert.ok(close(easterFailRate({ dropRateMult: 1.25, hideAndSeek: true, omelette: true, starspawn: true, selebrak: 2 }), (0.98 / 1.25) * 0.7 * 0.9 * 0.9 * 0.95));
    const eggs = ['a', 'b', 'c'];
    const rare = ['r1', 'r2'];
    const drops = easterDrops({ failRate: 0.5, owned: ['a'], eggs, rareEggs: rare });
    const byName = Object.fromEntries(drops.map((d) => [d.name, d.chance]));
    // First draw: common 0.9/3 each, rare 0.1/2 each; an owned first draw (0.3) rerolls once.
    const common = 0.5 * (0.3 + 0.3 * 0.3);
    const rareChance = 0.5 * (0.05 + 0.3 * 0.05);
    assert.ok(close(byName.b, common) && close(byName.c, common), JSON.stringify(byName));
    assert.ok(close(byName.r1, rareChance) && close(byName.r2, rareChance), JSON.stringify(byName));
    assert.equal(byName.a, undefined);
});

test('a hunt runs only while the drops expected per second beat the income it forfeits', () => {
    const base = {
        drops: [{ name: 'x', chance: 0.05 }],
        slots: 10,
        spawnPerSecond: 1 / 222,
        cps: 1000,
        normalMultiplier: 5,
    };
    // Pop-all cycles each slot every 232 s: 10/232 pops a second, each worth 0.05 * value.
    // Forfeited: (5 - 1) * 1000 = 4000 a second. Break-even value: 4000 / (10/232 * 0.05) ≈ 1.86e6.
    assert.equal(huntDecision({ ...base, value: 1e6 }).hunt, false);
    assert.equal(huntDecision({ ...base, value: 3e6 }).hunt, true);
    assert.equal(huntDecision({ ...base, value: () => 3e6 }).hunt, true, 'a value per drop name works too');
    assert.equal(huntDecision({ ...base, drops: [], value: 1e30 }).hunt, false, 'nothing left to find');
    assert.equal(huntDecision({ ...base, value: 3e6, spawnPerSecond: 0 }).hunt, false, 'no spawns, no pops');
});
