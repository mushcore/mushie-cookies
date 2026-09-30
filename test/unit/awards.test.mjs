import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awardForBuildings, awardForUpgrades, pendingAwards } from '../../src/game/awards.js';
import { NAMES, KITTENS, GRANDMA_TYPES, fakeGame, buy } from './fake-game.mjs';

const SETTLED = ['Builder', 'Architect', 'Engineer', 'One with everything', 'Mathematician', 'Base 10'];

test("a building's own buy function runs: the fiftieth cursor wins Mouse wheel", () => {
    const game = fakeGame({ amount: 10, amounts: { Cursor: 49 }, won: SETTLED });
    awardForBuildings(game, buy(game, 'Cursor'));
    assert.deepEqual(game.tiered, ['Cursor'], 'the tier upgrades and achievements come from the buy function');
    assert.deepEqual(game.wins, ['Mouse wheel']);
    const other = fakeGame({ amount: 10, amounts: { Cursor: 199 }, won: [...SETTLED, 'Mouse wheel'] });
    awardForBuildings(other, buy(other, 'Cursor'));
    assert.deepEqual(other.wins, ['The Digital']);
});

test('the hundredth of every building wins Centennial and unlocks its biscuit (main.js:16412)', () => {
    const game = fakeGame({ amount: 100, amounts: { Grandma: 99 }, won: SETTLED });
    awardForBuildings(game, buy(game, 'Grandma'));
    assert.deepEqual(game.wins, ['Centennial']);
    assert.ok(game.unlocks.includes('Milk chocolate butter biscuit'));
    const high = fakeGame({ amount: 500, amounts: { You: 499 }, won: [...SETTLED, 'Polymath'] });
    awardForBuildings(high, buy(high, 'You'));
    assert.ok(high.wins.includes('Quincentennial') && high.wins.includes('Centennial and a half'));
    assert.ok(!high.wins.includes('Quincentennial and a half'));
    assert.ok(high.unlocks.includes('Pure pitch-black chocolate butter biscuit'));
});

test('one of every building, Mathematician and Base 10 follow the game counts (main.js:16398-16411)', () => {
    // Base 10: at least (20 - id) * 10 of each; Mathematician: min(128, 2^(19 - id)) of each.
    const base10 = Object.fromEntries(NAMES.map((n, id) => [n, (20 - id) * 10]));
    const game = fakeGame({ amounts: { ...base10, You: 9 }, won: ['Builder', 'Architect', 'Centennial'] });
    awardForBuildings(game, buy(game, 'You'));
    assert.ok(game.wins.includes('Base 10'), String(game.wins));
    assert.ok(!game.wins.includes('Mathematician'), 'Base 10 counts leave 120 shipments, short of the 128 Mathematician needs');
    const math = Object.fromEntries(NAMES.map((n, id) => [n, Math.min(128, Math.pow(2, 19 - id))]));
    const second = fakeGame({ amounts: { ...math, You: 0 }, won: ['Builder', 'Architect'] });
    awardForBuildings(second, buy(second, 'You'));
    assert.ok(second.wins.includes('Mathematician') && second.wins.includes('One with everything'), String(second.wins));
    assert.ok(!second.wins.includes('Base 10'));
});

test('the building count milestones: Builder, Polymath, The elder scrolls (main.js:16457-16502)', () => {
    const game = fakeGame({ amount: 4, amounts: { Cursor: 400, Grandma: 376 }, upgradesOwned: 300, won: ['One with everything'] });
    awardForBuildings(game, buy(game, 'Grandma'));
    for (const name of ['Builder', 'Architect', 'The elder scrolls']) assert.ok(game.wins.includes(name), `${name}: ${game.wins}`);
    assert.ok(!game.wins.includes('Polymath'), 'Polymath needs 4,000 buildings');
    const many = fakeGame({ amount: 199, amounts: { Cursor: 218 }, upgradesOwned: 300, won: SETTLED });
    awardForBuildings(many, buy(many, 'Cursor', 1));
    assert.ok(many.wins.includes('Polymath'), String(many.wins));
    assert.ok(many.wins.includes('Lord of Constructs'));
});

test('an upgrade: the tenth kitten wins Jellicles, the upgrade count its milestones (main.js:16465-16483)', () => {
    const game = fakeGame({ amount: 1, bought: KITTENS.slice(0, 9), upgradesOwned: 19, won: ['One with everything'] });
    game.Upgrades[KITTENS[9]] = { bought: 1, unlocked: 1 };
    game.UpgradesOwned += 1;
    awardForUpgrades(game);
    assert.deepEqual(game.wins.sort(), ['Enhancer', 'Jellicles']);
});

test('grandma types win Elder at seven and Veteran at fourteen; the Pact wins Grandmapocalypse', () => {
    const game = fakeGame({ amount: 1, bought: GRANDMA_TYPES.slice(0, 13), won: ['One with everything', 'Elder'] });
    game.Upgrades[GRANDMA_TYPES[13]] = { bought: 1, unlocked: 1 };
    awardForUpgrades(game);
    assert.deepEqual(game.wins, ['Veteran']);
    const pact = fakeGame({ amount: 1, won: ['One with everything'] });
    pact.elderWrath = 3;
    awardForUpgrades(pact);
    assert.deepEqual(pact.wins, ['Grandmapocalypse']);
});

test('pledges win Elder nap at one and Elder slumber at five, and unlock the rolling pins at ten', () => {
    const game = fakeGame({ amount: 1, won: ['One with everything'] });
    game.pledges = 5;
    awardForUpgrades(game);
    assert.deepEqual(game.wins, ['Elder nap', 'Elder slumber']);
    game.pledges = 10;
    awardForUpgrades(game);
    assert.ok(game.unlocks.includes('Sacrificial rolling pins'));
});

test('the last cookie of a seasonal set wins its achievement', () => {
    const spooky = ['Skull cookies', 'Ghost cookies', 'Bat cookies', 'Slime cookies', 'Pumpkin cookies', 'Eyeball cookies', 'Spider cookies'];
    const game = fakeGame({ amount: 1, bought: spooky, won: ['One with everything'] });
    awardForUpgrades(game);
    assert.deepEqual(game.wins, ['Spooky cookies']);
    const hearts = fakeGame({ amount: 1, bought: ['Prism heart biscuits'], won: ['One with everything'] });
    awardForUpgrades(hearts);
    assert.deepEqual(hearts.wins, ['Lovely cookies']);
});

test('an achievement the next check awards anyway is not credited to the purchase', () => {
    // 20 of everything already makes 400 buildings: Builder is due at the next five-second
    // check whatever is bought, so only what this cursor adds may count.
    const game = fakeGame({ amount: 20, amounts: { Cursor: 49 }, won: ['One with everything'] });
    const pending = pendingAwards(game);
    assert.ok(pending.has('Builder'));
    awardForBuildings(game, buy(game, 'Cursor'), pending);
    assert.deepEqual(game.wins, ['Mouse wheel']);
    // Without the pending set the rules award everything that holds.
    const all = fakeGame({ amount: 20, amounts: { Cursor: 49 }, won: ['One with everything'] });
    awardForBuildings(all, buy(all, 'Cursor'));
    assert.ok(all.wins.includes('Builder'));
});

test('nothing is won twice and nothing already won is counted again', () => {
    const game = fakeGame({ amount: 100, won: [...SETTLED, 'Centennial'] });
    awardForBuildings(game, buy(game, 'Farm'));
    assert.deepEqual(game.wins, []);
});
