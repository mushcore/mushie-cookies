import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeavenly } from '../../src/systems/heavenly.js';

/** Just enough of the game for the purchase record: upgrades, the owned count, the run. */
function fakeGame() {
    const upgrades = {};
    for (let id = 1; id <= 4; id++) upgrades[id] = { id, bought: 0 };
    return {
        UpgradesById: upgrades,
        UpgradesOwned: 0,
        cookiesEarned: 0,
        resets: 0,
        startDate: 1000,
        OnAscend: 0,
        AscendTimer: 0,
        buy(id) {
            this.UpgradesById[id].bought = 1;
            this.UpgradesOwned++;
        },
    };
}

function setUp() {
    const game = fakeGame();
    let tick = null;
    const loop = { add: (name, fn) => { tick = fn; } };
    const heavenly = createHeavenly({ game, settings: { autoAscendToggle: 1 }, loop });
    return { game, heavenly, tick: () => tick() };
}

test('records the cookies the run had baked when each upgrade was bought', () => {
    const { game, heavenly, tick } = setUp();
    tick();
    game.cookiesEarned = 100;
    game.buy(1);
    tick();
    game.cookiesEarned = 5000;
    game.buy(2);
    tick();
    assert.deepEqual(heavenly.reacquired(), { 1: 100, 2: 5000 });
});

test('an upgrade owned before the run could be watched has no record of its own', () => {
    const { game, heavenly, tick } = setUp();
    game.cookiesEarned = 1e6;
    game.buy(3); // a permanent slot, or the mod starting mid-run
    tick();
    game.buy(4);
    tick();
    assert.deepEqual(heavenly.reacquired(), { 4: 1e6 });
});

test('a new run keeps the last run\'s records for upgrades a slot hands it at the start', () => {
    const { game, heavenly, tick } = setUp();
    tick();
    game.cookiesEarned = 700;
    game.buy(1);
    game.buy(2);
    tick();
    // Reincarnation: everything is sold except the slotted upgrade 1, and the run restarts.
    game.resets = 1;
    game.startDate = 2000;
    game.cookiesEarned = 0;
    game.UpgradesById[2].bought = 0;
    game.UpgradesOwned = 1;
    tick();
    game.cookiesEarned = 900;
    game.buy(2);
    tick();
    assert.deepEqual(heavenly.reacquired(), { 1: 700, 2: 900 }, 'upgrade 1 keeps its record from the run that bought it');
});

test('nothing is recorded on the ascension screen', () => {
    const { game, heavenly, tick } = setUp();
    tick();
    game.OnAscend = 1;
    game.cookiesEarned = 50;
    game.buy(1);
    tick();
    assert.deepEqual(heavenly.reacquired(), {});
});
