import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();
const baseline = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'baselines', 'm1-two-hours.json'), 'utf8'));

/** The settings for an unattended run. Runs in the page. */
const turnOn = (game) =>
    game.eval(() => {
        FrozenCookies.autoBuy = 1;
        FrozenCookies.autoGC = 1;
        FrozenCookies.autoClick = 1;
        FrozenCookies.cookieClickSpeed = 50;
        FCStart();
    });

const failures = (status) =>
    Object.entries(status)
        .filter(([, s]) => s.failures > 0)
        .map(([name, s]) => `${name}: ${s.lastError}`);

test('plays at least 1.5 times better than M1 over two hours, from nothing', { skip }, async () => {
    const game = await launchWithMod({ seed: baseline.seed });
    try {
        await turnOn(game);
        const at = {};
        await game.advanceSeconds(60 * 60);
        at[60] = await game.eval(() => Game.cookiesEarned);
        await game.advanceSeconds(60 * 60);
        at[120] = await game.eval(() => Game.cookiesEarned);
        for (const minute of [60, 120]) {
            const m1 = baseline.points.find((p) => p.minute === minute).earned;
            const ratio = at[minute] / m1;
            assert.ok(ratio >= 1.5, `at ${minute} minutes: ${at[minute].toExponential(2)} against M1's ${m1.toExponential(2)} (${ratio.toFixed(2)}x)`);
        }
        const out = await game.eval(() => ({
            owned: Game.ObjectsById.reduce((sum, b) => sum + b.amount, 0),
            counter: Game.BuildingsOwned,
            status: MushieCookies.status(),
        }));
        assert.equal(out.counter, out.owned, 'the building counter disagrees with the buildings: a what-if leaked');
        assert.deepEqual(failures(out.status), []);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('after a windfall it buys in bulk', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => Game.Earn(1e15));
        await turnOn(game);
        await game.advanceSeconds(60);
        const out = await game.eval(() => ({
            owned: Game.BuildingsOwned,
            upgrades: Game.UpgradesOwned,
            status: MushieCookies.status(),
        }));
        assert.ok(out.owned >= 500, `only ${out.owned} buildings a minute after the windfall`);
        assert.ok(out.upgrades >= 20, `only ${out.upgrades} upgrades`);
        assert.deepEqual(failures(out.status), []);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('holds the golden cookie reserve when nothing better is for sale, and not when something is', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e7);
            Game.Objects['Cursor'].buy(20);
            Game.Objects['Grandma'].buy(20);
            Game.RebuildUpgrades();
            for (const u of Game.UpgradesInStore.slice()) if (['', 'cookie'].includes(u.pool)) u.buy();
            Game.Upgrades['Lucky day'].earn();
            Game.CalculateGains();
        });
        await turnOn(game);
        const out = await game.eval(() => {
            FrozenCookies.blacklist = 4; // the "no buildings" preset: nothing is left to buy
            MushieCookies.buyer.invalidate();
            const nothing = MushieCookies.buyer.report();
            FrozenCookies.blacklist = 0;
            MushieCookies.buyer.invalidate();
            const cheap = MushieCookies.buyer.report();
            return {
                cps: Game.unbuffedCps,
                nothing: { reserve: nothing.reserve, next: nothing.next && nothing.next.name },
                cheap: { reserve: cheap.reserve, next: cheap.next && cheap.next.name, payback: cheap.next && cheap.next.payback },
            };
        });
        assert.equal(out.nothing.next, null);
        assert.ok(Math.abs(out.nothing.reserve - 6000 * out.cps) < 1, `reserve ${out.nothing.reserve} should be 6000 × CpS ${out.cps}`);
        assert.ok(out.cheap.next, 'with the preset off there is something to buy');
        assert.ok(out.cheap.payback < 600, `early-game purchases pay back fast, got ${out.cheap.payback}`);
        assert.equal(out.cheap.reserve, 0, 'a reserve is not held ahead of a purchase that pays back faster');
    } finally {
        await game.close();
    }
});

test('respects a building limit from the settings', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e15);
            FrozenCookies.mineLimit = 1;
            FrozenCookies.mineMax = 30;
        });
        await turnOn(game);
        await game.advanceSeconds(60);
        const out = await game.eval(() => ({ mines: Game.Objects['Mine'].amount, farms: Game.Objects['Farm'].amount }));
        assert.ok(out.mines <= 30, `Mine went past its limit: ${out.mines}`);
        assert.ok(out.farms > 30, 'other buildings should have been bought freely');
    } finally {
        await game.close();
    }
});

test('the legacy adapters and the menu still work over the new buyer', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => Game.Earn(1e9));
        await turnOn(game);
        const out = await game.eval(() => {
            const next = nextPurchase();
            Game.ShowMenu('fc_menu');
            Game.UpdateMenu();
            const menuText = document.getElementById('menu').textContent;
            Game.ShowMenu('');
            return {
                cost: next.cost,
                name: next.purchase && next.purchase.name,
                bank: bestBank(0).cost,
                reserve: MushieCookies.buyer.reserve(),
                income: effectiveCps(),
                base: baseCps(),
                listed: recommendationList().length,
                menuHasBuying: menuText.includes('Buying') && menuText.includes('Next purchase'),
            };
        });
        assert.equal(typeof out.cost, 'number');
        assert.ok(out.name);
        assert.equal(out.bank, out.reserve);
        assert.ok(out.income >= out.base);
        assert.ok(out.listed > 10);
        assert.equal(out.menuHasBuying, true);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});
