import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    levelCost,
    rebuyCost,
    trainableChain,
    chooseTarget,
    horizonSeconds,
    magicCap,
    shuffleWith,
    dropFor,
    shouldPet,
    DROPS,
    FULLY_TRAINED,
} from '../../src/core/dragon.js';
import { AUTOPILOT } from '../../src/core/autopilot.js';

// Base prices of the twenty buildings (main.js:7725-7732), for bakeries in these tests.
const BASE = [15, 100, 1100, 12000, 130000, 1.4e6, 2e7, 3.3e8, 5.1e9, 7.5e10, 1e12, 1.4e13, 1.7e14, 2.1e15, 2.6e16, 3.1e17, 7.1e19, 1.2e22, 1.9e24, 5.4e26];
const bakery = (amounts) => BASE.map((basePrice, i) => ({ basePrice, amount: amounts[i] || 0, free: 0, modifier: 1 }));
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${a} is not ${b}`);

test('each level costs what Game.dragonLevels charges', () => {
    // Levels 0-4 are the egg: 1, 2, 4, 8 and 16 million cookies (main.js:14774-14793).
    assert.deepEqual([0, 1, 2, 3, 4].map((l) => levelCost(l).cookies), [1e6, 2e6, 4e6, 8e6, 16e6]);
    // Level L from 5 to 24 sacrifices 100 of building L-5 (main.js:14857-14866).
    assert.deepEqual(levelCost(5), { building: 0, count: 100 }); // Cursor, for Dragon Cursor
    assert.deepEqual(levelCost(12), { building: 7, count: 100 }); // Wizard tower, for Arcane Aura
    assert.deepEqual(levelCost(18), { building: 13, count: 100 }); // Prism, for Radiant Appetite
    assert.deepEqual(levelCost(24), { building: 19, count: 100 }); // You, for Dragon Guts
    // 50 of every building for the Dragon cookie, 200 of every building for the second aura.
    assert.deepEqual(levelCost(25), { every: 50 });
    assert.deepEqual(levelCost(26), { every: 200 });
    assert.equal(levelCost(FULLY_TRAINED), null);
    assert.equal(FULLY_TRAINED, 27);
});

test('rebuying the top units costs the sum of their prices, as getSumPrice adds them', () => {
    const b = { basePrice: 1100, amount: 130, free: 0, modifier: 0.93 };
    let sum = 0;
    for (let i = 30; i < 130; i++) sum += 1100 * Math.pow(1.15, i);
    assert.equal(rebuyCost(b, 100), Math.ceil(sum * 0.93));
    // Free units (main.js:7802) shift the curve down.
    const free = { ...b, free: 10 };
    let freeSum = 0;
    for (let i = 30; i < 130; i++) freeSum += 1100 * Math.pow(1.15, Math.max(0, i - 10));
    assert.equal(rebuyCost(free, 100), Math.ceil(freeSum * 0.93));
    // About 6.67 times the next unit's price (the audit's factor for k = 100).
    const next = 1100 * Math.pow(1.15, 130) * 0.93;
    assert.ok(Math.abs(rebuyCost(b, 100) / next - 6.6667) < 1e-3);
});

test('a chain runs only as far as what is owned now allows, one level after another', () => {
    // 120 Cursors and Grandmas, 90 Farms: levels 5 and 6 can be trained, level 7 cannot.
    const steps = trainableChain({ level: 5, buildings: bakery([120, 120, 90]), spendable: 0 });
    assert.deepEqual(steps.map((s) => s.level), [5, 6]);
    near(steps[0].cost, rebuyCost(bakery([120])[0], 100));
    assert.equal(steps[0].spend, 0, 'a sacrifice spends no cookies');
    // Level 24 takes 100 You, so level 25 (50 of each) sees what is left.
    const all = new Array(20).fill(160);
    const late = trainableChain({ level: 24, buildings: bakery(all), spendable: 0 });
    assert.deepEqual(late.map((s) => s.level), [24, 25], '160 - 100 - 50 leaves 10 You: not 200 for level 26');
    const rich = trainableChain({ level: 24, buildings: bakery(new Array(20).fill(400)), spendable: 0 });
    assert.deepEqual(rich.map((s) => s.level), [24, 25, 26]);
    // Level 25's cost is the top 50 of every building, after level 24's sacrifice.
    let cost25 = 0;
    bakery(new Array(20).fill(400)).forEach((b, i) => {
        cost25 += rebuyCost({ ...b, amount: i === 19 ? 300 : 400 }, 50);
    });
    near(rich[1].cost, cost25);
    assert.deepEqual(trainableChain({ level: 26, buildings: bakery(new Array(20).fill(199)), spendable: 0 }), []);
    assert.deepEqual(trainableChain({ level: FULLY_TRAINED, buildings: bakery(all), spendable: 1e30 }), []);
});

test('egg levels spend only cookies the buyer is not holding', () => {
    // 5 million spendable: 1 + 2 fit, the next 4 would not.
    const steps = trainableChain({ level: 0, buildings: bakery([200, 200]), spendable: 5e6 });
    assert.deepEqual(steps.map((s) => [s.level, s.spend, s.cost]), [[0, 1e6, 1e6], [1, 2e6, 2e6]]);
    const all = trainableChain({ level: 0, buildings: bakery([200, 200]), spendable: 31e6 });
    assert.deepEqual(all.map((s) => s.level), [0, 1, 2, 3, 4, 5, 6]);
});

test('a level the caller forbids ends the chain there', () => {
    // The adapter forbids the Wizard tower level while the grimoire holds more mana than it would leave.
    const seen = [];
    const steps = trainableChain({
        level: 10,
        buildings: bakery(new Array(14).fill(150)),
        spendable: 0,
        allowed: (level, after, taken) => {
            seen.push([level, after[7], taken[7]]);
            return level !== 12;
        },
    });
    assert.deepEqual(steps.map((s) => s.level), [10, 11]);
    assert.deepEqual(seen[2], [12, 50, 100], 'the rule sees the towers left and the towers taken');
});

test('trains toward the target that repays the whole chain within the horizon, and only then', () => {
    // Levels 7 to 9 teach auras worth nothing more than the one in place; level 10 is worth 5 a second.
    const steps = [{ level: 7, cost: 100 }, { level: 8, cost: 100 }, { level: 9, cost: 100 }];
    const income = [1000, 1000, 1000, 1005];
    const yes = chooseTarget({ level: 7, steps, income, horizon: 3600 });
    assert.equal(yes.train, true);
    assert.equal(yes.target, 10);
    assert.equal(yes.cost, 300);
    assert.equal(yes.gain, 5);
    // 5 a second repays 300 in 60 s: not inside a 50-second horizon.
    assert.equal(chooseTarget({ level: 7, steps, income, horizon: 50 }).train, false);
    // Nothing worth more: no training, however cheap.
    assert.equal(chooseTarget({ level: 7, steps, income: [1000, 1000, 1000, 1000], horizon: 1e9 }).train, false);
    assert.equal(chooseTarget({ level: 7, steps: [], income: [1000], horizon: 1e9 }).train, false);
});

test('picks the best net target, counting the aura switch the gods will pay for', () => {
    const steps = [{ level: 18, cost: 1000 }, { level: 19, cost: 1e6 }];
    // Level 19 doubles income; level 20 adds a little more at a thousand times the price.
    const income = [100, 200, 201];
    const out = chooseTarget({ level: 18, steps, income, horizon: 3600, switchCost: [0, 50, 50] });
    assert.equal(out.target, 19);
    assert.equal(out.cost, 1050, 'the building an aura switch sacrifices is part of the price');
    // A switch too dear to repay stops the chain.
    assert.equal(chooseTarget({ level: 18, steps, income, horizon: 3600, switchCost: [0, 1e9, 1e9] }).train, false);
});

test('the horizon is the time the run has lasted, and at least an hour', () => {
    assert.equal(horizonSeconds(0), 3600);
    assert.equal(horizonSeconds(600), 3600);
    assert.equal(horizonSeconds(5 * 3600), 5 * 3600);
});

test('the mana cap follows the grimoire\'s formula', () => {
    // minigameGrimoire.js:263-267; values from the audit's replication.
    assert.equal(magicCap(100, 1), 50);
    assert.equal(magicCap(0, 1), 5);
    assert.equal(magicCap(150, 1), 60);
    assert.equal(magicCap(50, 1), 36);
    assert.ok(magicCap(100, 10) > magicCap(100, 1), 'tower levels raise it');
});

test('the drop forecast shuffles as the game does and indexes by the quarter hour', () => {
    // The game's shuffle (main.js:56-71): from the last element down, swap with a random earlier
    // one, drawing one number per element.
    const draws = [0.9, 0.1, 0.6, 0.3];
    let i = 0;
    const out = shuffleWith(DROPS, () => draws[i++]);
    assert.equal(i, 4, 'four draws, as the game makes');
    // counter 3: index (0.9*3)|0 = 2, swap 3<->2; counter 2: (0.1*2)|0 = 0, swap 2<->0;
    // counter 1: (0.6*1)|0 = 0, swap 1<->0; counter 0: swap 0<->0.
    assert.deepEqual(out, ['Dragon claw', 'Dragon teddy bear', 'Dragon scale', 'Dragon fang']);
    assert.deepEqual(DROPS, ['Dragon scale', 'Dragon claw', 'Dragon fang', 'Dragon teddy bear'], 'the list itself is untouched');
    assert.deepEqual([0, 14, 15, 29, 30, 44, 45, 59].map((m) => dropFor(out, m)), [out[0], out[0], out[1], out[1], out[2], out[2], out[3], out[3]]);
});

test('petting only at level 8 or more, with the upgrade, while this window\'s drop is missing', () => {
    const base = { level: 8, petUpgrade: true, drop: 'Dragon scale', owned: false };
    assert.equal(shouldPet(base), true);
    assert.equal(shouldPet({ ...base, level: 7 }), false, 'drops need level 8 (main.js:14957)');
    assert.equal(shouldPet({ ...base, petUpgrade: false }), false);
    assert.equal(shouldPet({ ...base, owned: true }), false);
});

test('under the Autopilot the dragon is trained and petted, and the orbs seller stays off', () => {
    assert.equal(AUTOPILOT.autoDragon, 1);
    assert.equal(AUTOPILOT.petDragon, 1);
    assert.equal(AUTOPILOT.autoDragonOrbs, 0);
});
