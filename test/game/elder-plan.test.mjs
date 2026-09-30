import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

const failures = (status) =>
    Object.entries(status)
        .filter(([, s]) => s.failures > 0)
        .map(([name, s]) => `${name}: ${s.lastError}`);

/** A bakery past Elder Pact with a rich bank, buying upgrades only (the NO BUILDINGS preset). Runs in the page. */
function pastElderPact(autoWrinkler) {
    Game.Earn(1e20);
    for (const b of Game.ObjectsById.slice(0, 12)) b.buy(50);
    const research = ['Bingo center/Research facility', 'Specialized chocolate chips', 'Designer cocoa beans', 'Ritual rolling pins', 'Underworld ovens', 'One mind', 'Exotic nuts', 'Communal brainsweep', 'Arcane sugar', 'Elder Pact'];
    for (const name of research) Game.Upgrades[name].earn();
    Game.Upgrades['Kitten helpers'].earn(); // milk only pays through kittens
    FrozenCookies.blacklist = 4;
    FrozenCookies.autoBuy = 1;
    FrozenCookies.autoWrinkler = autoWrinkler;
    FCStart();
}

const elderState = () =>
    game.eval(() => ({
        won: ['Elder nap', 'Elder slumber', 'Elder calm'].filter((name) => Game.Achievements[name].won),
        pledges: Game.pledges,
        pledgeT: Game.pledgeT,
        covenant: Game.Upgrades['Elder Covenant'].bought,
        elderWrath: Game.elderWrath,
        inPlay: Game.wrinklers.filter((w) => w.phase > 0).length,
        status: MushieCookies.status(),
    }));
let game;

test('with buying on, the pledge achievements are bought and the grandmapocalypse comes back', { skip }, async () => {
    game = await launchWithMod();
    try {
        await game.eval(pastElderPact, 1);
        await game.advanceSeconds(30);
        const out = await elderState();
        assert.deepEqual(out.won, ['Elder nap', 'Elder slumber', 'Elder calm']);
        assert.ok(out.pledges >= 5, `${out.pledges} pledges`);
        assert.equal(out.covenant, 0, 'the covenant is revoked: no 5% of CpS lost');
        assert.equal(out.pledgeT, 0, 'no pledge left running');
        assert.ok(out.elderWrath > 0, 'the grandmapocalypse returns');
        assert.deepEqual(failures(out.status), []);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('wrinklers the wrinkler system leaves be are not popped for it', { skip }, async () => {
    game = await launchWithMod();
    try {
        await game.eval(pastElderPact, 0);
        await game.eval(() => Game.SpawnWrinkler());
        await game.advanceSeconds(30);
        const kept = await elderState();
        assert.equal(kept.inPlay, 1, 'the wrinkler is still there');
        assert.equal(kept.pledges, 0, 'no pledge while popping is off');
        await game.eval(() => {
            FrozenCookies.autoWrinkler = 1;
        });
        await game.advanceSeconds(30);
        const out = await elderState();
        assert.deepEqual(out.won, ['Elder nap', 'Elder slumber', 'Elder calm'], 'with popping on the plan goes ahead');
        assert.equal(out.covenant, 0);
        assert.deepEqual(failures(out.status), []);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});
