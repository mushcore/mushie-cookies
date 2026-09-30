// The clicker in the game: how many calls reach Game.ClickCookie and how many it counts, a
// player's clicks, the dragon tab, the measured rate the income model uses, and the buyer
// standing aside during click buffs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

async function withGame(run) {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            // Count every call that reaches the game's click handler.
            window.__calls = 0;
            const click = Game.ClickCookie;
            Game.ClickCookie = function () {
                window.__calls++;
                return click.apply(this, arguments);
            };
        });
        return await run(game);
    } finally {
        await game.close();
    }
}

const startClicking = (speed) => {
    FrozenCookies.autoClick = 1;
    FrozenCookies.cookieClickSpeed = speed;
    FCStart();
};
const snap = () => ({ clicks: Game.cookieClicks, calls: window.__calls, at: Date.now() });

test('clicks 50 times a second, the most the game counts, with no call turned away', { skip }, () =>
    withGame(async (game) => {
        await game.eval(startClicking, 250);
        await game.advanceSeconds(2);
        const a = await game.eval(snap);
        await game.advanceSeconds(60);
        const b = await game.eval(snap);
        const seconds = (b.at - a.at) / 1000;
        const accepted = (b.clicks - a.clicks) / seconds;
        const calls = (b.calls - a.calls) / seconds;
        assert.ok(Math.abs(accepted - 50) < 0.5, `${accepted.toFixed(2)} accepted a second`);
        assert.ok(calls <= accepted * 1.01, `${calls.toFixed(1)} calls a second for ${accepted.toFixed(1)} accepted`);
    }));

test("a player's click reaches the frame after the clicker has called", { skip }, () =>
    withGame(async (game) => {
        await game.eval(() => {
            // Game.Click as the frame's logic sees it, after the timers between frames have run.
            window.__seen = [];
            Game.registerHook('logic', () => window.__seen.push(Game.Click));
        });
        await game.eval(startClicking, 250);
        await game.advanceSeconds(2);
        const seen = [];
        for (let i = 0; i < 5; i++) {
            await game.eval(() => {
                window.__seen = [];
                Game.Click = 1; // a player's click on the page (main.js:4860)
            });
            const before = await game.eval(() => window.__calls);
            await game.advance(1);
            seen.push(await game.eval((b) => ({ click: window.__seen[0], calls: window.__calls - b }), before));
        }
        assert.ok(seen.every((s) => s.calls > 0), `the clicker called between frames: ${JSON.stringify(seen)}`);
        assert.ok(seen.every((s) => s.click === 1), `the click was eaten: ${JSON.stringify(seen)}`);
    }));

test('the mouse resting on the dragon tab does not stop the clicking', { skip }, () =>
    withGame(async (game) => {
        await game.eval(() => {
            Game.Upgrades['A crumbly egg'].earn(); // the dragon tab appears (main.js:14698)
            Game.specialTab = 'dragon';
        });
        await game.advance(2);
        await game.eval(() => {
            // Inside the selected tab's 96×96 box (main.js:14711-14716).
            const y = Game.LeftBackground.canvas.height - 24 - 48 * Game.specialTabs.length;
            Game.mouseX = 48 + 20;
            Game.mouseY = y + 20;
        });
        await game.eval(startClicking, 250);
        await game.advanceSeconds(2);
        const hovered = await game.eval(() => Game.specialTabHovered);
        assert.equal(hovered, 'dragon', 'the fixture must hover the tab');
        const a = await game.eval(snap);
        await game.advanceSeconds(10);
        const b = await game.eval(snap);
        assert.ok(b.clicks - a.clicks >= 490, `${b.clicks - a.clicks} clicks in ten seconds on the tab`);
    }));

test('the income model counts the clicks the game really accepted, not the setting', { skip }, () =>
    withGame(async (game) => {
        await game.eval(() => {
            // A machine too busy to click on time: the game turns away every third call.
            const click = Game.ClickCookie;
            let n = 0;
            Game.ClickCookie = function () {
                if (++n % 3 === 0) {
                    Game.Click = 0;
                    return;
                }
                return click.apply(this, arguments);
            };
        });
        await game.eval(startClicking, 250);
        await game.advanceSeconds(5);
        const a = await game.eval(snap);
        await game.advanceSeconds(180);
        const b = await game.eval(snap);
        const accepted = (b.clicks - a.clicks) / ((b.at - a.at) / 1000);
        const model = await game.eval(() => MushieCookies.readState(Game, FrozenCookies).clicksPerSecond);
        assert.ok(accepted < 45, `the fixture should slow clicking down: ${accepted}`);
        assert.ok(Math.abs(model - accepted) / accepted < 0.05, `model ${model} against ${accepted.toFixed(2)} accepted`);
        const off = await game.eval(() => MushieCookies.readState(Game, { ...FrozenCookies, autoClick: 0 }).clicksPerSecond);
        assert.equal(off, 0);
    }));

test('during a click frenzy the buyer neither buys nor re-ranks; it catches up when the frenzy ends', { skip }, () =>
    withGame(async (game) => {
        await game.eval(() => {
            Game.Earn(1e9);
            FrozenCookies.autoBuy = 1;
            FCStart();
        });
        await game.advanceSeconds(20);
        await game.eval(() => {
            Game.Earn(1e12); // a rich bank: the buyer would buy every tick
            Game.gainBuff('click frenzy', 13, 777);
        });
        const a = await game.eval(() => MushieCookies.buyer.activity());
        await game.advanceSeconds(12);
        const b = await game.eval(() => MushieCookies.buyer.activity());
        assert.equal(b.purchases - a.purchases, 0, 'no purchase during the click frenzy');
        assert.equal(b.ranks - a.ranks, 0, 'no re-rank during the click frenzy');
        await game.advanceSeconds(5);
        const c = await game.eval(() => ({ ...MushieCookies.buyer.activity(), buffs: Object.keys(Game.buffs) }));
        assert.deepEqual(c.buffs, []);
        assert.ok(c.purchases - b.purchases > 0, 'buying resumes');
        assert.ok(c.ranks - b.ranks > 0, 'and ranking');

        // The option the measurement tool compares against: buying through click buffs.
        await game.eval(() => {
            MushieCookies.buyer.options.clickPriority = false;
            Game.Earn(1e12);
            Game.gainBuff('click frenzy', 13, 777);
        });
        const d = await game.eval(() => MushieCookies.buyer.activity());
        await game.advanceSeconds(5);
        const e = await game.eval(() => MushieCookies.buyer.activity());
        assert.ok(e.purchases - d.purchases > 0, 'with click priority off, it buys during the frenzy');
    }));

// readState reads every income unbuffed, so a ranking made during a CpS buff is right, and the
// buyer ranks after each purchase through it as between buffs (test/game/measure.test.mjs).
for (const [label, buff] of [
    ['a Frenzy', ['frenzy', 30, 7]],
    ['an hour of Sugar frenzy', ['sugar frenzy', 3600, 3]], // what a sugar lump buys (main.js:11043)
]) {
    test(`during ${label} the buyer buys and re-ranks after each purchase as usual`, { skip }, () =>
        withGame(async (game) => {
            await game.eval(() => {
                Game.Earn(1e9);
                FrozenCookies.autoBuy = 1;
                FCStart();
            });
            await game.advanceSeconds(20);
            await game.eval((b) => {
                Game.Earn(1e12);
                Game.gainBuff(...b);
            }, buff);
            await game.advance(3); // the buff began between rankings
            const a = await game.eval(() => MushieCookies.buyer.activity());
            await game.advanceSeconds(25);
            const b = await game.eval(() => MushieCookies.buyer.activity());
            assert.ok(b.purchases - a.purchases > 0, 'buying during the buff');
            assert.ok(b.ranks - a.ranks >= b.purchases - a.purchases, `${b.ranks - a.ranks} rankings for ${b.purchases - a.purchases} purchases`);
        }));
}
