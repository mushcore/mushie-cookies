import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchGame, launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('boots the installed game in web mode', { skip }, async () => {
    const game = await launchGame();
    try {
        const state = await game.eval(() => ({
            version: Game.version,
            web: App === 0,
            buildings: Game.ObjectsById.length,
            cookies: Game.cookies,
        }));
        assert.equal(state.version, 2.053);
        assert.equal(state.web, true);
        assert.equal(state.buildings, 20);
        assert.equal(state.cookies, 0);
    } finally {
        await game.close();
    }
});

test('one simulated hour earns exactly CpS times 3600', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.eval(() => {
            Game.Earn(1e6);
            Game.Objects['Cursor'].buy(10);
            Game.Objects['Grandma'].buy(10);
            Game.CalculateGains();
        });
        const before = await game.eval(() => ({ earned: Game.cookiesEarned, cps: Game.cookiesPs, T: Game.T }));
        await game.advanceSeconds(3600);
        const after = await game.eval(() => ({ earned: Game.cookiesEarned, T: Game.T, cps: Game.cookiesPs }));
        assert.equal(after.T - before.T, 108000);
        assert.ok(before.cps > 0);
        assert.equal(after.cps, before.cps, 'nothing should have changed CpS in an untouched hour');
        const expected = before.cps * 3600;
        assert.ok(Math.abs(after.earned - before.earned - expected) / expected < 1e-6);
    } finally {
        await game.close();
    }
});

test('two runs with the same seed are identical, a different seed differs', { skip }, async () => {
    const run = async (seed) => {
        const game = await launchGame({ seed });
        try {
            await game.eval(() => {
                Game.Earn(1e9);
                Game.Objects['Cursor'].buy(50);
            });
            await game.advanceSeconds(3600);
            return await game.eval(() => ({
                seed: Game.seed,
                goldenTimer: Game.shimmerTypes.golden.time,
                missed: Game.missedGoldenClicks,
                randoms: [Math.random(), Math.random(), Math.random()],
            }));
        } finally {
            await game.close();
        }
    };
    const a = await run('alpha');
    const b = await run('alpha');
    const c = await run('beta');
    assert.deepEqual(a, b);
    assert.ok(a.missed > 0, 'golden cookies should have spawned and expired within the hour');
    assert.notDeepEqual(a.randoms, c.randoms);
});

test('timers created after takeover run on virtual time', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.eval(() => {
            window.__ticks = 0;
            window.__late = 0;
            setInterval(() => window.__ticks++, 1000);
            setTimeout(() => window.__late++, 5000);
        });
        await game.advanceSeconds(10);
        assert.deepEqual(await game.eval(() => [window.__ticks, window.__late]), [10, 1]);
    } finally {
        await game.close();
    }
});

test('a timer sees the time it was due, so the game counts 50 clicks a second as in a browser', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.eval(() => {
            window.__seen = [];
            setInterval(() => window.__seen.push(Date.now()), 4);
            window.__clicks = Game.cookieClicks;
            setInterval(() => Game.ClickCookie(), 4);
        });
        await game.advanceSeconds(10);
        const out = await game.eval(() => {
            const gaps = window.__seen.slice(1).map((t, i) => t - window.__seen[i]);
            return { clicks: Game.cookieClicks - window.__clicks, gaps: [...new Set(gaps)] };
        });
        assert.deepEqual(out.gaps, [4], 'each firing is 4 ms after the last');
        assert.ok(out.clicks >= 495 && out.clicks <= 500, `${out.clicks} clicks in 10 s`);
    } finally {
        await game.close();
    }
});

test('after reset the game reaches for nothing outside the local server', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.advanceSeconds(60);
        assert.deepEqual(game.blocked, []);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('a checkpoint resumes the same bakery at the same moment, and play goes on from it', { skip }, async () => {
    const first = await launchWithMod({ seed: 'checkpoint', autopilot: true });
    let checkpoint;
    let before;
    try {
        await first.advanceSeconds(20 * 60);
        checkpoint = await first.takeCheckpoint();
        before = await first.eval(() => ({
            now: Date.now(), earned: Game.cookiesEarned, bank: Game.cookies, buildings: Game.BuildingsOwned,
            upgrades: Game.UpgradesOwned, startDate: Game.startDate, autopilot: FrozenCookies.autopilot,
        }));
    } finally {
        await first.close();
    }
    const second = await launchWithMod({ seed: 'checkpoint', autopilot: true, checkpoint });
    try {
        const after = await second.eval(() => ({
            now: Date.now(), earned: Game.cookiesEarned, bank: Game.cookies, buildings: Game.BuildingsOwned,
            upgrades: Game.UpgradesOwned, startDate: Game.startDate, autopilot: FrozenCookies.autopilot,
        }));
        assert.equal(after.buildings, before.buildings);
        assert.equal(after.upgrades, before.upgrades);
        assert.equal(after.startDate, before.startDate);
        assert.equal(after.autopilot, 1, 'the mod resumes with the settings it saved');
        assert.ok(Math.abs(after.now - before.now) < 5000, `clock resumed at ${after.now - before.now} ms from the checkpoint`);
        // No offline earnings or losses: the save was taken at the moment the clock resumes.
        assert.ok(Math.abs(after.earned - before.earned) / before.earned < 0.01, `earned ${after.earned} against ${before.earned}`);
        await second.advanceSeconds(10 * 60);
        const later = await second.eval(() => ({ buildings: Game.BuildingsOwned, earned: Game.cookiesEarned }));
        assert.ok(later.buildings > before.buildings, 'the Autopilot keeps buying after the resume');
        assert.ok(later.earned > before.earned * 1.2);
    } finally {
        await second.close();
    }
});
