import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('a system that always throws is switched off and the rest keep running', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            window.__good = 0;
            MushieCookies.loop.add('test:bad', () => {
                throw new Error('always');
            });
            MushieCookies.loop.add('test:good', () => window.__good++);
        });
        game.clearLogs();
        await game.advance(60);
        const out = await game.eval(() => ({ good: window.__good, bad: MushieCookies.status()['test:bad'] }));
        assert.equal(out.good, 60);
        assert.equal(out.bad.disabled, true);
        assert.equal(out.bad.failures, 5);
        assert.equal(game.errors.filter((e) => e.includes('test:bad')).length, 5, 'each failure is reported once');
    } finally {
        await game.close();
    }
});

test('the legacy main loop survives an exception and keeps its timer', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            window.__calls = 0;
            const real = window.updateCaches;
            window.updateCaches = function () {
                window.__calls++;
                if (window.__calls <= 2) throw new Error('injected');
                return real.apply(this, arguments);
            };
        });
        game.clearLogs();
        await game.advanceSeconds(5);
        const out = await game.eval(() => ({
            calls: window.__calls,
            processing: FrozenCookies.processing,
            state: MushieCookies.status()['legacy:autoCookie'],
        }));
        assert.ok(out.calls > 10, `loop stopped after ${out.calls} calls`);
        assert.equal(out.processing, false);
        assert.equal(out.state.failures, 2);
        assert.equal(out.state.disabled, false);
    } finally {
        await game.close();
    }
});
