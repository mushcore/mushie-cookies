import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

/** Everything the mod could do to a save, as numbers that change when it does it. */
const census = () => {
    const grimoire = Game.Objects['Wizard tower'].minigame;
    return {
        buildings: Game.ObjectsById.reduce((sum, b) => sum + b.amount, 0),
        buildingCounter: Game.BuildingsOwned,
        upgrades: Game.UpgradesOwned,
        ascensions: Game.resets,
        spells: grimoire ? grimoire.spellsCastTotal : 0,
        bigCookieClicks: Game.cookieClicks,
        goldenCookieClicks: Game.goldenClicks,
        wrinklersPopped: Game.wrinklersPopped,
        lumps: Game.lumps,
        season: Game.season,
        fps: Game.fps,
    };
};

const failures = (status) =>
    Object.entries(status)
        .filter(([, s]) => s.failures > 0)
        .map(([name, s]) => `${name}: ${s.lastError}`);

test('with every setting at its default the mod does nothing to the save', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e15);
            for (const name of ['Cursor', 'Grandma', 'Farm']) Game.Objects[name].buy(20);
        });
        await game.advance(30);
        const before = await game.eval(census);
        await game.advanceSeconds(30 * 60);
        const after = await game.eval(census);
        assert.deepEqual(after, before);
        assert.deepEqual(failures(await game.eval(() => MushieCookies.status())), []);
        assert.deepEqual(game.errors, []);
        assert.deepEqual(game.blocked, []);
    } finally {
        await game.close();
    }
});

test('with buying and clicking on, it plays two hours from nothing without an error', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoGC = 1;
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            FCStart();
        });
        await game.advanceSeconds(2 * 3600);
        const out = await game.eval(() => ({
            owned: Game.ObjectsById.reduce((sum, b) => sum + b.amount, 0),
            counter: Game.BuildingsOwned,
            upgradeCounter: Game.UpgradesOwned,
            upgradeFlags: Object.values(Game.UpgradesById).filter((u) => u.bought && u.pool !== 'prestige' && u.pool !== 'toggle').length,
            cps: Game.cookiesPs,
            clicks: Game.cookieClicks,
            golden: Game.goldenClicks,
            achievements: Game.AchievementsOwned,
            status: MushieCookies.status(),
        }));
        assert.ok(out.owned > 100, `only ${out.owned} buildings after two hours`);
        assert.equal(out.counter, out.owned, 'the building counter disagrees with the buildings: a what-if leaked');
        assert.ok(out.upgradeCounter > 10, `only ${out.upgradeCounter} upgrades after two hours`);
        assert.ok(out.cps > 1000, `CpS is only ${out.cps}`);
        assert.ok(out.clicks > 1000, 'the big cookie was not being clicked');
        assert.ok(out.golden > 0, 'no golden cookie was clicked in two hours');
        assert.deepEqual(failures(out.status), []);
        assert.deepEqual(game.errors, []);
        assert.deepEqual(game.blocked, []);
    } finally {
        await game.close();
    }
});

test('two runs of the same seed buy exactly the same things', { skip }, async () => {
    const run = async () => {
        const game = await launchWithMod({ seed: 'repeat' });
        try {
            await game.eval(() => {
                FrozenCookies.autoBuy = 1;
                FrozenCookies.autoGC = 1;
                FrozenCookies.autoClick = 1;
                FrozenCookies.cookieClickSpeed = 50;
                FCStart();
            });
            await game.advanceSeconds(20 * 60);
            return await game.eval(() => ({
                buildings: Game.ObjectsById.map((b) => b.amount),
                upgrades: Object.values(Game.UpgradesById).filter((u) => u.bought).map((u) => u.id),
                earned: Math.round(Game.cookiesEarned),
            }));
        } finally {
            await game.close();
        }
    };
    assert.deepEqual(await run(), await run());
});
