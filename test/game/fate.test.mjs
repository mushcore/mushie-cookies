import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

const BAKERY = ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower'];

/**
 * A bakery with a working Grimoire and plenty of mana to cast repeatedly: 50 of each of eight
 * buildings, or `towers` Wizard towers and nothing else.
 */
async function withGrimoire(run, { towers = 0 } = {}) {
    const game = await launchWithMod();
    try {
        await game.eval((setup) => {
            Game.Earn(1e15);
            if (setup.towers) Game.Objects['Wizard tower'].buy(setup.towers);
            else for (const name of setup.bakery) Game.Objects[name].buy(50);
            // Level 10 gives a handful of towers enough magic for Force the Hand of Fate.
            Game.Objects['Wizard tower'].level = setup.towers ? 10 : 1;
            Game.LoadMinigames();
        }, { towers, bakery: BAKERY });
        await game.waitFor(() => !!(Game.Objects['Wizard tower'].minigame && Game.Objects['Wizard tower'].minigame.spells));
        await game.eval(() => Game.Objects['Wizard tower'].minigame.computeMagicM());
        return await run(game);
    } finally {
        await game.close();
    }
}

/** Pops a golden cookie forced to one outcome, as the spell makes (minigameGrimoire.js:48-64). */
const popForced = (force) => {
    const s = new Game.shimmer('golden', { noWrath: true });
    s.force = force;
    s.pop();
};

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

/** Casts `count` times under the conditions already set and returns forecasts beside results. */
const compareCasts = (cast, count) => {
    const castOnce = new Function(`return (${cast})()`);
    const M = Game.Objects['Wizard tower'].minigame;
    const results = [];
    for (let i = 0; i < count; i++) {
        const predicted = MushieCookies.forecastFate(Game, M, 0);
        const actual = castOnce();
        results.push({ predicted: predicted.outcome, actual: actual.force, predictedBackfire: !predicted.success, actualBackfire: actual.wrath === 1 });
        Game.shimmers.slice().forEach((s) => s.die());
    }
    return results;
};

test('the forecast matches the game with fewer than 10 buildings, where no building special is drawn', { skip }, () =>
    withGrimoire(
        async (game) => {
            const out = await game.eval(
                ({ cast, compare }) => {
                    const buildings = Game.BuildingsOwned;
                    return { buildings, results: new Function(`return (${compare})`)()(cast, 60) };
                },
                { cast: castAndRead.toString(), compare: compareCasts.toString() }
            );
            assert.ok(out.buildings < 10, `the bakery should have fewer than 10 buildings, has ${out.buildings}`);
            const wrong = out.results.filter((r) => r.predicted !== r.actual || r.predictedBackfire !== r.actualBackfire);
            assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} of ${out.results.length} forecasts were wrong`);
            assert.ok(out.results.filter((r) => !r.actualBackfire).length >= 20, 'the sample should be mostly successful casts');
        },
        { towers: 9 }
    ));

test('the forecast matches the game during Dragonflight, which takes click frenzy out of the draw', { skip }, () =>
    withGrimoire(async (game) => {
        const out = await game.eval(
            ({ cast, compare }) => {
                Game.gainBuff('dragonflight', 3600, 1111);
                return new Function(`return (${compare})`)()(cast, 60);
            },
            { cast: castAndRead.toString(), compare: compareCasts.toString() }
        );
        const wrong = out.filter((r) => r.predicted !== r.actual || r.predictedBackfire !== r.actualBackfire);
        assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} of ${out.length} forecasts were wrong`);
        assert.ok(out.filter((r) => !r.actualBackfire).length >= 20, 'the sample should be mostly successful casts');
        assert.ok(!out.some((r) => r.actual === 'click frenzy'), 'the game never draws click frenzy during Dragonflight');
    }));

test('outcome values match what the game grants', { skip }, () =>
    withGrimoire(async (game) => {
        const out = await game.eval((pop) => {
            const popForced = new Function(`return (${pop})`)();
            Game.shimmerTypes.golden.spawnConditions = () => false;
            const fresh = () => {
                Game.killBuffs();
                Game.CalculateGains();
                Game.CalculateGains();
            };
            const valueNow = (outcome) => MushieCookies.outcomeValue(outcome, MushieCookies.grimoire.context());
            const rows = [];
            // A CpS buff is worth the CpS the game adds, for as long as the game grants it.
            FrozenCookies.autoClick = 0;
            for (const force of ['frenzy', 'blood frenzy', 'clot', 'building special']) {
                fresh();
                const value = valueNow(force);
                const cps = Game.cookiesPs;
                const had = new Set(Object.keys(Game.buffs));
                popForced(force);
                Game.CalculateGains();
                const granted = Object.values(Game.buffs).find((b) => !had.has(b.name));
                rows.push({ force, value, game: ((Game.cookiesPs - cps) * granted.time) / Game.fps });
            }
            // A click frenzy is worth the click power the game adds, at the clicking speed.
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            fresh();
            let value = valueNow('click frenzy');
            const power = Game.computedMouseCps;
            popForced('click frenzy');
            Game.CalculateGains();
            rows.push({ force: 'click frenzy', value, game: (50 * (Game.computedMouseCps - power) * Game.buffs['Click frenzy'].time) / Game.fps });
            // Lucky pays out at once.
            fresh();
            value = valueNow('multiply cookies');
            let bank = Game.cookies;
            popForced('multiply cookies');
            rows.push({ force: 'multiply cookies', value, game: Game.cookies - bank });
            // A storm drop pays a random 1 to 7 minutes of CpS: compare with the mean of many.
            fresh();
            value = valueNow('cookie storm drop');
            bank = Game.cookies;
            const drops = 3000;
            for (let i = 0; i < drops; i++) new Game.shimmer('golden', { type: 'cookie storm drop' }, 1).pop();
            rows.push({ force: 'cookie storm drop', value, game: (Game.cookies - bank) / drops, sampled: true });
            return rows;
        }, popForced.toString());
        for (const r of out) {
            // 3000 draws of 1 to 7 put the sampled mean within 2% of the true one (4 sd).
            const tolerance = r.sampled ? 0.02 : 1e-6;
            assert.ok(Math.abs(r.value - r.game) <= tolerance * Math.abs(r.game), `${r.force}: valued at ${r.value}, the game gives ${r.game}`);
        }
    }));

test('an outcome whose buff is running is valued as the time the game adds to it', { skip }, () =>
    withGrimoire(async (game) => {
        await game.eval((pop) => {
            Game.shimmerTypes.golden.spawnConditions = () => false;
            FrozenCookies.autoClick = 0;
            new Function(`return (${pop})`)()('frenzy');
        }, popForced.toString());
        await game.advanceSeconds(27);
        const out = await game.eval((pop) => {
            const popForced = new Function(`return (${pop})`)();
            Game.CalculateGains();
            const value = MushieCookies.outcomeValue('frenzy', MushieCookies.grimoire.context());
            const before = Game.buffs.Frenzy.time;
            popForced('frenzy');
            Game.CalculateGains();
            const added = (Game.buffs.Frenzy.time - before) / Game.fps;
            return {
                value,
                secondsLeft: before / Game.fps,
                multiplier: Game.cookiesPs / Game.unbuffedCps,
                game: (Game.cookiesPs - Game.unbuffedCps) * added,
            };
        }, popForced.toString());
        assert.ok(out.secondsLeft > 40 && out.secondsLeft < 60, `the first Frenzy should still be running, ${out.secondsLeft} s left`);
        assert.ok(Math.abs(out.multiplier - 7) < 1e-9, `a second Frenzy does not multiply again: CpS is ×${out.multiplier}`);
        assert.ok(Math.abs(out.value - out.game) <= 1e-6 * out.game, `valued at ${out.value}, the game adds ${out.game}`);
    }));

test('a forecast frenzy is held, not cast onto a Frenzy it would only lengthen', { skip }, () =>
    withGrimoire(async (game) => {
        const setup = await game.eval((pop) => {
            const M = Game.Objects['Wizard tower'].minigame;
            Game.shimmerTypes.golden.spawnConditions = () => false;
            // Burn casts until the next one is a frenzy.
            for (let i = 0; i < 100 && MushieCookies.forecastFate(Game, M, 0).outcome !== 'frenzy'; i++) {
                M.magic = M.magicM;
                M.castSpell(M.spells["haggler's charm"]);
            }
            Game.killBuffs();
            new Function(`return (${pop})`)()('frenzy');
            // Enough for Force the Hand of Fate, not full.
            M.magic = M.getSpellCost(M.spells['hand of fate']) + 1;
            Object.assign(FrozenCookies, { autoFate: 1, autoCasting: 0, autoFTHOFCombo: 0, auto100ConsistencyCombo: 0, autoClick: 0 });
            return { next: MushieCookies.forecastFate(Game, M, 0).outcome, full: M.magic >= M.magicM - 1 };
        }, popForced.toString());
        assert.equal(setup.next, 'frenzy');
        assert.equal(setup.full, false);
        await game.advance(31);
        const report = await game.eval(() => MushieCookies.grimoire.report());
        assert.equal(report.casts, 0, `cast anyway: ${report.last && report.last.reason}`);
        assert.equal(report.decision.action, 'wait');
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

// Worth nothing or less whatever the buffs; everything else is worth casting while autoclicking
// at 50 a second (a cursed finger then pays 50 × 10 s of CpS a second).
const BAD = ['clot', 'ruin cookies', 'blab'];

test('forecast casting skips bad outcomes, casts good ones and pops the cookie', { skip }, () =>
    withGrimoire(async (game) => {
        await game.eval((bad) => {
            const M = Game.Objects['Wizard tower'].minigame;
            // A dozen or so casts fit in the run, which need not include a bad one: start with a
            // bad one next and mana full, so there is at least one to skip.
            for (let i = 0; i < 100 && !bad.includes(MushieCookies.forecastFate(Game, M, 0).outcome); i++) {
                M.magic = M.magicM;
                M.castSpell(M.spells["haggler's charm"]);
            }
            M.magic = M.magicM;
            Game.killBuffs();
            window.__startSpells = M.spellsCastTotal;
            // Record every spell cast: what the forecast said just before it, and whether the
            // cookie a Force the Hand of Fate made was popped.
            const castSpell = M.castSpell;
            window.__casts = [];
            M.castSpell = function (spell, obj) {
                const forecast = MushieCookies.forecastFate(Game, M, 0).outcome;
                const before = new Set(Game.shimmers);
                const cast = castSpell.call(this, spell, obj);
                if (!cast) return cast;
                const made = Game.shimmers.find((s) => !before.has(s));
                const record = { spell: spell === M.spells['hand of fate'] ? 'fate' : spell === M.spells["haggler's charm"] ? 'skip' : spell.name, forecast, made: made ? made.force : null, popped: false };
                if (made) {
                    const pop = made.pop;
                    made.pop = function () {
                        record.popped = true;
                        return pop.apply(this, arguments);
                    };
                }
                window.__casts.push(record);
                return cast;
            };
            FrozenCookies.autoFate = 1;
            FrozenCookies.autoCasting = 0;
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            FCStart();
        }, BAD);
        await game.advanceSeconds(3 * 3600);
        const out = await game.eval(() => ({
            report: MushieCookies.grimoire.report(),
            casts: window.__casts,
            spells: Game.Objects['Wizard tower'].minigame.spellsCastTotal - window.__startSpells,
            status: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`),
        }));
        const fate = out.casts.filter((c) => c.spell === 'fate');
        const skips = out.casts.filter((c) => c.spell === 'skip');
        const all = JSON.stringify(out.casts.map((c) => `${c.spell}:${c.forecast}`));
        assert.deepEqual(out.casts.filter((c) => c.spell !== 'fate' && c.spell !== 'skip'), [], 'no other spell is cast');
        assert.deepEqual(skips.filter((c) => !BAD.includes(c.forecast)), [], 'only bad outcomes are skipped');
        assert.deepEqual(fate.filter((c) => BAD.includes(c.forecast)), [], 'no bad outcome is cast');
        assert.deepEqual(fate.filter((c) => c.made !== c.forecast), [], 'each cast makes the forecast cookie');
        assert.deepEqual(fate.filter((c) => !c.popped), [], 'each cookie a cast makes is popped');
        assert.ok(fate.length > 0, `should have cast Force the Hand of Fate: ${all}`);
        assert.ok(skips.length > 0, `the run should include a bad outcome to skip: ${all}`);
        assert.equal(out.report.casts, fate.length);
        assert.equal(out.report.skips, skips.length);
        assert.equal(out.spells, out.report.casts + out.report.skips, 'every spell cast is one the system chose');
        assert.deepEqual(out.status, []);
        assert.deepEqual(game.errors, []);
    }));

test('forecast casting stands aside while an inherited casting mode is on', { skip }, () =>
    withGrimoire(async (game) => {
        await game.eval(() => {
            FrozenCookies.autoFate = 1;
            FrozenCookies.autoCasting = 2;
            FCStart();
        });
        await game.advanceSeconds(600);
        assert.equal(await game.eval(() => MushieCookies.grimoire.report().casts), 0);
    }));
