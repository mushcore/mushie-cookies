import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

/** A bakery with a working Grimoire and plenty of mana to cast repeatedly. */
async function withGrimoire(run) {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e15);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(50);
            Game.Objects['Wizard tower'].level = 1;
            Game.LoadMinigames();
        });
        await game.waitFor(() => !!(Game.Objects['Wizard tower'].minigame && Game.Objects['Wizard tower'].minigame.spells));
        return await run(game);
    } finally {
        await game.close();
    }
}

/** Casts Force the Hand of Fate and reports what the game produced. */
const castAndRead = () => {
    const M = Game.Objects['Wizard tower'].minigame;
    M.magic = M.magicM;
    const before = new Set(Game.shimmers);
    const cast = M.castSpell(M.spells['hand of fate']);
    const made = Game.shimmers.find((s) => !before.has(s));
    return { cast, force: made ? made.force : null, wrath: made ? made.wrath : null };
};

test('the forecast matches what the game casts, over many casts and seasons', { skip }, () =>
    withGrimoire(async (game) => {
        const out = await game.eval((cast) => {
            const castOnce = new Function(`return (${cast})()`);
            const M = Game.Objects['Wizard tower'].minigame;
            const results = [];
            for (const season of ['', 'valentines', 'easter', 'christmas', 'halloween']) {
                Game.season = season;
                for (let i = 0; i < 40; i++) {
                    // Some casts with golden cookies already on screen, which raises the fail chance.
                    if (i % 5 === 0) new Game.shimmer('golden', { noWrath: true });
                    const predicted = MushieCookies.forecastFate(Game, M, 0);
                    const actual = castOnce();
                    results.push({
                        season,
                        predicted: predicted.outcome,
                        actual: actual.force,
                        predictedBackfire: !predicted.success,
                        actualBackfire: actual.wrath === 1,
                    });
                    Game.shimmers.slice().forEach((s) => s.die());
                }
            }
            Game.season = '';
            return results;
        }, castAndRead.toString());
        const wrong = out.filter((r) => r.predicted !== r.actual || r.predictedBackfire !== r.actualBackfire);
        assert.equal(out.length, 200);
        assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} of ${out.length} forecasts were wrong`);
        assert.ok(new Set(out.map((r) => r.actual)).size >= 4, 'the sample should cover several outcomes');
        assert.ok(out.some((r) => r.actualBackfire), 'the sample should include a backfire');
    }));

test('forecasting does not disturb the game\'s own random numbers', { skip }, () =>
    withGrimoire(async (game) => {
        const out = await game.eval(() => {
            const M = Game.Objects['Wizard tower'].minigame;
            const draws = (n) => Array.from({ length: n }, () => Math.random());
            Math.seedrandom('check');
            const plain = draws(5);
            Math.seedrandom('check');
            const withForecast = [];
            for (let i = 0; i < 5; i++) {
                MushieCookies.forecastFate(Game, M, i);
                withForecast.push(Math.random());
            }
            return { plain, withForecast };
        });
        assert.deepEqual(out.withForecast, out.plain);
    }));

test('a forecast further ahead matches the cast that many casts later', { skip }, () =>
    withGrimoire(async (game) => {
        const out = await game.eval((cast) => {
            const castOnce = new Function(`return (${cast})()`);
            const M = Game.Objects['Wizard tower'].minigame;
            const ahead = [0, 1, 2, 3].map((i) => MushieCookies.forecastFate(Game, M, i).outcome);
            const actual = [];
            for (let i = 0; i < 4; i++) {
                actual.push(castOnce().force);
                Game.shimmers.slice().forEach((s) => s.die());
            }
            return { ahead, actual };
        }, castAndRead.toString());
        assert.deepEqual(out.ahead, out.actual);
    }));
