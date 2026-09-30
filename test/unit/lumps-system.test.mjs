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

test('a golden lump ripe at an ascension is collected on its second settling tick, after the wrinklers pay', () => {
    const game = fakeGame({ lumpCurrentType: 2 });
    const loop = fakeLoop();
    let settling = false;
    createLumps({ game, settings: { autoSL: 1 }, loop, ascending: () => settling, goldenWait: () => Infinity });
    loop.run('lumpHarvest');
    assert.equal(game.clicks, 0, 'held for its payout while the run goes on');
    settling = true;
    loop.run('lumpHarvest');
    assert.equal(game.clicks, 0, 'the wrinklers collected this tick pay on the next frames');
    loop.run('lumpHarvest');
    assert.equal(game.clicks, 1, 'collected before the ascension takes the bank');
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

test('Sugar frenzy stands aside while the inherited Sugar frenzy option is on', () => {
    const loop = fakeLoop();
    const settings = { sugarFrenzy: 1, autoSugarFrenzy: 1 };
    createLumps({ game: fakeGame(), settings, loop });
    assert.equal(loop.systems.sugarFrenzy.enabled(), false);
    settings.autoSugarFrenzy = 0;
    assert.equal(loop.systems.sugarFrenzy.enabled(), true);
});
