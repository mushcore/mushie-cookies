// The lump system's adapter against a stand-in game: the wiring the game tests cannot reach
// cheaply (the ascension's collection ticks, the buyer's hold).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLumps } from '../../src/systems/lumps.js';

const HOUR = 3600 * 1000;

function fakeGame(over = {}) {
    const game = {
        lumps: 5,
        lumpsTotal: 5,
        lumpMatureAge: 20 * HOUR,
        lumpRipeAge: 23 * HOUR,
        lumpOverripeAge: 24 * HOUR,
        lumpCurrentType: 0,
        lumpT: Date.now() - 23 * HOUR, // ripe
        cookies: 1000,
        cookiesPs: 1,
        unbuffedCps: 1,
        OnAscend: 0,
        AscendTimer: 0,
        ascensionMode: 0,
        fps: 30,
        buffs: {},
        prefs: { askLumps: 0 },
        ObjectsById: [],
        Objects: {},
        Upgrades: {},
        clicks: 0,
        canLumps: () => true,
        clickLump() {
            game.clicks++;
            if (Date.now() - game.lumpT >= game.lumpRipeAge) {
                game.lumpT = Date.now();
                game.lumps += game.lumpCurrentType === 2 ? 4 : 1;
            }
        },
        ...over,
    };
    return game;
}

function fakeLoop() {
    const systems = {};
    return {
        systems,
        add(name, tick, { enabled = () => true } = {}) {
            systems[name] = { tick, enabled };
        },
        run(name) {
            if (systems[name].enabled()) systems[name].tick();
        },
    };
}

function fakeBuyer(purePayback) {
    return {
        invalidations: 0,
        invalidate() {
            this.invalidations++;
        },
        ranking: () => [{ payback: purePayback, purePayback }],
    };
}

test('while the ascension is under way a golden lump is left for it, and collected when it asks', () => {
    // The ascension asks from prepare(), after the wrinklers paid and the stock sold, before the
    // buildings go: a tick of the lump system's own could come after the sale, when the CpS that
    // caps the payout is gone (main.js:4492-4496, 7879, 16274).
    const game = fakeGame({ lumpCurrentType: 2 });
    const loop = fakeLoop();
    let ascending = false;
    const lumps = createLumps({ game, settings: { autoSL: 1 }, loop, ascending: () => ascending, goldenWait: () => Infinity });
    loop.run('lumpHarvest');
    assert.equal(game.clicks, 0, 'held for its payout while the run goes on');
    const held = lumps.hold();
    assert.ok(held > 0);
    ascending = true;
    for (let i = 0; i < 3; i++) loop.run('lumpHarvest');
    assert.equal(game.clicks, 0, 'never on a tick of its own once the ascension has begun');
    assert.equal(lumps.hold(), held, 'the bank it pays on is still kept');
    lumps.collectBeforeAscension();
    assert.equal(game.clicks, 1, 'collected before the ascension takes the bank');
    assert.equal(lumps.hold(), 0);
});

test('the ascension\'s collection clicks only with harvesting on, and keeps a lump that is not ripe', () => {
    const settings = { autoSL: 0 };
    const game = fakeGame({ lumpCurrentType: 2 });
    const lumps = createLumps({ game, settings, loop: fakeLoop(), ascending: () => true, goldenWait: () => Infinity });
    lumps.collectBeforeAscension();
    assert.equal(game.clicks, 0, 'harvesting is off');
    settings.autoSL = 1;
    game.lumpT = Date.now() - 1000; // just started growing
    lumps.collectBeforeAscension();
    assert.equal(game.clicks, 0, 'a click now pays nothing and the lump carries over');
});

test('an ordinary lump ripening during the ascension is harvested as usual', () => {
    const game = fakeGame();
    const loop = fakeLoop();
    createLumps({ game, settings: { autoSL: 1 }, loop, ascending: () => true });
    loop.run('lumpHarvest');
    assert.equal(game.clicks, 1, 'its yield does not depend on the bank');
});

test('the buyer is told when a golden hold starts and when it ends, not on every tick', () => {
    const game = fakeGame({ lumpCurrentType: 2 });
    const loop = fakeLoop();
    const buyer = fakeBuyer(36000);
    const settings = { autoSL: 1, autoBuy: 1 };
    const lumps = createLumps({ game, settings, loop, buyer, goldenWait: () => Infinity });
    loop.run('lumpHarvest');
    assert.equal(lumps.hold(), 86400, 'a day of CpS, the payout cap');
    assert.equal(buyer.invalidations, 1);
    loop.run('lumpHarvest');
    assert.equal(buyer.invalidations, 1);
    settings.autoSL = 0;
    assert.equal(lumps.hold(), 0, 'switched off, nothing is held');
    settings.autoSL = 1;
    game.lumpT = Date.now() - game.lumpOverripeAge + 30 * 1000; // past the last safe moment
    loop.run('lumpHarvest');
    assert.equal(game.clicks, 1);
    assert.equal(lumps.hold(), 0);
    assert.equal(buyer.invalidations, 2, 'released');
});

test('Sugar frenzy never acts on a verdict left from the run before', () => {
    // Right after a reincarnation the ascension still holds the ended run's verdict (rated, rate
    // under the average) until its next tick; a frenzy then would land at the start of the new run.
    const startDate = Date.now() - 60 * 1000;
    const bought = [];
    const frenzy = { unlocked: 1, bought: 0, buy: () => bought.push(1) };
    const game = fakeGame({ startDate, lumps: 150, Upgrades: { 'Sugar frenzy': frenzy } });
    const loop = fakeLoop();
    let verdict = { ascend: true, instantRate: 0.9, averageRate: 1, rated: true, startDate: startDate - 86400 * 1000 };
    createLumps({ game, settings: { sugarFrenzy: 1 }, loop, run: () => verdict });
    loop.run('sugarFrenzy');
    assert.equal(bought.length, 0);
    verdict = { ...verdict, ascend: false, startDate };
    loop.run('sugarFrenzy');
    assert.equal(bought.length, 1, 'a verdict on this run is acted on');
});

test('Sugar frenzy stands aside while the inherited Sugar frenzy option is on', () => {
    const loop = fakeLoop();
    const settings = { sugarFrenzy: 1, autoSugarFrenzy: 1 };
    createLumps({ game: fakeGame(), settings, loop });
    assert.equal(loop.systems.sugarFrenzy.enabled(), false);
    settings.autoSugarFrenzy = 0;
    assert.equal(loop.systems.sugarFrenzy.enabled(), true);
});
