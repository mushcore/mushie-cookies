// The click pump against a stand-in game that counts clicks the way the real one does
// (main.js:4766-4799), on a fake clock with fake timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuard } from '../../src/core/guard.js';
import { createLoop } from '../../src/core/loop.js';
import { createClicker } from '../../src/systems/clicker.js';

function world({ settings = { autoClick: 1, cookieClickSpeed: 250 } } = {}) {
    const clock = { now: 1000000 };
    const queue = []; // { at, fn, id }
    let nextId = 1;
    const timers = {
        set(fn, ms) {
            const id = nextId++;
            queue.push({ at: clock.now + Math.max(0, ms), fn, id });
            return id;
        },
        clear(id) {
            const i = queue.findIndex((t) => t.id === id);
            if (i >= 0) queue.splice(i, 1);
        },
    };
    const game = {
        fps: 30,
        T: 100,
        OnAscend: 0,
        AscendTimer: 0,
        lastClick: 0,
        cookieClicks: 0,
        Click: 0,
        specialTabHovered: 0,
        buffs: {},
        calls: 0,
        ClickCookie() {
            this.calls++;
            const now = clock.now;
            if (this.OnAscend || this.AscendTimer > 0 || this.T < 3 || now - this.lastClick < 20) {
                // not counted
            } else {
                this.cookieClicks++;
                this.lastClick = now;
            }
            this.Click = 0;
        },
    };
    const guards = createGuard({ maxFailures: 5 });
    const loop = createLoop(guards);
    const clicker = createClicker({ game, settings, loop, guard: guards.guard, timers, now: () => clock.now });
    let frame = 0;
    // Runs timers and frames in time order for `ms` milliseconds.
    function run(ms) {
        const end = clock.now + ms;
        let nextFrame = clock.now + 1000 / 30;
        for (;;) {
            queue.sort((a, b) => a.at - b.at || a.id - b.id);
            const t = queue[0];
            const at = Math.min(t ? t.at : Infinity, nextFrame);
            if (at > end) break;
            clock.now = at;
            if (t && t.at <= nextFrame) {
                queue.shift();
                t.fn();
            } else {
                loop.run(++frame);
                nextFrame += 1000 / 30;
            }
        }
        clock.now = end;
    }
    return { game, settings, clicker, guards, run, queue, clock };
}

test('clicks as fast as the game counts, with no wasted calls', () => {
    const w = world();
    w.run(100); // starts on the first frame
    const before = { clicks: w.game.cookieClicks, calls: w.game.calls };
    w.run(10000);
    assert.equal(w.game.cookieClicks - before.clicks, 500, '50 a second');
    assert.equal(w.game.calls - before.calls, 500, 'every call counted');
});

test('the speed is a cap: 10 a second clicks 10 a second', () => {
    const w = world({ settings: { autoClick: 1, cookieClickSpeed: 10 } });
    w.run(100);
    const before = w.game.cookieClicks;
    w.run(10000);
    assert.equal(w.game.cookieClicks - before, 100);
});

test("a player's click on a wrinkler or a tab survives the pump", () => {
    const w = world();
    w.run(100);
    w.game.Click = 1; // a player's click on the page (main.js:4860)
    w.run(200);
    assert.equal(w.game.Click, 1, 'the synthetic call must not eat the human click');
});

test('keeps clicking while the mouse rests on the dragon tab', () => {
    const w = world();
    w.game.specialTabHovered = 'dragon';
    w.run(1100);
    assert.ok(w.game.cookieClicks >= 50, `${w.game.cookieClicks} clicks`);
});

test('does not call while ascending, and waits a frame at a time rather than spinning', () => {
    const w = world();
    w.run(100);
    w.game.OnAscend = 1;
    const calls = w.game.calls;
    w.run(10000);
    assert.equal(w.game.calls, calls, 'no call reaches the game while ascending');
    assert.ok(w.queue.length <= 1, 'one timer at most');
    w.game.OnAscend = 0;
    const clicks = w.game.cookieClicks;
    w.run(1000);
    assert.ok(w.game.cookieClicks - clicks >= 45, 'resumes after the ascension');
});

test('a player click in between moves the next call to 20 ms after it', () => {
    const w = world();
    w.run(1000);
    w.run(w.game.lastClick + 20 - w.clock.now + 0.5); // just past the pump's next click
    const pumped = w.game.lastClick;
    w.run(pumped + 10 - w.clock.now);
    w.game.lastClick = w.clock.now; // a player's click, counted 10 ms after the pump's
    const clicks = w.game.cookieClicks;
    const calls = w.game.calls;
    w.run(19);
    assert.equal(w.game.cookieClicks, clicks, 'nothing counted inside the gap after the player');
    assert.equal(w.game.calls - calls, 1, 'the call planned for the old gap is turned away once');
    w.run(2);
    assert.equal(w.game.cookieClicks, clicks + 1, 'counted as soon as the gap passed');
});

test('switching clicking off stops the timer; on again restarts it', () => {
    const w = world();
    w.run(1000);
    w.settings.autoClick = 0;
    w.run(100);
    const clicks = w.game.cookieClicks;
    w.run(5000);
    assert.equal(w.game.cookieClicks, clicks);
    assert.equal(w.queue.length, 0, 'no timer left behind');
    w.settings.autoClick = 1;
    w.run(1000);
    assert.ok(w.game.cookieClicks - clicks >= 45);
});

test('Autofrenzy clicks only during a click buff when Autoclick is off', () => {
    const w = world({ settings: { autoClick: 0, cookieClickSpeed: 0, autoFrenzy: 1, frenzyClickSpeed: 250 } });
    w.run(2000);
    assert.equal(w.game.cookieClicks, 0);
    w.game.buffs['Click frenzy'] = { name: 'Click frenzy', multClick: 777 };
    w.run(2000);
    assert.ok(w.game.cookieClicks >= 90, `${w.game.cookieClicks} clicks during the frenzy`);
    delete w.game.buffs['Click frenzy'];
    w.run(100);
    const clicks = w.game.cookieClicks;
    w.run(2000);
    assert.equal(w.game.cookieClicks, clicks, 'stops when the buff ends');
});

test('a click handler that keeps throwing is switched off by the guard, not retried forever', () => {
    const w = world();
    w.game.ClickCookie = () => {
        throw new Error('broken');
    };
    w.run(5000);
    const s = w.guards.status()['clicker:pump'];
    assert.equal(s.disabled, true);
    assert.equal(s.failures, 5);
    assert.equal(w.queue.length, 0);
});

test('measures the accepted rate from the click counter', () => {
    const w = world({ settings: { autoClick: 1, cookieClickSpeed: 40 } });
    assert.equal(w.clicker.rate(), null);
    w.run(10000);
    assert.ok(Math.abs(w.clicker.rate() - 40) < 1, String(w.clicker.rate()));
});
