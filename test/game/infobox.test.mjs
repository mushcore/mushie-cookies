import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('the infobox costs nothing while off, and when on is computed a few times a second and drawn after the game clears its canvas', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            window.__computes = 0;
            const real = window.updateTimers;
            window.updateTimers = function () {
                window.__computes++;
                return real.apply(this, arguments);
            };
            window.__measures = 0;
            const measure = $.fn.measureText;
            $.fn.measureText = function () {
                window.__measures++;
                return measure.apply(this, arguments);
            };
        });
        // The harness runs only the game's logic; its draws are made here, ten at a time.
        const drawTen = () =>
            game.eval(() => {
                const before = window.__measures;
                for (let i = 0; i < 10; i++) Game.Draw();
                return window.__measures - before;
            });

        // Off is the default.
        await game.advanceSeconds(10);
        const off = await game.eval(() => ({ fancyui: FrozenCookies.fancyui, computes: window.__computes }));
        assert.deepEqual(off, { fancyui: 0, computes: 0 }, 'nothing is computed while the infobox is off');
        assert.equal(await drawTen(), 0, 'nor measured when the game draws');

        await game.eval(() => setPreferenceDirect('fancyui', 3));
        await game.advanceSeconds(10);
        const computes = await game.eval(() => window.__computes);
        assert.ok(computes >= 36 && computes <= 39, `expected about 37 computations in 10 seconds, got ${computes}`);
        assert.equal(await drawTen(), 0, 'the labels are measured when computed, not on every draw');

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
