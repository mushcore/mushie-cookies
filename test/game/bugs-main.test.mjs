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

test('a season switcher is not bought in a free base season with nothing left to unlock', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            const all = ['christmas', 'halloween', 'valentines', 'easter'];
            for (const season of all) for (const id of holidayCookies[season]) Game.UpgradesById[id].unlocked = 1;
            Game.UpgradesById[181].unlocked = 1;
            Game.baseSeason = 'christmas';
            FrozenCookies.freeSeason = 1;
            // The preferred season's own switcher is the one no other rule already excludes.
            FrozenCookies.defaultSeason = seasons.indexOf('halloween');
            const halloweenSwitch = Game.UpgradesById[183];
            halloweenSwitch.unlocked = 1;
            const complete = isUnavailable(halloweenSwitch, []);
            Game.baseSeason = '';
            const noBaseSeason = isUnavailable(halloweenSwitch, []);
            return { complete, noBaseSeason };
        });
        assert.equal(out.complete, true);
        assert.equal(out.noBaseSeason, false, 'outside a base season the same switcher must stay available');
    }));

test('prestige-doubling ascension does not depend on the fixed-amount setting', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            FrozenCookies.autoAscendToggle = 1;
            FrozenCookies.comboAscend = 1;
            FrozenCookies.HCAscendAmount = 0;
            Game.prestige = 100;
            Game.cookiesReset = 0;
            Game.cookiesEarned = Game.HowManyCookiesReset(250);
            FrozenCookies.autoAscend = 2;
            const doubling = shouldAutoAscend();
            FrozenCookies.autoAscend = 1;
            const fixedWithZero = shouldAutoAscend();
            FrozenCookies.HCAscendAmount = 100;
            const fixedWith100 = shouldAutoAscend();
            FrozenCookies.HCAscendAmount = 200;
            const fixedWith200 = shouldAutoAscend();
            FrozenCookies.autoAscendToggle = 0;
            const off = shouldAutoAscend();
            return { doubling, fixedWithZero, fixedWith100, fixedWith200, off };
        });
        assert.deepEqual(out, { doubling: true, fixedWithZero: false, fixedWith100: true, fixedWith200: false, off: false });
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

test('auto-ascend ascends and reincarnates without a wall-clock timer', { skip }, () =>
    withMod(async (game) => {
        await game.eval(() => {
            Game.Earn(1e15);
            Game.prestige = 10;
            Game.heavenlyChips = 10;
            Game.cookiesReset = Game.HowManyCookiesReset(10);
            Game.cookiesEarned = Game.HowManyCookiesReset(40);
            FrozenCookies.autoAscendToggle = 1;
            FrozenCookies.autoAscend = 2;
            FrozenCookies.comboAscend = 1;
            FCStart();
        });
        game.clearLogs();
        await game.advanceSeconds(60);
        const out = await game.eval(() => ({
            onAscend: Game.OnAscend,
            ascendTimer: Game.AscendTimer,
            resets: Game.resets,
            prestige: Game.prestige,
        }));
        assert.equal(out.resets, 1, 'the run should have ascended exactly once');
        assert.equal(out.onAscend, 0, 'the mod should have left the ascension screen');
        assert.ok(out.prestige >= 40);
        assert.deepEqual(game.errors, []);
    }));
