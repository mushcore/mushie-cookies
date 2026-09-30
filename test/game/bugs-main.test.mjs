import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

async function withMod(run) {
    const game = await launchWithMod();
    try {
        return await run(game);
    } finally {
        await game.close();
    }
}

test('the reward-cookie patch is gone', { skip }, () =>
    withMod(async (game) => {
        const left = await game.eval(() =>
            ['isRewardCookie', 'getRewardCookieBuildingTargets', 'restoreBuildingLimits', '_oldAutoCookie'].filter(
                (name) => typeof window[name] !== 'undefined'
            )
        );
        assert.deepEqual(left, []);
    }));

test("choosing wrinklers to pop does not reorder the game's own array", { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            Game.wrinklers.forEach((w, i) => {
                w.phase = 2;
                w.sucked = ((i * 7) % 10) + 1;
            });
            const before = Game.wrinklers.map((w) => w.id);
            shouldPopWrinklers();
            return { before, after: Game.wrinklers.map((w) => w.id) };
        });
        assert.ok(out.before.length >= 10);
        assert.deepEqual(out.after, out.before);
    }));

test('bestBank survives an empty candidate list', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            try {
                return { bank: bestBank(-1) };
            } catch (e) {
                return { thrown: e.message };
            }
        });
        assert.equal(out.thrown, undefined);
        assert.equal(typeof out.bank.cost, 'number');
    }));

test('the Spontaneous Edifice bank is zero when the spell cannot be cast', { skip }, () =>
    withMod(async (game) => {
        assert.equal(await game.eval(() => edificeBank()), 0);
    }));

test('season switchers and other toggles are never purchase candidates', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            Game.Earn(1e15);
            Game.UpgradesById[181].unlocked = 1; // Season switcher
            for (const id of [182, 183, 184, 185, 209]) Game.UpgradesById[id].unlocked = 1;
            Game.RebuildUpgrades();
            const inStore = Game.UpgradesInStore.map((u) => u.id);
            const policy = { excludedBuildings: new Set(), excludedUpgrades: new Set(), chainReach: 15, prerequisites: upgradeJson };
            const candidates = MushieCookies.listCandidates(Game, policy).filter((c) => c.kind === 'upgrade').map((c) => c.upgrade.id);
            return { inStore, candidates };
        });
        assert.ok([182, 183, 184, 185, 209].some((id) => out.inStore.includes(id)), 'the fixture should have put switchers in the store');
        for (const id of [182, 183, 184, 185, 209]) assert.ok(!out.candidates.includes(id), `switcher ${id} was a candidate`);
    }));

test('restarting the timers does not leak intervals', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            FrozenCookies.autoFrenzy = 1;
            FrozenCookies.frenzyClickSpeed = 10;
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 10;
            FCStart();
            const first = window.__vt.timers.size;
            for (let i = 0; i < 5; i++) FCStart();
            return { first, later: window.__vt.timers.size };
        });
        assert.equal(out.later, out.first);
    }));

test('a manual ascension is left alone even with auto-ascend switched on', { skip }, () =>
    withMod(async (game) => {
        await game.eval(() => {
            Game.Earn(1e15);
            Game.cookiesEarned = Game.HowManyCookiesReset(50);
            FrozenCookies.autoAscendToggle = 1;
            FCStart();
            Game.Ascend(1); // the player ascends by hand
        });
        await game.advanceSeconds(15);
        const out = await game.eval(() => ({ onAscend: Game.OnAscend, resets: Game.resets }));
        assert.equal(out.onAscend, 1, 'the mod must not reincarnate an ascension it did not start');
        assert.equal(out.resets, 0, 'reincarnating is what counts a reset, and the mod must not have');
    }));

test('a save wipe is a hard reset: prestige upgrades do not survive it', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            Game.Earn(1e15);
            Game.Upgrades['Season switcher'].earn();
            Game.Upgrades['Heralds'].earn();
            Game.HardReset(2);
            return {
                switcher: Game.Upgrades['Season switcher'].bought,
                heralds: Game.Upgrades['Heralds'].bought,
                cookies: Game.cookies,
                resets: Game.resets,
            };
        });
        assert.deepEqual(out, { switcher: 0, heralds: 0, cookies: 0, resets: 0 });
    }));

test('loading a save while running does not duplicate the timers', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 10;
            FCStart();
            const before = window.__vt.timers.size;
            for (let i = 0; i < 3; i++) Game.LoadSave(Game.WriteSave(1));
            return { before, after: window.__vt.timers.size };
        });
        assert.equal(out.after, out.before);
    }));
