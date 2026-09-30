// Golden, wrath and storm-drop cookies, reindeer and news fortunes, clicked in the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

async function withGame(run, settings = { autoGC: 1, autoReindeer: 1, autoFortune: 1 }) {
    const game = await launchWithMod();
    try {
        await game.eval((s) => {
            Game.Earn(1e9);
            for (const name of ['Cursor', 'Grandma', 'Farm']) Game.Objects[name].buy(10);
            Object.assign(FrozenCookies, s);
            FCStart();
            // Every shimmer that dies unpopped.
            window.__missed = 0;
            for (const type of Object.values(Game.shimmerTypes)) {
                const miss = type.missFunc;
                type.missFunc = function () {
                    window.__missed++;
                    return miss.apply(this, arguments);
                };
            }
        }, settings);
        await game.advance(3);
        return await run(game);
    } finally {
        await game.close();
    }
}

test('five golden cookies on screen are all popped in the frame they appear', { skip }, () =>
    withGame(async (game) => {
        const out = await game.eval(() => {
            window.__popped = 0;
            const pop = Game.shimmer.prototype.pop;
            Game.shimmer.prototype.pop = function () {
                window.__popped++;
                return pop.apply(this, arguments);
            };
            for (let i = 0; i < 5; i++) new Game.shimmer('golden', { noWrath: true });
            return Game.shimmers.length;
        });
        assert.equal(out, 5);
        await game.advance(1);
        const after = await game.eval(() => ({ left: Game.shimmers.length, popped: window.__popped }));
        assert.deepEqual(after, { left: 0, popped: 5 });
    }));

test('wrath cookies, a whole cookie storm and reindeer are clicked, none missed', { skip }, () =>
    withGame(async (game) => {
        await game.eval(() => {
            new Game.shimmer('golden', { wrath: 1 });
            new Game.shimmer('reindeer');
            Game.gainBuff('cookie storm', 7, 7);
        });
        await game.advanceSeconds(15);
        const out = await game.eval(() => ({
            left: Game.shimmers.length,
            missed: window.__missed,
            popped: MushieCookies.shimmers.report().popped,
        }));
        assert.equal(out.left, 0);
        assert.equal(out.missed, 0);
        assert.equal(out.popped.wrath, 1);
        assert.equal(out.popped.reindeer, 1);
        assert.ok(out.popped.drop > 50, `${out.popped.drop} storm drops`);
    }));

test('golden cookie clicking survives a failure in the inherited loop it used to share', { skip }, () =>
    withGame(async (game) => {
        await game.eval(() => {
            // Anything in the inherited loop that keeps throwing: here the wrinkler valuation,
            // which runs before where the golden cookie clicks used to be.
            window.wrinklerValue = () => {
                throw new Error('injected');
            };
        });
        await game.advanceSeconds(5);
        const legacy = await game.eval(() => MushieCookies.status()['legacy:autoCookie']);
        assert.equal(legacy && legacy.disabled, true, 'the fixture must take the inherited loop down');
        await game.eval(() => new Game.shimmer('golden', { noWrath: true }));
        await game.advanceSeconds(1);
        const out = await game.eval(() => ({ left: Game.shimmers.length, missed: window.__missed }));
        assert.deepEqual(out, { left: 0, missed: 0 });
    }));

test('a fortune upgrade is taken on sight; the hour of CpS waits for a bank that covers it', { skip }, () =>
    withGame(async (game) => {
        // Fixtures stand in for the fortune roll (main.js:7565-7582) and keep it on the ticker.
        const upgrade = await game.eval(() => {
            const it = Game.Tiers.fortune.upgrades[0];
            Game.TickerEffect = { type: 'fortune', sub: it };
            Game.TickerAge = Game.fps * 10;
            return it.name;
        });
        await game.advance(31);
        assert.equal(await game.eval((name) => !!Game.HasUnlocked(name), upgrade), true, 'the upgrade was unlocked');

        await game.eval(() => {
            Game.Spend(Game.cookies - 1); // an empty bank
            Game.TickerEffect = { type: 'fortune', sub: 'fortuneCPS' };
            Game.TickerAge = Game.fps * 10;
        });
        await game.advance(60);
        const early = await game.eval(() => ({ taken: Game.fortuneCPS, effect: Game.TickerEffect && Game.TickerEffect.sub }));
        assert.deepEqual(early, { taken: 0, effect: 'fortuneCPS' }, 'left on the ticker');

        const out = await game.eval(() => {
            Game.Earn(Game.cookiesPs * 3600 * 2); // the bank grows past an hour of CpS
            return Game.cookies;
        });
        await game.advance(20);
        const late = await game.eval(() => ({ taken: Game.fortuneCPS, bank: Game.cookies }));
        assert.equal(late.taken, 1);
        assert.ok(late.bank > out * 1.4, 'it paid the full hour');
    }));

test('a cast of Force the Hand of Fate and the shimmer clicker never both pop one cookie, nor does a forecast see one', { skip }, () =>
    withGame(async (game) => {
        await game.eval(() => {
            Game.Earn(1e15);
            for (const name of ['Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(50);
            Game.Objects['Wizard tower'].level = 1;
            Game.LoadMinigames();
        });
        await game.waitFor(() => !!(Game.Objects['Wizard tower'].minigame && Game.Objects['Wizard tower'].minigame.spells));
        await game.eval(() => {
            const M = Game.Objects['Wizard tower'].minigame;
            M.computeMagicM();
            // The forecast reads the live fail chance, 15% higher for each golden cookie on screen
            // (minigameGrimoire.js:44-47): count the readings taken with one there.
            window.__readings = { all: 0, withCookie: 0 };
            const failChance = M.getFailChance;
            M.getFailChance = function () {
                window.__readings.all++;
                if (Game.shimmerTypes.golden.n > 0) window.__readings.withCookie++;
                return failChance.apply(this, arguments);
            };
            window.__pops = new Map();
            const pop = Game.shimmer.prototype.pop;
            Game.shimmer.prototype.pop = function () {
                window.__pops.set(this, (window.__pops.get(this) || 0) + 1);
                return pop.apply(this, arguments);
            };
            FrozenCookies.autoFate = 1;
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            FCStart();
        });
        await game.advanceSeconds(3600);
        const out = await game.eval(() => ({
            casts: MushieCookies.grimoire.report().casts,
            twice: [...window.__pops.values()].filter((n) => n > 1).length,
            popped: window.__pops.size,
            missed: window.__missed,
            readings: window.__readings,
            failures: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`),
        }));
        assert.ok(out.casts > 0, 'the grimoire should have cast');
        assert.ok(out.readings.all > 1000, `${out.readings.all} forecasts`);
        assert.equal(out.readings.withCookie, 0, 'the shimmer system runs first: no forecast sees a golden cookie');
        assert.ok(out.popped > out.casts, 'natural cookies were popped too');
        assert.equal(out.twice, 0);
        assert.equal(out.missed, 0);
        assert.deepEqual(out.failures, []);
    }));
