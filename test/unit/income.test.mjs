import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateIncome } from '../../src/core/income.js';

const quiet = {
    cps: 1000, clickPower: 10, clicksPerSecond: 0, bank: 0,
    wrinklers: { count: 0, returnMult: 1.1 },
    golden: { meanInterval: Infinity, durationMult: 1, gainMult: 1, probabilities: {}, buildingSpecialMean: 0 },
};
const golden = (over) => ({ ...quiet.golden, ...over });
const close = (a, b) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));

test('with no clicks, no wrinklers and no golden cookies, income is the CpS', () => {
    assert.equal(estimateIncome(quiet).total, 1000);
});

test('clicking adds clicks times click power', () => {
    assert.equal(estimateIncome({ ...quiet, clicksPerSecond: 50 }).total, 1500);
});

test('ten wrinklers return about six times the withered CpS', () => {
    const out = estimateIncome({ ...quiet, wrinklers: { count: 10, returnMult: 1.1 } });
    assert.ok(close(out.passive, 6000), String(out.passive));
});

test('a frenzy active a tenth of the time adds sixty percent', () => {
    const out = estimateIncome({ ...quiet, golden: golden({ meanInterval: 770, probabilities: { frenzy: 1 } }) });
    assert.ok(close(out.passive, 1600), String(out.passive));
});

test('lucky pays fifteen percent of the bank, up to fifteen minutes of CpS', () => {
    const g = golden({ meanInterval: 300, probabilities: { 'multiply cookies': 1 } });
    const small = estimateIncome({ ...quiet, golden: g, bank: 1000 });
    const capped = estimateIncome({ ...quiet, golden: g, bank: 1e9 });
    assert.ok(close(small.golden, (0.15 * 1000 + 13) / 300));
    assert.ok(close(capped.golden, (900 * 1000 + 13) / 300));
});

test('click frenzy multiplies click income only', () => {
    const g = golden({ meanInterval: 1300, probabilities: { 'click frenzy': 1 } });
    const out = estimateIncome({ ...quiet, golden: g, clicksPerSecond: 50 });
    assert.equal(out.passive, 1000);
    assert.ok(close(out.click, 500 * (1 + 776 * 0.01)), String(out.click));
});

test('get lucky doubles a buff duration and so its share of time', () => {
    const g = golden({ meanInterval: 770, durationMult: 2, probabilities: { frenzy: 1 } });
    assert.ok(close(estimateIncome({ ...quiet, golden: g }).passive, 2200));
});

test('a share of time is capped at one', () => {
    const g = golden({ meanInterval: 1, probabilities: { frenzy: 1 } });
    assert.ok(close(estimateIncome({ ...quiet, golden: g }).passive, 7000));
});

test('a wrath clot lowers income and ruin costs cookies', () => {
    const clot = estimateIncome({ ...quiet, golden: golden({ meanInterval: 660, probabilities: { clot: 1 } }) });
    assert.ok(clot.passive < 1000);
    const ruin = estimateIncome({ ...quiet, bank: 1e6, golden: golden({ meanInterval: 100, probabilities: { 'ruin cookies': 1 } }) });
    assert.ok(ruin.golden < 0);
});

test('building special uses the mean building count', () => {
    const g = golden({ meanInterval: 300, probabilities: { 'building special': 1 }, buildingSpecialMean: 100 });
    // ×11 for 30 of every 300 seconds: +10 × 0.1 = +100%.
    assert.ok(close(estimateIncome({ ...quiet, golden: g }).passive, 2000));
});

test('frenzy and click frenzy together multiply click income by both', () => {
    const g = golden({ meanInterval: 1000, probabilities: { frenzy: 0.5, 'click frenzy': 0.5 } });
    const out = estimateIncome({ ...quiet, golden: g, clicksPerSecond: 50 });
    const frenzyFactor = 1 + 6 * (0.5 * 77) / 1000;
    const clickFactor = 1 + 776 * (0.5 * 13) / 1000;
    assert.ok(close(out.click, 500 * frenzyFactor * clickFactor));
});

test('no golden cookies at all is handled without division by zero', () => {
    const out = estimateIncome({ ...quiet, golden: golden({ meanInterval: 0, probabilities: { frenzy: 1 } }) });
    assert.equal(out.total, 1000);
    assert.ok(Object.values(out.byOutcome).every((v) => v === 0));
});

test('wrinklers give nothing back when nobody pops them, and wither at the real rate', () => {
    const popped = estimateIncome({ ...quiet, wrinklers: { count: 10, returnMult: 1.1, suckRate: 0.05 } });
    const kept = estimateIncome({ ...quiet, wrinklers: { count: 10, returnMult: 0, suckRate: 0.05 } });
    const guts = estimateIncome({ ...quiet, wrinklers: { count: 10, returnMult: 0, suckRate: 0.06 } });
    assert.ok(Math.abs(popped.passive - 6000) < 1e-9);
    assert.ok(Math.abs(kept.passive - 500) < 1e-9, String(kept.passive));
    assert.ok(Math.abs(guts.passive - 400) < 1e-9);
});

test('golden payouts are sized from real CpS, not the wrinkler-inflated figure', () => {
    const g = golden({ meanInterval: 300, probabilities: { 'multiply cookies': 1 } });
    const with10 = estimateIncome({ ...quiet, bank: 1e12, golden: g, wrinklers: { count: 10, returnMult: 1.1, suckRate: 0.05 } });
    assert.ok(Math.abs(with10.golden - (900 * 1000 + 13) / 300) < 1e-9);
});

test('a cookie storm pays every drop it makes at the frame rate, with the gain multiplier', () => {
    // A drop on half the frames for 7 s × duration, each 1 to 7 minutes of CpS × gain (main.js:5257-5261, 5597-5599).
    const g = golden({ meanInterval: 100, probabilities: { 'cookie storm': 1 }, gainMult: 1.5, fps: 30, stormReach: 1 });
    const out = estimateIncome({ ...quiet, golden: g });
    assert.ok(close(out.byOutcome['cookie storm'], (7 * 30 * 0.5 * 4 * 60 * 1000 * 1.5) / 100), String(out.byOutcome['cookie storm']));
    const fast = estimateIncome({ ...quiet, golden: { ...g, fps: 60 } });
    assert.ok(close(fast.byOutcome['cookie storm'], 2 * out.byOutcome['cookie storm']), 'drops are rolled per frame');
    const half = estimateIncome({ ...quiet, golden: { ...g, stormReach: 0.5 } });
    assert.ok(close(half.byOutcome['cookie storm'], 0.5 * out.byOutcome['cookie storm']), 'only the drops reached pay');
});
