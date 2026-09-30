import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('the infobox refreshes four times a second, not every frame', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            window.__draws = 0;
            const real = window.updateTimers;
            window.updateTimers = function () {
                window.__draws++;
                return real.apply(this, arguments);
            };
        });
        await game.advanceSeconds(10);
        const draws = await game.eval(() => window.__draws);
        assert.ok(draws >= 36 && draws <= 39, `expected about 37 refreshes in 10 seconds, got ${draws}`);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});
