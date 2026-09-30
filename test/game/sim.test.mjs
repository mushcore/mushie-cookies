import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

/** A bakery a few hours in: eight building types, the first upgrades bought. */
async function midGame(game) {
    await game.eval(() => {
        Game.Earn(1e18);
        for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower']) {
            Game.Objects[name].buy(60);
        }
    });
    await game.advance(30);
    await game.eval(() => {
        for (const upgrade of Game.UpgradesInStore.slice(0, 40)) if (upgrade.pool === '') upgrade.buy();
    });
    await game.advance(30);
}

test('ranking every purchase leaves the game exactly as it was', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await midGame(game);
        game.clearLogs();
        const out = await game.eval(() => {
            Game.CalculateGains();
            const before = MushieCookies.takeSnapshot(Game);
            const cps = Game.cookiesPs;
            const list = recommendationList(true);
            return {
                ranked: list.length,
                finite: list.filter((r) => Number.isFinite(r.efficiency)).length,
                diff: MushieCookies.diffSnapshots(before, MushieCookies.takeSnapshot(Game)),
                cpsSame: Game.cookiesPs === cps,
                vanillaWin: /Game\.Achievements\[what\]/.test(String(Game.Win)),
            };
        });
        assert.ok(out.ranked > 20, `only ${out.ranked} candidates were ranked`);
        assert.ok(out.finite > 10, `only ${out.finite} candidates had a usable score`);
        assert.deepEqual(out.diff, []);
        assert.equal(out.cpsSame, true);
        assert.equal(out.vanillaWin, true, "the game's own Game.Win must be in place");
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('an exception halfway through ranking leaves no phantom state', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await midGame(game);
        const out = await game.eval(() => {
            Game.CalculateGains();
            const before = MushieCookies.takeSnapshot(Game);
            const win = Game.Win;
            const real = window.effectiveCps;
            let calls = 0;
            window.effectiveCps = function () {
                if (++calls === 7) throw new Error('injected mid-simulation');
                return real.apply(this, arguments);
            };
            let thrown = null;
            try {
                recommendationList(true);
            } catch (e) {
                thrown = e.message;
            }
            window.effectiveCps = real;
            return {
                thrown,
                diff: MushieCookies.diffSnapshots(before, MushieCookies.takeSnapshot(Game)),
                winRestored: Game.Win === win,
            };
        });
        assert.equal(out.thrown, 'injected mid-simulation');
        assert.deepEqual(out.diff, []);
        assert.equal(out.winRestored, true);
    } finally {
        await game.close();
    }
});

test('a what-if cannot award an achievement or raise the highest-CpS record', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await midGame(game);
        const out = await game.eval(() => {
            Game.CalculateGains();
            const owned = Game.AchievementsOwned;
            const highest = Game.cookiesPsRawHighest;
            const huge = MushieCookies.simulate(Game, {
                apply() {
                    for (const building of Game.ObjectsById) building.amount += 500;
                },
                measure: () => Game.cookiesPsRaw,
            });
            return {
                grew: huge > highest * 10,
                achievements: Game.AchievementsOwned - owned,
                highest: Game.cookiesPsRawHighest === highest,
            };
        });
        assert.equal(out.grew, true, 'the what-if should have measured a much larger CpS');
        assert.equal(out.achievements, 0);
        assert.equal(out.highest, true);
    } finally {
        await game.close();
    }
});
