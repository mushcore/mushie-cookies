// The ascension system's run clock against a stand-in game. The game makes nothing while the
// machine sleeps (it catches up at most 5 s, main.js:16788), so the rate rule must be timed by
// play: a rate measured across hours that were never played reads as a run that stopped growing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAscension } from '../../src/systems/ascension.js';

const FPS = 30;
const HOUR = 3600;

/** A wall clock the test moves by hand, as Date.now() for the system under test. */
function wallClock(t, startMs) {
    const realNow = Date.now;
    let now = startMs;
    Date.now = () => now;
    t.after(() => {
        Date.now = realNow;
    });
    return {
        now: () => now,
        move(ms) {
            now += ms;
        },
    };
}

/**
 * A game whose projected prestige is its cookies (HowMuchPrestige is the identity). A running
 * frenzy holds the ascension itself, so the tests read the rule's verdict without the planning
 * an ascension needs, which only the real game can do.
 */
function fakeGame(over = {}) {
    return {
        fps: FPS,
        prestige: 100,
        heavenlyChips: 0,
        resets: 1,
        startDate: Date.now(),
        cookiesReset: 100,
        cookiesEarned: 0,
        OnAscend: 0,
        AscendTimer: 0,
        buffs: { Frenzy: { multCpS: 7, time: 60 * FPS } },
        Upgrades: {},
        HowMuchPrestige: (cookies) => cookies,
        Has: () => false,
        HasUnlocked: () => true,
        ...over,
    };
}

/** Runs the systems every frame, as the logic hook does, moving the wall clock with the frames. */
function fakeLoop(clock) {
    const systems = [];
    let frame = 0;
    return {
        add(name, tick, { everyFrames = 1, enabled = () => true } = {}) {
            systems.push({ tick, everyFrames, enabled });
        },
        play(seconds, eachSecond = () => {}) {
            for (let i = 0; i < seconds * FPS; i++) {
                frame++;
                clock.move(1000 / FPS);
                if (frame % FPS === 0) eachSecond();
                for (const s of systems) if (frame % s.everyFrames === 0 && s.enabled()) s.tick(frame);
            }
        },
    };
}

/** A run an hour old when the mod first sees it, still growing exponentially. */
function growingRun(t) {
    const clock = wallClock(t, 1e12);
    const game = fakeGame({ startDate: clock.now() - HOUR * 1000 });
    const settings = { autoAscendToggle: 1 };
    const loop = fakeLoop(clock);
    const ascension = createAscension({ game, settings, loop });
    let played = 0;
    const grow = () => {
        played++;
        game.cookiesEarned = Math.exp((HOUR + played) / 1800);
    };
    grow();
    return { clock, game, settings, loop, ascension, grow };
}

test('a machine sleep does not end a run that is still growing', (t) => {
    const { clock, loop, ascension, grow } = growingRun(t);
    loop.play(1200, grow);
    assert.match(ascension.verdict().reason, /still growing/, 'the premise: awake, the run is growing faster than its average');

    clock.move(8 * HOUR * 1000); // asleep: the clock moves on, no frame runs
    loop.play(60, grow);
    const verdict = ascension.verdict();
    assert.equal(verdict.ascend, false, verdict.reason);
    assert.match(verdict.reason, /still growing/);
    assert.ok(verdict.instantRate > verdict.averageRate);
});

test('the run clock counts the run as the mod found it, then only what is played', (t) => {
    const { clock, loop, ascension, grow } = growingRun(t);
    loop.play(1, grow);
    assert.ok(Math.abs(ascension.report().runSeconds - (HOUR + 1)) < 1.5, 'joined midway: measured from where the run began');
    loop.play(1199, grow);
    clock.move(8 * HOUR * 1000);
    loop.play(60, grow);
    assert.ok(Math.abs(ascension.report().runSeconds - (HOUR + 1260)) < 1.5, `run clock ${ascension.report().runSeconds}`);
});

test('the run clock goes on while Auto Ascend is off, and a sleep then is not counted either', (t) => {
    const { clock, settings, loop, ascension, grow } = growingRun(t);
    loop.play(1200, grow);
    settings.autoAscendToggle = 0;
    loop.play(300, grow);
    clock.move(8 * HOUR * 1000);
    loop.play(60, grow);
    settings.autoAscendToggle = 1;
    loop.play(60, grow);
    assert.ok(Math.abs(ascension.report().runSeconds - (HOUR + 1620)) < 1.5, `run clock ${ascension.report().runSeconds}`);
    const verdict = ascension.verdict();
    assert.equal(verdict.ascend, false, verdict.reason);
});
