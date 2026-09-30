// The wrinkler system in the real game: payouts as the game pays them, no season pop-all unless
// a hunt pays, shinies kept without stalling, the income model following the policy, and
// wrinkler cookies counted for every ascension, the player's own included.
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

// In the page: wrinklers 0..n-1 attached and feeding, each holding `sucked`.
const ATTACH = `window.__attach = function (n, sucked) {
    for (let i = 0; i < n; i++) {
        const w = Game.wrinklers[i];
        w.phase = 2; w.close = 1; w.hp = Game.wrinklerHP; w.type = 0; w.sucked = typeof sucked === 'function' ? sucked(i) : sucked;
    }
};`;

const failures = () =>
    Object.entries(MushieCookies.status())
        .filter(([, s]) => s.failures > 0)
        .map(([n, s]) => `${n}: ${s.lastError}`);

test('the wrinkler value is what the game pays, Dragon Guts and Skruuia included', { skip }, () =>
    withMod(async (game) => {
        await game.eval(ATTACH);
        const out = await game.eval(() => {
            Game.dragonLevel = 22; // fixture: the aura is learned
            Game.dragonAura = 21; // Dragon Guts
            Game.hasGod = (name) => (name === 'scorn' ? 1 : false); // fixture: Skruuia in the diamond slot
            window.__attach(10, 1e6);
            return { value: wrinklerValue(), earned: Game.cookiesEarned };
        });
        await game.eval(() => Game.CollectWrinklers());
        await game.advance(2);
        const paid = (await game.eval(() => Game.cookiesEarned)) - out.earned;
        assert.ok(paid > 1e7, `fixture: the game paid ${paid}`);
        assert.ok(Math.abs(out.value - paid) / paid < 1e-9, `valued at ${out.value}, the game paid ${paid}`);
    }));

test('Halloween with drops missing pops nothing unless a hunt pays', { skip }, () =>
    withMod(async (game) => {
        await game.eval(ATTACH);
        await game.eval(() => {
            Game.Objects['Grandma'].getFree(10); // the grandmapocalypse needs grandmas
            Game.elderWrath = 3;
            Game.season = 'halloween';
            Game.seasonT = Game.fps * 3600 * 24; // as the biscuit sets it; at 0 the season ends next frame
            window.__attach(10, 1e3);
            FrozenCookies.autoWrinkler = 1;
        });
        await game.advanceSeconds(5);
        const attached = await game.eval(() => Game.wrinklers.filter((w) => w.phase == 2).length);
        assert.equal(attached, 10, 'no hunt was asked for, so no wrinkler is popped for drops');
        // The season system asks for a hunt at a value no forfeited income can match.
        await game.eval(() => MushieCookies.wrinklers.hunt({ season: 'halloween', value: 1e30 }));
        await game.advanceSeconds(2);
        const hunted = await game.eval(() => ({
            attached: Game.wrinklers.filter((w) => w.phase == 2).length,
            report: MushieCookies.wrinklers.report(),
            count: MushieCookies.readState(Game, FrozenCookies).wrinklers.count,
        }));
        assert.equal(hunted.attached, 0, 'a paying hunt pops them');
        assert.equal(hunted.report.hunting, true);
        assert.equal(hunted.count, 0, 'the income model counts none while hunting');
        assert.deepEqual(await game.eval(failures), []);
    }));

test('the income model counts the wrinklers the policy keeps, with the refill still to come', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            Game.Objects['Grandma'].getFree(10);
            Game.elderWrath = 1; // wrath has just begun: no wrinkler yet, no Unholy bait
            FrozenCookies.autoWrinkler = 1;
            return { max: Game.getWrinklersMax(), count: MushieCookies.readState(Game, FrozenCookies).wrinklers.count };
        });
        // At wrath 1 a slot takes about 55 minutes to fill: the next hour averages about 3.9.
        assert.ok(out.count > 3 && out.count < 4.5, `count ${out.count} of ${out.max}`);
    }));

test('a protected shiny as the fattest neither is popped nor stops the others', { skip }, () =>
    withMod(async (game) => {
        await game.eval(ATTACH);
        const out = await game.eval(() => {
            Game.Earn(1e9);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine']) Game.Objects[name].buy(20);
            Game.Upgrades['Unholy bait'].earn();
            Game.elderWrath = 3;
            Game.cookies = 0; // harness: an empty bank
            Game.CalculateGains();
            // A ten-hour manual bank makes the next purchase far away without popping.
            FrozenCookies.holdManBank = 1;
            FrozenCookies.manBankMins = 600;
            const cps = Game.unbuffedCps;
            window.__attach(10, (i) => (i === 0 ? 1e5 : 5e4 - i) * cps);
            Game.wrinklers[0].type = 1; // the shiny is the fattest
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoWrinkler = 1;
            FrozenCookies.shinyPop = 0;
            FCStart();
            return { cps };
        });
        assert.ok(out.cps > 0, 'fixture: the bakery makes cookies');
        await game.advanceSeconds(3);
        const after = await game.eval(() => ({
            shiny: Game.wrinklers[0].phase == 2 && Game.wrinklers[0].type == 1,
            popped: Game.wrinklersPopped,
        }));
        assert.equal(after.shiny, true, 'the shiny is kept');
        assert.ok(after.popped >= 1, 'an ordinary wrinkler is popped for the purchase');
    }));

test('only the wrinkler system pops: the inherited popping is gone', { skip }, () =>
    withMod(async (game) => {
        const left = await game.eval(() => typeof window.shouldPopWrinklers);
        assert.equal(left, 'undefined');
    }));

test('wrinklers are collected a tick before the Chocolate egg, so its 5% includes them', { skip }, () =>
    withMod(async (game) => {
        await game.eval(ATTACH);
        await game.eval(() => {
            Game.Earn(1e14);
            for (const b of Game.ObjectsById.slice(0, 6)) b.buy(60);
            Game.prestige = 100;
            Game.heavenlyChips = 0;
            Game.cookiesReset = Game.HowManyCookiesReset(100);
            Game.cookiesEarned = Game.HowManyCookiesReset(210) - Game.cookiesReset;
            Game.resets = 1;
            Game.Objects['Grandma'].getFree(10);
            Game.elderWrath = 1;
            Game.Unlock('Chocolate egg');
            window.__attach(10, Game.cookiesEarned / 10);
            // Record what the wrinklers still hold when the egg is bought.
            const egg = Game.Upgrades['Chocolate egg'];
            const buy = egg.buy;
            window.__atEgg = null;
            egg.buy = function () {
                window.__atEgg = { held: Game.wrinklers.filter((w) => w.phase > 0 && w.sucked > 0).length, cookies: Game.cookies };
                return buy.apply(this, arguments);
            };
            MushieCookies.ascension.options.rule = 'double';
            FrozenCookies.autoAscendToggle = 1;
        });
        await game.advanceSeconds(60);
        const out = await game.eval(() => ({ atEgg: window.__atEgg, resets: Game.resets, egg: Game.Has('Chocolate egg') }));
        assert.ok(out.atEgg, 'fixture: the egg should have been bought');
        assert.equal(out.atEgg.held, 0, 'no wrinkler still holds cookies when the egg is bought');
        assert.ok(out.resets >= 2, 'the ascension went through');
        assert.deepEqual(await game.eval(failures), []);
    }));

test("wrinkler cookies count toward an ascension the player starts", { skip }, () =>
    withMod(async (game) => {
        await game.eval(ATTACH);
        const expected = await game.eval(() => {
            Game.Earn(1e14);
            Game.prestige = 0;
            Game.cookiesReset = 0;
            Game.cookiesEarned = Game.HowManyCookiesReset(100);
            window.__attach(10, Game.cookiesEarned / 10);
            FrozenCookies.autoWrinkler = 1;
            FrozenCookies.autoAscendToggle = 0;
            const payout = 10 * (Game.cookiesEarned / 10) * 1.1;
            Game.Ascend(1); // the player ascends
            return Math.floor(Game.HowMuchPrestige(Game.cookiesEarned + payout));
        });
        await game.advanceSeconds(10);
        const out = await game.eval(() => ({ prestige: Game.prestige, onAscend: Game.OnAscend }));
        assert.equal(out.onAscend, 1, 'the ascension screen is reached');
        assert.ok(out.prestige >= expected - 1, `prestige ${out.prestige}; with the wrinklers collected about ${expected}`);
    }));

test("with the setting off, the player's ascension runs as the game runs it", { skip }, () =>
    withMod(async (game) => {
        await game.eval(ATTACH);
        const withoutThem = await game.eval(() => {
            Game.Earn(1e14);
            Game.cookiesEarned = Game.HowManyCookiesReset(100);
            window.__attach(10, Game.cookiesEarned / 10);
            FrozenCookies.autoWrinkler = 0;
            const at = Math.floor(Game.HowMuchPrestige(Game.cookiesEarned));
            Game.Ascend(1);
            return { at, timer: Game.AscendTimer };
        });
        assert.equal(withoutThem.timer, 1, 'the animation starts at once');
        await game.advanceSeconds(10);
        assert.equal(await game.eval(() => Game.prestige), withoutThem.at);
    }));
