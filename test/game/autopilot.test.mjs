// The Autopilot: off on a fresh install like everything else; one switch turns every part on.
// It steps aside when the player changes a playing option, comes back when switched on again,
// and keeps a newer version's values on load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

async function withAutopilot(run, { on = true } = {}) {
    const game = await launchWithMod({ autopilot: on });
    try {
        await game.eval(() => {
            window.mismatches = () =>
                Object.entries(MushieCookies.AUTOPILOT)
                    .filter(([name, value]) => FrozenCookies[name] !== value)
                    .map(([name, value]) => `${name}=${FrozenCookies[name]} (Autopilot ${value})`);
        });
        return await run(game);
    } finally {
        await game.close();
    }
}

test('a fresh install does nothing until the Autopilot is switched on; then it plays with no other input', { skip }, () =>
    withAutopilot(async (game) => {
        const fresh = await game.eval(() => ({ on: FrozenCookies.autopilot, buy: FrozenCookies.autoBuy, click: FrozenCookies.autoClick }));
        assert.deepEqual(fresh, { on: 0, buy: 0, click: 0 }, 'everything is off on a fresh install');
        const start = await game.eval(() => {
            setPreferenceDirect('autopilot', 1); // the one switch, as the menu button does it
            return { on: FrozenCookies.autopilot, wrong: mismatches() };
        });
        assert.equal(start.on, 1);
        assert.deepEqual(start.wrong, []);
        await game.advanceSeconds(600);
        const later = await game.eval(() => ({
            buildings: Game.BuildingsOwned,
            clicks: Game.cookieClicks,
            purchases: MushieCookies.buyer.report().purchases,
            failures: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`),
        }));
        assert.ok(later.clicks > 600 * 40, `only ${later.clicks} clicks in ten minutes`);
        assert.ok(later.purchases > 20, `only ${later.purchases} purchases in ten minutes`);
        assert.deepEqual(later.failures, []);
        assert.deepEqual(game.errors.filter((e) => e.includes('pageerror') || e.includes('Mushie')), []);
    }, { on: false }));

test('a player who switched the Autopilot on finds it on, with every value, next session', { skip }, () =>
    withAutopilot(async (game) => {
        assert.deepEqual(await game.eval(() => ({ on: FrozenCookies.autopilot, wrong: mismatches() })), { on: 1, wrong: [] });
    }));

test('changing a playing option hands control to the player; a display option does not', { skip }, () =>
    withAutopilot(async (game) => {
        const out = await game.eval(() => {
            setPreferenceDirect('numberDisplay', 3);
            const afterDisplay = FrozenCookies.autopilot;
            setPreferenceDirect('autoGarden', 0);
            const afterPlaying = { on: FrozenCookies.autopilot, garden: FrozenCookies.autoGarden };
            setPreferenceDirect('autopilot', 1);
            return { afterDisplay, afterPlaying, restored: { on: FrozenCookies.autopilot, garden: FrozenCookies.autoGarden, wrong: mismatches() }, numberDisplay: FrozenCookies.numberDisplay };
        });
        assert.equal(out.afterDisplay, 1, 'a display option leaves the Autopilot on');
        assert.deepEqual(out.afterPlaying, { on: 0, garden: 0 }, 'the player keeps the change and the Autopilot steps aside');
        assert.equal(out.restored.on, 1);
        assert.equal(out.restored.garden, 1);
        assert.deepEqual(out.restored.wrong, [], 'switching it back on restores every value');
        assert.equal(out.numberDisplay, 3, 'and leaves display choices alone');
    }));

test('a save keeps the player in control, and an Autopilot save takes newer values on load', { skip }, () =>
    withAutopilot(async (game) => {
        const out = await game.eval(() => {
            // A player who took over: their settings survive a save and load.
            setPreferenceDirect('autoMarket', 0);
            setOverrides(saveFCData());
            const manual = { on: FrozenCookies.autopilot, market: FrozenCookies.autoMarket };
            // A save from an older version on Autopilot, before a value changed.
            setPreferenceDirect('autopilot', 1);
            const older = JSON.parse(saveFCData());
            older.autoFate = 0;
            setOverrides(JSON.stringify(older));
            return { manual, upgraded: { on: FrozenCookies.autopilot, fate: FrozenCookies.autoFate, wrong: mismatches() } };
        });
        assert.deepEqual(out.manual, { on: 0, market: 0 });
        assert.equal(out.upgraded.on, 1);
        assert.equal(out.upgraded.fate, 1);
        assert.deepEqual(out.upgraded.wrong, []);
    }));
