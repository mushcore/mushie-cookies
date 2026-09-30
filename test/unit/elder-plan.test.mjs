import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCandidates } from '../../src/game/candidates.js';
import { gapCost } from '../../src/core/wrinklers.js';
import { fakeGame } from './fake-game.mjs';

const PLEDGE = 'Elder Pledge';
const COVENANT = 'Elder Covenant';
const REVOKE = 'Revoke Elder Covenant';
const COVENANT_PRICE = 66666666666666; // main.js:10115
const REVOKE_PRICE = 6666666666; // main.js:10127
const CPS = 1e6;

/** A game past Elder Pact, with the three toggles priced as the game prices them (main.js:10086). */
function elderGame({ pledges = 0, pledgeT = 0, won = [], wrinklers = [], pact = true, grandmas = 10, elderWrath = 3, inStore = [PLEDGE], state = {} } = {}) {
    const game = fakeGame({
        amount: 10,
        amounts: { Grandma: grandmas },
        bought: pact ? ['One mind', 'Communal brainsweep', 'Elder Pact'] : [],
        won: ['One with everything', ...won],
    });
    const toggle = (id, name, price) => {
        const it = { id, name, pool: 'toggle', bought: 0, unlocked: 0, getPrice: price, ...(state[name] || {}) };
        game.Upgrades[name] = it;
        return it;
    };
    toggle(74, PLEDGE, () => Math.pow(8, Math.min(game.pledges + 2, 14)));
    toggle(84, COVENANT, () => COVENANT_PRICE);
    toggle(85, REVOKE, () => REVOKE_PRICE);
    for (const name of inStore) game.Upgrades[name].unlocked = 1;
    Object.assign(game, {
        pledges,
        pledgeT,
        elderWrath,
        UpgradesInStore: inStore.map((name) => game.Upgrades[name]),
        UpgradesById: { 74: game.Upgrades[PLEDGE], 84: game.Upgrades[COVENANT], 85: game.Upgrades[REVOKE] },
        wrinklers,
        fps: 30,
        unbuffedCps: CPS,
        getWrinklersMax: () => 10,
        eff: () => 1,
        auraMult: () => 0,
        hasGod: () => 0,
    });
    return game;
}

const policy = (extra = {}) => ({ excludedBuildings: 'all', excludedUpgrades: new Set(), chainReach: 0, popsWrinklers: true, ...extra });
const planOf = (game, extra) => listCandidates(game, policy(extra)).find((c) => c.key.startsWith('elder:'));
const wrinkler = (id, extra = {}) => ({ id, phase: 2, type: 0, hp: 1, sucked: 1e9, ...extra });

test('after Elder Pact, the three pledge achievements are one purchase: five pledges, each ended by a covenant and its revoke', () => {
    const game = elderGame();
    const plan = planOf(game);
    assert.ok(plan, 'the plan is listed');
    assert.equal(plan.kind, 'upgrade');
    assert.equal(plan.upgrade, game.Upgrades[PLEDGE], 'the first step is bought first');
    // Pledges cost 8^(pledges+2) (main.js:10086): 64, 512, 4096, 32768, 262144.
    const pledges = 64 + 512 + 4096 + 32768 + 262144;
    assert.equal(plan.price, pledges + 5 * COVENANT_PRICE + 5 * REVOKE_PRICE);
    assert.equal(plan.forfeit, 0, 'no wrinkler is popped');

    plan.apply();
    assert.equal(game.pledges, 5);
    assert.equal(game.pledgeT, 0);
    for (const name of ['Elder nap', 'Elder slumber', 'Elder calm']) assert.ok(game.wins.includes(name), `${name}: ${game.wins}`);
    assert.equal(game.Upgrades[COVENANT].bought, 0, 'the covenant is revoked: no 5% CpS lost (main.js:5131)');
    assert.equal(game.Upgrades[PLEDGE].bought, 0);
    assert.equal(game.elderWrath, 3, 'the grandmapocalypse returns');
});

test('the plan resumes from any step: a pledge running, a covenant held', () => {
    // After the plan's first pledge (main.js:10073-10081) the covenant is on sale.
    const running = elderGame({ pledges: 1, pledgeT: 54000, elderWrath: 0, won: ['Elder nap'], inStore: [COVENANT], state: { [PLEDGE]: { bought: 1, unlocked: 1 } } });
    const plan = planOf(running);
    assert.equal(plan.upgrade, running.Upgrades[COVENANT]);
    assert.equal(plan.price, 5 * COVENANT_PRICE + 5 * REVOKE_PRICE + 512 + 4096 + 32768 + 262144);
    plan.apply();
    assert.equal(running.pledges, 5);
    assert.equal(running.pledgeT, 0);
    assert.equal(running.elderWrath, 3, 'a pledge had stopped it; the research stage returns');

    // After a covenant, only its revoke is on sale (main.js:10118-10120).
    const held = elderGame({ pledges: 2, inStore: [REVOKE], elderWrath: 0, won: ['Elder nap', 'Elder calm'], state: { [COVENANT]: { bought: 1, unlocked: 1 } } });
    const next = planOf(held);
    assert.equal(next.upgrade, held.Upgrades[REVOKE]);
    assert.equal(next.price, REVOKE_PRICE + 3 * (COVENANT_PRICE + REVOKE_PRICE) + 4096 + 32768 + 262144);
});

test('only what is missing is bought', () => {
    const allWon = elderGame({ won: ['Elder nap', 'Elder slumber', 'Elder calm'] });
    assert.equal(planOf(allWon), undefined);

    // Elder calm alone: a covenant already on sale, and its revoke.
    const calm = elderGame({ pledges: 5, won: ['Elder nap', 'Elder slumber'], inStore: [PLEDGE, COVENANT], state: { [COVENANT]: { unlocked: 1 } } });
    const plan = planOf(calm);
    assert.equal(plan.upgrade, calm.Upgrades[COVENANT]);
    assert.equal(plan.price, COVENANT_PRICE + REVOKE_PRICE);
    plan.apply();
    assert.deepEqual(calm.wins, ['Elder calm']);

    // No covenant on sale yet: a pledge unlocks it (main.js:10078).
    const fresh = elderGame({ pledges: 0, won: ['Elder nap', 'Elder slumber'] });
    const first = planOf(fresh);
    assert.equal(first.upgrade, fresh.Upgrades[PLEDGE]);
    assert.equal(first.price, 64 + COVENANT_PRICE + REVOKE_PRICE);

    // Nap won in an earlier run: pledges start again from nothing each ascension (main.js:3513).
    const again = elderGame({ pledges: 0, won: ['Elder nap', 'Elder calm'] });
    assert.equal(planOf(again).price, 64 + 512 + 4096 + 32768 + 262144 + 5 * (COVENANT_PRICE + REVOKE_PRICE));
});

test('the pledge achievements already due are not credited again', () => {
    // One pledge made, the five-second check not yet run: Elder nap comes anyway.
    const game = elderGame({ pledges: 1, pledgeT: 54000, elderWrath: 0, inStore: [COVENANT], state: { [PLEDGE]: { bought: 1, unlocked: 1 } } });
    planOf(game).apply();
    assert.ok(!game.wins.includes('Elder nap'), String(game.wins));
    assert.ok(game.wins.includes('Elder slumber'));
});

test('nothing is listed that the store does not sell or the settings exclude', () => {
    assert.equal(planOf(elderGame({ pact: false })), undefined, 'the pledge appears with Elder Pact (main.js:14225)');
    assert.equal(planOf(elderGame({ inStore: [] })), undefined, 'the first step must be on sale');
    assert.equal(planOf(elderGame({ grandmas: 0 })), undefined, 'without grandmas the pledge is never offered again (main.js:14204)');
    assert.equal(planOf(elderGame(), { excludedUpgrades: new Set([84]) }), undefined);
    assert.equal(planOf(elderGame(), { excludedUpgrades: 'all' }), undefined);
});

test('the wrinklers a pledge pops are priced as the refill they lose', () => {
    const wrinklers = Array.from({ length: 10 }, (_, i) => wrinkler(i));
    const game = elderGame({ wrinklers });
    const plan = planOf(game);
    // Pledge and covenant pop every wrinkler (main.js:10080, 10122, 14285); the refill runs at the
    // spawn rate of the stage the grandmapocalypse returns to (main.js:14361-14373).
    const forfeit = gapCost({ attached: 10, count: 10, suck: 0.05, payoutSum: 10 * 1.1, popMult: 1.1, cps: CPS, spawnPerSecond: 0.00001 * 3 * 30, crawl: 10 });
    assert.ok(forfeit > 1000 * CPS, 'ten fed wrinklers are worth over a thousand seconds of CpS');
    assert.equal(plan.forfeit, forfeit);
    assert.equal(plan.price, 64 + 512 + 4096 + 32768 + 262144 + 5 * (COVENANT_PRICE + REVOKE_PRICE) + forfeit);

    // While a pledge runs the wrath is 0, yet the refill after the plan runs at stage 3.
    const running = elderGame({ pledges: 1, pledgeT: 100, elderWrath: 0, won: ['Elder nap'], inStore: [COVENANT], wrinklers: [wrinkler(0, { phase: 0 })], state: { [PLEDGE]: { bought: 1, unlocked: 1 } } });
    assert.equal(planOf(running).forfeit, 0, 'no wrinkler is in play');
});

test("the player's wrinklers are not popped for it: not with popping off, and never a shiny", () => {
    const attached = [wrinkler(0), wrinkler(1)];
    assert.equal(planOf(elderGame({ wrinklers: attached }), { popsWrinklers: false }), undefined);
    const crawling = [wrinkler(0, { phase: 1, sucked: 0 })];
    assert.equal(planOf(elderGame({ wrinklers: crawling }), { popsWrinklers: false }), undefined);
    assert.ok(planOf(elderGame({ wrinklers: [wrinkler(0, { phase: 0 })] }), { popsWrinklers: false }), 'empty slots are fine');
    const shiny = [wrinkler(0), wrinkler(1, { type: 1 })];
    assert.equal(planOf(elderGame({ wrinklers: shiny })), undefined, 'the wrinkler system keeps a shiny (src/core/wrinklers.js decidePops)');
});

test('each pledge is a purchase of its own to the buyer', () => {
    // The buyer judges a purchase by the bank falling (src/systems/buyer.js). A 64-cookie pledge
    // is below the resolution of a 1e20 bank, so the buyer counts it as refused and cools its key
    // down for a minute; the next pledge must not share that key.
    const before = planOf(elderGame());
    const after = planOf(elderGame({ pledges: 1, won: ['Elder calm'], state: { [COVENANT]: { unlocked: 1 } } }));
    assert.equal(before.upgrade.name, after.upgrade.name);
    assert.notEqual(before.key, after.key);
});

test('the plan ends the pledge it made, even once the check has awarded Elder slumber', () => {
    const game = elderGame({ pledges: 4, won: ['Elder nap', 'Elder calm'], inStore: [PLEDGE], state: { [COVENANT]: { unlocked: 1 } } });
    assert.equal(planOf(game).upgrade, game.Upgrades[PLEDGE]);
    // The buyer buys the fifth pledge (main.js:10073-10081), and the next five-second check
    // awards Elder slumber before the buyer looks again (main.js:16501).
    game.pledges = 5;
    game.pledgeT = 54000;
    game.elderWrath = 0;
    game.Upgrades[PLEDGE].bought = 1;
    game.UpgradesInStore = [game.Upgrades[COVENANT]];
    game.Win('Elder slumber');
    const end = planOf(game);
    assert.ok(end, 'a pledge the plan made is not left to run for half an hour');
    assert.equal(end.upgrade, game.Upgrades[COVENANT]);
    assert.equal(end.price, COVENANT_PRICE + REVOKE_PRICE);
    // Then its covenant (main.js:10115-10124): only the revoke is left.
    game.pledgeT = 0;
    game.Upgrades[PLEDGE].bought = 0;
    game.Upgrades[PLEDGE].unlocked = 0;
    game.Upgrades[COVENANT].bought = 1;
    game.Upgrades[REVOKE].unlocked = 1;
    game.UpgradesInStore = [game.Upgrades[REVOKE]];
    assert.equal(planOf(game).upgrade, game.Upgrades[REVOKE]);
});

test("once the achievements are won, the player's own pledge or covenant is left alone", () => {
    const won = ['Elder nap', 'Elder slumber', 'Elder calm'];
    const pledged = elderGame({ pledges: 6, pledgeT: 54000, elderWrath: 0, won, inStore: [COVENANT], state: { [PLEDGE]: { bought: 1, unlocked: 1 } } });
    assert.equal(planOf(pledged), undefined);
    const covenanted = elderGame({ pledges: 6, elderWrath: 0, won, inStore: [REVOKE], state: { [COVENANT]: { bought: 1, unlocked: 1 } } });
    assert.equal(planOf(covenanted), undefined);
});

test('a covenant the player buys after the plan is done is theirs, though the plan once bought one at that count', () => {
    const game = elderGame({ pledges: 5, pledgeT: 54000, elderWrath: 0, won: ['Elder nap', 'Elder slumber', 'Elder calm'], inStore: [COVENANT] });
    game.Upgrades[PLEDGE].bought = 1;
    const plan = elderGame({ pledges: 4, won: ['Elder nap', 'Elder calm'], state: { [COVENANT]: { unlocked: 1 } } });
    // The plan's own run: its fifth pledge, its covenant, its revoke.
    Object.assign(plan.Upgrades[PLEDGE], { unlocked: 1 });
    assert.equal(planOf(plan).upgrade, plan.Upgrades[PLEDGE]);
    Object.assign(plan, { pledges: 5, pledgeT: 54000, elderWrath: 0, UpgradesInStore: [plan.Upgrades[COVENANT]] });
    plan.Upgrades[PLEDGE].bought = 1;
    plan.Win('Elder slumber');
    assert.equal(planOf(plan).upgrade, plan.Upgrades[COVENANT]);
    Object.assign(plan, { pledgeT: 0, UpgradesInStore: [plan.Upgrades[REVOKE]] });
    Object.assign(plan.Upgrades[PLEDGE], { bought: 0, unlocked: 0 });
    Object.assign(plan.Upgrades[COVENANT], { bought: 1 });
    plan.Upgrades[REVOKE].unlocked = 1;
    assert.equal(planOf(plan).upgrade, plan.Upgrades[REVOKE]);
    // Revoked (main.js:10127-10135): the covenant is on sale again, and nothing is left to do.
    Object.assign(plan.Upgrades[COVENANT], { bought: 0, unlocked: 1 });
    Object.assign(plan.Upgrades[REVOKE], { bought: 1 });
    plan.UpgradesInStore = [plan.Upgrades[COVENANT]];
    assert.equal(planOf(plan), undefined);
    // Later the player buys a covenant of their own, at the same five pledges.
    plan.Upgrades[COVENANT].bought = 1;
    plan.Upgrades[REVOKE].bought = 0;
    plan.UpgradesInStore = [plan.Upgrades[REVOKE]];
    assert.equal(planOf(plan), undefined, "the player's covenant is not revoked");
    assert.equal(planOf(game), undefined);
});
