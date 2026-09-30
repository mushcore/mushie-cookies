// The shimmer system against a stand-in game whose shimmers leave the list when popped, as the
// real ones do (main.js:5225-5245).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuard } from '../../src/core/guard.js';
import { createLoop } from '../../src/core/loop.js';
import { createShimmers } from '../../src/systems/shimmers.js';

function world({ settings = { autoGC: 1, autoReindeer: 1, autoFortune: 1 }, imminent = false } = {}) {
    const popped = [];
    const game = {
        shimmers: [],
        Click: 0,
        OnAscend: 0,
        AscendTimer: 0,
        TickerEffect: 0,
        tickerClicks: 0,
        cookies: 0,
        cookiesPs: 1000,
        unbuffedCps: 1000,
        tickerL: {
            click() {
                game.tickerClicks++;
                // The fortune golden cookie appears at once (main.js:7640).
                if (game.TickerEffect && game.TickerEffect.sub === 'fortuneGC') game.spawn('golden', { fortune: true });
                game.TickerEffect = 0;
            },
        },
    };
    game.spawn = (type, extra = {}) => {
        const s = {
            type,
            id: game.shimmers.length + popped.length,
            ...extra,
            pop() {
                game.Click = 0; // main.js:5229
                popped.push(this);
                const i = game.shimmers.indexOf(this);
                if (i >= 0) game.shimmers.splice(i, 1);
            },
        };
        game.shimmers.push(s);
        return s;
    };
    const guards = createGuard();
    const loop = createLoop(guards);
    // A system registered before the shimmer system, as the legacy infobox is (fc_main.js), that
    // reads the screen the way the grimoire's forecast does.
    const seen = [];
    loop.add('reader', () => seen.push(game.shimmers.filter((s) => s.type === 'golden').length));
    const shimmers = createShimmers({ game, settings, loop, ascensionImminent: () => imminent });
    let frame = 0;
    const run = (frames = 1) => {
        for (let i = 0; i < frames; i++) loop.run(++frame);
    };
    return { game, settings, shimmers, popped, run, guards, seen };
}

test('pops every golden cookie on screen in one frame, none skipped', () => {
    const w = world();
    for (let i = 0; i < 5; i++) w.game.spawn('golden');
    w.run(1);
    assert.equal(w.popped.length, 5);
    assert.equal(w.game.shimmers.length, 0);
});

test('wrath cookies and storm drops are golden shimmers and are popped too; reindeer before them', () => {
    const w = world();
    w.game.spawn('golden', { wrath: 1 });
    w.game.spawn('reindeer');
    w.game.spawn('golden', { force: 'cookie storm drop' });
    w.run(1);
    assert.deepEqual(w.popped.map((s) => s.type), ['reindeer', 'golden', 'golden']);
    assert.deepEqual(w.shimmers.report().popped, { golden: 0, wrath: 1, drop: 1, reindeer: 1 });
});

test('each kind follows its own setting', () => {
    const w = world({ settings: { autoGC: 0, autoReindeer: 1, autoFortune: 0 } });
    w.game.spawn('golden');
    w.game.spawn('reindeer');
    w.run(1);
    assert.deepEqual(w.popped.map((s) => s.type), ['reindeer']);
    w.settings.autoReindeer = 0;
    w.game.spawn('reindeer');
    w.run(1);
    assert.equal(w.popped.length, 1);
});

test("a player's click survives the pops", () => {
    const w = world();
    w.game.spawn('golden');
    w.game.Click = 1;
    w.run(1);
    assert.equal(w.popped.length, 1);
    assert.equal(w.game.Click, 1);
});

test('a shimmer another pop already removed is not popped again', () => {
    const w = world();
    const a = w.game.spawn('golden');
    const b = w.game.spawn('golden');
    a.pop = function () {
        w.popped.push(this);
        w.game.shimmers.splice(0, 2); // a pop that also takes another shimmer with it
    };
    w.run(1);
    assert.deepEqual(w.popped, [a]);
    assert.ok(!w.popped.includes(b));
});

test('nothing is popped during an ascension', () => {
    const w = world();
    w.game.spawn('golden');
    w.game.OnAscend = 1;
    w.run(30);
    assert.equal(w.popped.length, 0);
});

test('fortunes: upgrades and the golden cookie on sight; the hour of CpS only when the bank covers it', () => {
    const w = world();
    w.game.TickerEffect = { type: 'fortune', sub: { name: 'Fortune #003' } };
    w.run(15);
    assert.equal(w.game.tickerClicks, 1);
    w.game.TickerEffect = { type: 'fortune', sub: 'fortuneGC' };
    w.run(15);
    assert.equal(w.game.tickerClicks, 2);
    const cps = { type: 'fortune', sub: 'fortuneCPS' };
    w.game.TickerEffect = cps;
    w.game.cookies = 1000; // a second of CpS
    w.run(30);
    assert.equal(w.game.tickerClicks, 2, 'left for later');
    assert.equal(w.game.TickerEffect, cps);
    w.game.cookies = 3600 * 1000; // the bank grew while it was on the ticker
    w.run(15);
    assert.equal(w.game.tickerClicks, 3);
    assert.deepEqual(w.shimmers.report().fortunes, { taken: 3, left: 1 });
});

test('the golden cookie a fortune brings is popped in the frame the fortune is taken', () => {
    const w = world();
    w.game.TickerEffect = { type: 'fortune', sub: 'fortuneGC' };
    w.run(15);
    assert.equal(w.game.tickerClicks, 1);
    assert.equal(w.game.shimmers.length, 0, 'no golden cookie left on screen for a forecast later in the frame');
    assert.deepEqual(w.popped.map((s) => !!s.fortune), [true]);
});

test('the shimmer system runs first on the loop: a system registered earlier never sees a golden cookie', () => {
    const w = world();
    w.run(1);
    w.game.spawn('golden');
    w.game.spawn('golden', { wrath: 1 });
    w.run(1);
    assert.deepEqual(w.seen, [0, 0]);
    assert.equal(w.popped.length, 2);
});

test('a news item that is not a fortune is never clicked', () => {
    const w = world();
    w.game.TickerEffect = 0;
    w.run(60);
    assert.equal(w.game.tickerClicks, 0);
});

test('the hour of CpS is taken for any payout when an ascension is imminent', () => {
    const w = world({ imminent: true });
    w.game.TickerEffect = { type: 'fortune', sub: 'fortuneCPS' };
    w.game.cookies = 1000;
    w.run(15);
    assert.equal(w.game.tickerClicks, 1);
});

test('the system is registered under its own guard: a failure elsewhere does not stop it', () => {
    const w = world();
    const status = w.guards.status();
    assert.ok('shimmers' in status);
    assert.ok(!('legacy:autoCookie' in status));
});
