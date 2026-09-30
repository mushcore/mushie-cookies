import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAscend } from '../../src/core/ascension.js';

/** A run sampled every minute whose projected prestige follows `f(seconds)`. */
function run(f, seconds, prestige = 100) {
    const history = [];
    for (let t = 0; t <= seconds; t += 60) history.push({ t, projected: f(t) });
    return { prestige, projected: f(seconds), history, runSeconds: seconds };
}

test('a run still growing exponentially is not ended', () => {
    const f = (t) => 100 + Math.exp(t / 1800);
    for (const seconds of [3600, 7200, 14400]) {
        const out = shouldAscend(run(f, seconds));
        assert.equal(out.ascend, false, `${seconds}s: ${out.reason}`);
        assert.ok(out.instantRate >= out.averageRate);
    }
});

test('a run that grew and then flattened is ended once its current yield drops under its average', () => {
    // Fast growth for two hours, then a crawl.
    const f = (t) => 100 + (t < 7200 ? Math.exp(t / 900) : Math.exp(8) + (t - 7200) / 100);
    assert.equal(shouldAscend(run(f, 5400)).ascend, false, 'still in the fast phase');
    const flat = shouldAscend(run(f, 10800));
    assert.equal(flat.ascend, true, flat.reason);
    assert.ok(flat.instantRate < flat.averageRate);
});

test('the overhead makes the rule wait longer', () => {
    // Fast for an hour, then a crawl whose yield sits between the run's average with a free
    // restart and its average with a two-hour restart.
    const f = (t) => Math.exp(Math.log(101) + Math.min(t, 3600) / 600 + Math.max(0, t - 3600) * 8e-4) - 1;
    const cheap = shouldAscend({ ...run(f, 5400), overheadSeconds: 0 });
    const costly = shouldAscend({ ...run(f, 5400), overheadSeconds: 7200 });
    assert.equal(cheap.ascend, true, cheap.reason);
    assert.equal(costly.ascend, false, 'a costly restart lowers the average the current yield is measured against');
});

test('a minimum run length blocks an early trigger', () => {
    const f = (t) => 100 + Math.exp(Math.min(t, 600) / 100) + Math.max(0, t - 600) / 1000;
    assert.equal(shouldAscend({ ...run(f, 1500), minRunSeconds: 1800 }).reason, 'run too short');
    assert.equal(shouldAscend({ ...run(f, 1500), minRunSeconds: 600 }).ascend, true);
});

test('a first ascension waits for the target and ignores the rates', () => {
    const f = (t) => t / 10;
    const early = shouldAscend({ ...run(f, 3000, 0), firstTarget: 365 });
    assert.equal(early.ascend, false);
    assert.match(early.reason, /waits for 365/);
    const ready = shouldAscend({ ...run(f, 3660, 0), firstTarget: 365 });
    assert.equal(ready.ascend, true, ready.reason);
});

test('with less than a level to gain there is nothing to ascend for', () => {
    const out = shouldAscend({ prestige: 100, projected: 100.9, history: [{ t: 0, projected: 100 }], runSeconds: 99999 });
    assert.equal(out.ascend, false);
    assert.equal(out.reason, 'no prestige to gain');
});

test('a history shorter than half the window is not enough to judge', () => {
    const out = shouldAscend({
        prestige: 100,
        projected: 150,
        history: [{ t: 3000, projected: 149 }],
        runSeconds: 3100,
        minRunSeconds: 0,
    });
    assert.equal(out.reason, 'not enough history');
});

test('rates are reported for the menu even when not ascending', () => {
    const out = shouldAscend(run((t) => 100 + t, 7200));
    assert.ok(Number.isFinite(out.instantRate) && Number.isFinite(out.averageRate));
});

test('the verdict says whether the rate comparison decided it, for systems that time things to it', () => {
    // Sugar frenzy starts as the rate closes on the average; before the rule is live (a short run,
    // a thin history, a first ascension) the rates are not a judgement of the run's end.
    const f = (t) => 100 + t;
    assert.equal(shouldAscend(run(f, 7200)).rated, true);
    assert.equal(shouldAscend({ ...run(f, 1500), minRunSeconds: 1800 }).rated, false, 'run too short');
    assert.equal(shouldAscend({ ...run((t) => t / 10, 3000, 0), firstTarget: 365 }).rated, false, 'first ascension');
    assert.equal(shouldAscend({ prestige: 100, projected: 100.9, history: [{ t: 0, projected: 100 }], runSeconds: 99999 }).rated, false);
    const flat = (t) => 100 + (t < 7200 ? Math.exp(t / 900) : Math.exp(8) + (t - 7200) / 100);
    assert.equal(shouldAscend(run(flat, 10800)).rated, true, 'an ascension the rule decided');
});
