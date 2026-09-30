// Fair-play regressions the settings audit found in the inherited code: each test acts as the
// inherited code would and checks that the game was only touched the way a player could.
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

test('the spell tooltip forecast leaves the game generator alone and agrees with the mod forecast', { skip }, () =>
    withMod(async (game) => {
        await game.eval(() => {
            Game.Earn(1e15);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(50);
            Game.Objects['Wizard tower'].level = 1; // fixture: the grimoire needs a level
            Game.LoadMinigames();
        });
        await game.waitFor(() => !!(Game.Objects['Wizard tower'].minigame && Game.Objects['Wizard tower'].minigame.spells));
        const out = await game.eval(() => {
            const M = Game.Objects['Wizard tower'].minigame;
            Math.seedrandom('probe');
            const expected = [Math.random(), Math.random()];
            Math.seedrandom('probe');
            const labels = [0, 1, 2, 3].map((i) => nextSpell(i));
            const after = [Math.random(), Math.random()];
            const forecast = [0, 1, 2, 3].map((i) => MushieCookies.forecastFate(Game, M, i).outcome);
            return { expected, after, labels, forecast };
        });
        assert.deepEqual(out.after, out.expected, 'hovering the spell must not reseed or advance Math.random');
        out.labels.forEach((label, i) => assert.ok(typeof label === 'string' && label.startsWith('<small>'), `label ${i}: ${label}`));
        assert.equal(out.labels.length, out.forecast.length);
    }));

test('the frame rate stays at the game\'s 30 a second', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => ({ option: 'fpsModifier' in FrozenCookies.preferenceValues, fps: Game.fps }));
        assert.equal(out.option, false, 'the option that rewrote Game.fps is gone');
        await game.eval(() => {
            FrozenCookies.autoBuy = 1;
            FCStart();
        });
        await game.advanceSeconds(30);
        assert.equal(await game.eval(() => Game.fps), 30);
    }));

test('the pre-ascension egg routine picks Earth Shatterer only where a player could (dragon level 9)', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            Game.Earn(1e30);
            for (const b of Game.ObjectsById) b.buy(10);
            Game.Unlock('Chocolate egg');
            Game.dragonLevel = 6; // fixture: aura 5 (Earth Shatterer) is not yet learned
            prepareForAscension();
            return { aura: Game.dragonAuras[Game.dragonAura].name, egg: Game.Has('Chocolate egg') };
        });
        assert.notEqual(out.aura, 'Earth Shatterer');
        assert.equal(out.egg, 1, 'the egg is still bought, without the aura');
    }));

test('the Halloween switch never buys a season a player could not', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            Game.Earn(1e30);
            // A wrinkler to trigger the inherited switch, and no Season switcher.
            Game.elderWrath = 1;
            Game.wrinklers[0].phase = 2;
            Game.wrinklers[0].close = 1;
            FrozenCookies.autoHalloween = 1;
            autoHalloweenAction();
            return { season: Game.season, ghostly: Game.UpgradesById[183].bought };
        });
        assert.equal(out.ghostly, 0);
        assert.notEqual(out.season, 'halloween');
    }));

test('a run the mod joins midway is measured from where it really began', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            Game.cookiesReset = Game.HowManyCookiesReset(1000);
            Game.prestige = 1000;
            Game.resets = 1;
            Game.cookiesEarned = Game.HowManyCookiesReset(1500) - Game.cookiesReset;
            Game.startDate = Date.now() - 5 * 3600 * 1000; // five hours into the run
            FrozenCookies.autoAscendToggle = 1;
            FCStart();
            return true;
        });
        assert.ok(out);
        await game.advanceSeconds(90);
        const r = await game.eval(() => {
            const rep = MushieCookies.ascension.report();
            return { average: rep.verdict.averageRate, projected: rep.projected, runSeconds: rep.runSeconds };
        });
        const expected = (Math.log(1 + r.projected) - Math.log(1 + 1000)) / (r.runSeconds + 300);
        assert.ok(Math.abs(r.average - expected) / expected < 0.01, `average ${r.average} against ${expected}`);
    }));
