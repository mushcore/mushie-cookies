import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CLICK_GAP_MS,
    clickGap,
    delayAfterCall,
    clickBuffRunning,
    createRateMeter,
    modelClickRate,
} from '../../src/core/clicker.js';

test('the game counts one click per 20 ms, so the gap is 20 ms at any cap of 50 or more', () => {
    assert.equal(CLICK_GAP_MS, 20);
    assert.equal(clickGap(50), 20);
    assert.equal(clickGap(51), 20, 'a cap between 50 and 100 no longer loses slots');
    assert.equal(clickGap(250), 20);
    assert.equal(clickGap(1000), 20);
    assert.equal(clickGap(10), 100, 'below 50 the cap spaces the clicks');
    assert.equal(clickGap(0), Infinity, 'a cap of 0 does not click');
    assert.equal(clickGap(-5), Infinity);
    assert.equal(clickGap(NaN), Infinity);
});

test('after a counted click the next call is timed for one gap after the click, not after the call', () => {
    assert.equal(delayAfterCall({ accepted: true, now: 1000, lastClick: 1000, gap: 20, frameMs: 33 }), 20);
    // The click's own sound and particles took 3 ms (main.js:4783-4791): they come out of the wait.
    assert.equal(delayAfterCall({ accepted: true, now: 1003, lastClick: 1000, gap: 20, frameMs: 33 }), 17);
    // A click that took longer than the gap: call again at once.
    assert.equal(delayAfterCall({ accepted: true, now: 1025, lastClick: 1000, gap: 20, frameMs: 33 }), 0);
});

test('a rejected call is retried the moment the game will count it', () => {
    // A timer that woke a millisecond early, on the integer clock.
    assert.equal(delayAfterCall({ accepted: false, now: 1019, lastClick: 1000, gap: 20, frameMs: 33 }), 1);
    // A human click took the slot in between: wait for the gap after it.
    assert.equal(delayAfterCall({ accepted: false, now: 1030, lastClick: 1025, gap: 20, frameMs: 33 }), 15);
});

test('a call rejected for another reason (ascending, first frames) waits a frame instead of spinning', () => {
    assert.equal(delayAfterCall({ accepted: false, now: 5000, lastClick: 1000, gap: 20, frameMs: 33 }), 33);
});

test('click buffs are Click frenzy, Dragonflight, Devastation and Cursed finger; CpS buffs are not', () => {
    const buff = (name, extra) => ({ name, ...extra });
    assert.equal(clickBuffRunning({}), false);
    assert.equal(clickBuffRunning({ Frenzy: buff('Frenzy', { multCpS: 7 }) }), false);
    assert.equal(clickBuffRunning({ 'Click frenzy': buff('Click frenzy', { multClick: 777 }) }), true);
    assert.equal(clickBuffRunning({ Dragonflight: buff('Dragonflight', { multClick: 1111 }) }), true);
    assert.equal(clickBuffRunning({ Devastation: buff('Devastation', { multClick: 1.5 }) }), true);
    // Cursed finger has no multClick: every click pays the finger's power (main.js:4746).
    assert.equal(clickBuffRunning({ 'Cursed finger': buff('Cursed finger', { multCpS: 0, power: 1e6 }) }), true);
    assert.equal(clickBuffRunning({ Sugar: buff('Sugar blessing', {}) }), false);
});

test('the rate meter reports nothing until it has a full sample', () => {
    const meter = createRateMeter({ tau: 60 });
    assert.equal(meter.rate(), null);
    meter.sample(100, 0);
    assert.equal(meter.rate(), null, 'one reading is not a rate');
});

test('the first sample is taken as it is; later ones move the average by elapsed time', () => {
    const meter = createRateMeter({ tau: 60 });
    meter.sample(0, 0);
    meter.sample(40, 1000); // 40 a second
    assert.equal(meter.rate(), 40);
    meter.sample(40 + 20, 2000); // 20 a second for one second
    const expected = 40 + (20 - 40) * (1 - Math.exp(-1 / 60));
    assert.ok(Math.abs(meter.rate() - expected) < 1e-9, String(meter.rate()));
});

test('a long stretch at a new rate converges to it', () => {
    const meter = createRateMeter({ tau: 60 });
    let clicks = 0;
    meter.sample(clicks, 0);
    for (let t = 1; t <= 600; t++) meter.sample((clicks += 45), t * 1000);
    for (let t = 601; t <= 1200; t++) meter.sample((clicks += 6), t * 1000);
    assert.ok(Math.abs(meter.rate() - 6) < 0.01, String(meter.rate()));
});

test('a burst of frames at one wall time is not a rate; pausing forgets the open window', () => {
    const meter = createRateMeter({ tau: 60 });
    meter.sample(0, 0);
    meter.sample(40, 1000);
    meter.sample(45, 1000); // catch-up frames at the same wall time: no elapsed time
    assert.equal(meter.rate(), 40);
    meter.pause(); // stopped clicking (ascending): the next reading starts a new window
    meter.sample(45, 60000);
    assert.equal(meter.rate(), 40, 'the pause is not averaged in as zero clicks');
    meter.sample(85, 61000);
    assert.equal(meter.rate(), 40);
});

test('the income model uses the measured rate, capped at what the game counts', () => {
    assert.equal(modelClickRate({ autoClick: 1, speed: 250, measured: 38.5 }), 38.5);
    assert.equal(modelClickRate({ autoClick: 1, speed: 250, measured: 70 }), 50);
    assert.equal(modelClickRate({ autoClick: 0, speed: 250, measured: 38.5 }), 0, 'no clicking, no click income');
    assert.equal(modelClickRate({ autoClick: 1, speed: 250, measured: null }), 50, 'before a measurement, the cap');
    assert.equal(modelClickRate({ autoClick: 1, speed: 10, measured: null }), 10);
    assert.equal(modelClickRate({ autoClick: 1, speed: 10, measured: 38 }), 10, 'nor more than the cap asked for');
    assert.equal(modelClickRate({ autoClick: 1, speed: 0, measured: null }), 0);
});
