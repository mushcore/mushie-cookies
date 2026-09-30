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

// In the page: a bakery worth an ascension with everything the pre-ascension routine would act on
// (buildings, an unlocked Chocolate egg, Earth Shatterer learned, wrinklers holding cookies), and a
// log of those actions, each marked when it happens on the ascension screen, where the store and
// the minigames are hidden (style.css .ascending) and a player can do none of them.
const ASCENSION_FIXTURE = `window.__fixture = function () {
    Game.Earn(1e18);
    for (const b of Game.ObjectsById) b.buy(20);
    Game.Unlock('Chocolate egg');
    Game.dragonLevel = 12; // fixture: Earth Shatterer is learned
    for (let i = 0; i < 5; i++) {
        const w = Game.wrinklers[i];
        w.phase = 2; w.close = 1; w.hp = Game.wrinklerHP; w.type = 0; w.sucked = 1e15;
    }
    window.__acts = [];
    const wrap = (obj, name, label) => {
        const original = obj[name];
        obj[name] = function () {
            window.__acts.push(label(this) + (Game.OnAscend ? ' on the ascension screen' : ''));
            return original.apply(this, arguments);
        };
    };
    for (const b of Game.ObjectsById) wrap(b, 'sell', (me) => 'sell ' + me.name);
    wrap(Game.Upgrades['Chocolate egg'], 'buy', () => 'buy the Chocolate egg');
    wrap(Game, 'CollectWrinklers', () => 'collect the wrinklers');
    wrap(Game, 'SetDragonAura', () => 'set a dragon aura');
    const market = Game.Objects['Bank'].minigame;
    if (market) wrap(market, 'sellGood', () => 'sell stock');
    const garden = Game.Objects['Farm'].minigame;
    if (garden) wrap(garden, 'harvestAll', () => 'harvest the garden');
};`;

/** The player ascends, waits on the ascension screen, then reincarnates; what the mod did meanwhile. */
async function playerAscends(game) {
    await game.eval(() => Game.Ascend(1)); // the player ascends
    await game.advanceSeconds(10);
    const screen = await game.eval(() => ({ onAscend: Game.OnAscend, earned: Game.cookiesEarned, reset: Game.cookiesReset }));
    assert.equal(screen.onAscend, 1, 'fixture: the ascension screen is reached');
    await game.eval(() => Game.Reincarnate(1)); // the player reincarnates
    const after = await game.eval(() => ({ resets: Game.resets, reset: Game.cookiesReset, acts: window.__acts.slice() }));
    assert.equal(after.resets, 1, 'fixture: reincarnated');
    return { screen, after };
}

test("a player's own ascension is left alone, with every option off", { skip }, () =>
    withMod(async (game) => {
        await game.eval(ASCENSION_FIXTURE);
        await game.eval(() => window.__fixture());
        const { screen, after } = await playerAscends(game);
        assert.deepEqual(after.acts, [], 'nothing is sold, bought, popped, harvested or switched for the player');
        assert.equal(after.reset - screen.reset, screen.earned, 'the reset counts what the ascension screen showed, and no more');
    }));

test("with the Autopilot on, a player's own ascension is still not touched on the ascension screen", { skip }, () =>
    withMod(async (game) => {
        await game.eval(ASCENSION_FIXTURE);
        await game.eval(() => {
            setPreferenceDirect('autopilot', 1); // the one switch, as the menu button does it
            window.__fixture();
        });
        const { screen, after } = await playerAscends(game);
        assert.deepEqual(
            after.acts.filter((a) => a.endsWith('on the ascension screen')),
            [],
            'nothing is done while the store and the minigames are hidden'
        );
        assert.equal(after.reset - screen.reset, screen.earned, 'the reset counts what the ascension screen showed, and no more');
    }));
