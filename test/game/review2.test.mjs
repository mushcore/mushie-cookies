// Regression tests for the defects the M2-M4 review verified. Each reproduces the finding.
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

const failures = () =>
    Object.entries(MushieCookies.status())
        .filter(([, s]) => s.failures > 0)
        .map(([n, s]) => `${n}: ${s.lastError}`);

test('the buyer does not stall on an upgrade that asks for confirmation ("One mind")', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            Game.Earn(1e20);
            for (const b of Game.ObjectsById.slice(0, 8)) b.buy(60);
            Game.Upgrades['Bingo center/Research facility'].earn();
            for (const name of ['Specialized chocolate chips', 'Designer cocoa beans', 'Ritual rolling pins', 'Underworld ovens']) Game.Upgrades[name].earn();
            Game.Unlock('One mind');
            Game.RebuildUpgrades();
            FrozenCookies.autoBuy = 1;
            return { inStore: Game.UpgradesInStore.some((u) => u.name === 'One mind') };
        });
        assert.equal(out.inStore, true, 'fixture: One mind should be for sale');
        const before = await game.eval(() => MushieCookies.buyer.report().purchases);
        await game.advanceSeconds(60);
        const after = await game.eval(() => ({
            purchases: MushieCookies.buyer.report().purchases,
            prompt: !!Game.promptOn,
            failures: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).length,
        }));
        assert.ok(after.purchases > before + 10, `only ${after.purchases - before} purchases in a minute`);
        assert.equal(after.prompt, false, 'no confirmation prompt is left open');
        assert.equal(after.failures, 0);
    }));

test('building limits hold for bulk buys and chains, with a limit that is not a multiple of ten', { skip }, () =>
    withMod(async (game) => {
        await game.eval(() => {
            Game.Earn(1e18);
            FrozenCookies.mineLimit = 1;
            FrozenCookies.mineMax = 33;
            FrozenCookies.autoBuy = 1;
        });
        await game.advanceSeconds(90);
        const mines = await game.eval(() => Game.Objects['Mine'].amount);
        assert.ok(mines <= 33, `${mines} mines`);
        assert.ok(mines >= 30, `the limit should be reached: ${mines}`);
    }));

test('nothing is bought during the ascend animation or on the ascension screen', { skip }, () =>
    withMod(async (game) => {
        const before = await game.eval(() => {
            Game.Earn(1e18);
            FrozenCookies.autoBuy = 1;
            Game.Ascend(1); // the player ascends
            return Game.BuildingsOwned;
        });
        await game.advanceSeconds(20);
        const after = await game.eval(() => ({ owned: Game.BuildingsOwned, onAscend: Game.OnAscend }));
        assert.equal(after.onAscend, 1);
        assert.equal(after.owned, before);
    }));

test('wrinkler cookies are collected before ascending and count toward it', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            Game.Earn(1e14);
            for (const b of Game.ObjectsById.slice(0, 6)) b.buy(60);
            Game.prestige = 100;
            Game.heavenlyChips = 0;
            Game.cookiesReset = Game.HowManyCookiesReset(100);
            Game.cookiesEarned = Game.HowManyCookiesReset(150) - Game.cookiesReset;
            Game.resets = 1;
            Game.elderWrath = 1;
            // Ten wrinklers holding as much as the whole run earned.
            for (let i = 0; i < 10; i++) {
                const w = Game.wrinklers[i];
                w.phase = 2;
                w.close = 1;
                w.hp = 3;
                w.sucked = Game.cookiesEarned / 10;
            }
            FrozenCookies.autoAscendToggle = 1;
            const expected = Math.floor(Game.HowMuchPrestige(Game.cookiesReset + Game.cookiesEarned * 2 * 1.1));
            const without = Math.floor(Game.HowMuchPrestige(Game.cookiesReset + Game.cookiesEarned));
            MushieCookies.ascension.options.rule = 'double'; // 150 → about 185 with the wrinklers: force the decision
            return { expected, without };
        });
        // Doubling from 100 needs 200: make the run long enough and let the rule see 2x.
        await game.eval(() => {
            Game.cookiesEarned = Game.HowManyCookiesReset(210) - Game.cookiesReset;
            for (let i = 0; i < 10; i++) Game.wrinklers[i].sucked = Game.cookiesEarned / 10;
        });
        await game.advanceSeconds(60);
        const after = await game.eval(() => ({ resets: Game.resets, prestige: Game.prestige, onAscend: Game.OnAscend }));
        const withWrinklers = await game.eval(() => Math.floor(Game.HowMuchPrestige(Game.HowManyCookiesReset(100) + (Game.HowManyCookiesReset(210) - Game.HowManyCookiesReset(100)) * (1 + 1.1))));
        assert.ok(after.resets >= 2, 'should have ascended');
        assert.ok(after.prestige >= withWrinklers - 2, `prestige ${after.prestige}; with the wrinklers counted it should be about ${withWrinklers}`);
        assert.deepEqual(await game.eval(failures), []);
    }));

test('a heavenly upgrade not shown at the new prestige is never bought', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            Game.Earn(1e14);
            for (const b of Game.ObjectsById.slice(0, 6)) b.buy(60);
            Game.cookiesReset = Game.HowManyCookiesReset(1700);
            Game.prestige = 1700;
            Game.heavenlyChips = 1e6;
            Game.resets = 1;
            Game.Upgrades['Legacy'].earn();
            Game.Upgrades['Heavenly luck'].earn();
            // Lucky digit is shown only when the prestige ends in 7 (main.js:10897); plan for 3500.
            const plan = MushieCookies.planHeavenly(Game, FrozenCookies, 1e6, 3500);
            return { names: plan.buy.map((b) => b.name) };
        });
        assert.ok(!out.names.includes('Lucky digit'), 'Lucky digit is not shown at 3500 and must not be planned');
    }));

test('a manual reincarnation starts a new run for the ascension timing', { skip }, () =>
    withMod(async (game) => {
        await game.eval(() => {
            Game.Earn(1e12);
            FrozenCookies.autoAscendToggle = 1;
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            FCStart();
        });
        await game.advanceSeconds(300);
        const before = await game.eval(() => MushieCookies.ascension.history().length);
        await game.eval(() => {
            Game.Ascend(1);
        });
        await game.advanceSeconds(10);
        await game.eval(() => {
            Game.ClosePrompt();
            Game.Reincarnate(1);
        });
        await game.advanceSeconds(5);
        const after = await game.eval(() => MushieCookies.ascension.history().length);
        assert.ok(before >= 4, `fixture: ${before} samples before`);
        assert.ok(after <= 1, `the old run's ${before} samples should be gone, found ${after}`);
    }));
