import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('the infobox is computed a few times a second and drawn after the game clears its canvas', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            window.__computes = 0;
            const real = window.updateTimers;
            window.updateTimers = function () {
                window.__computes++;
                return real.apply(this, arguments);
            };
        });
        await game.advanceSeconds(10);
        const computes = await game.eval(() => window.__computes);
        assert.ok(computes >= 36 && computes <= 39, `expected about 37 computations in 10 seconds, got ${computes}`);

        // One real draw of the game: the left canvas is cleared first, the mod must draw after that.
        const order = await game.eval(() => {
            const events = [];
            const proto = CanvasRenderingContext2D.prototype;
            const clearRect = proto.clearRect;
            proto.clearRect = function () {
                if (this.canvas && this.canvas.id === 'backgroundLeftCanvas') events.push('clear');
                return clearRect.apply(this, arguments);
            };
            const draw = window.drawInfobox;
            window.drawInfobox = function () {
                events.push('infobox');
                return draw.apply(this, arguments);
            };
            try {
                Game.Draw();
            } finally {
                proto.clearRect = clearRect;
                window.drawInfobox = draw;
            }
            return events;
        });
        assert.ok(order.includes('clear'), 'the game should have cleared the left canvas');
        assert.ok(order.includes('infobox'), 'the mod should draw during the game\'s draw');
        assert.ok(order.lastIndexOf('clear') < order.indexOf('infobox'), `drawn before the clear: ${order.join(' ')}`);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});
