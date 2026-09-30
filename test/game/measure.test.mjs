import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

async function withGame(run) {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e12);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine']) Game.Objects[name].buy(30);
            Game.CalculateGains();
        });
        return await run(game);
    } finally {
        await game.close();
    }
}

test('the income state mirrors the game with no buff running', { skip }, () =>
    withGame(async (game) => {
        const out = await game.eval(() => {
            const s = MushieCookies.readState(Game, { autoClick: 1, cookieClickSpeed: 250 });
            return {
                cps: s.cps, gameCps: Game.unbuffedCps,
                click: s.clickPower, gameClick: Game.computedMouseCps,
                clicks: s.clicksPerSecond,
                interval: s.golden.meanInterval,
                min: Game.shimmerTypes.golden.getMinTime(Game.shimmerTypes.golden) / Game.fps,
                max: Game.shimmerTypes.golden.getMaxTime(Game.shimmerTypes.golden) / Game.fps,
                sum: Object.values(s.golden.probabilities).reduce((a, b) => a + b, 0),
                special: s.golden.probabilities['building special'] || 0,
                specialMean: s.golden.buildingSpecialMean,
                wrinklers: s.wrinklers.count,
            };
        });
        assert.equal(out.cps, out.gameCps);
        assert.ok(out.cps > 0);
        assert.equal(out.click, out.gameClick);
        assert.equal(out.clicks, 50, 'click speed is capped at what the game accepts');
        assert.ok(out.interval > out.min && out.interval < out.max, `${out.interval} not in (${out.min}, ${out.max})`);
        assert.ok(Math.abs(out.sum - 1) < 1e-9);
        assert.ok(out.special > 0.05);
        assert.equal(out.specialMean, 30);
        assert.equal(out.wrinklers, 0);
    }));

test('a running click frenzy is divided out of the click power', { skip }, () =>
    withGame(async (game) => {
        const out = await game.eval(() => {
            const before = MushieCookies.readState(Game, { autoClick: 1, cookieClickSpeed: 50 });
            Game.gainBuff('click frenzy', 10, 777);
            Game.CalculateGains();
            const during = MushieCookies.readState(Game, { autoClick: 1, cookieClickSpeed: 50 });
            return { before: before.clickPower, during: during.clickPower, cps: [before.cps, during.cps], buffed: Game.computedMouseCps };
        });
        assert.ok(out.buffed > out.before * 700, 'the buff should be in the game value');
        assert.ok(Math.abs(out.during - out.before) / out.before < 1e-9, `${out.during} vs ${out.before}`);
        assert.equal(out.cps[0], out.cps[1]);
    }));

// Each mouse upgrade adds 1% of Game.cookiesPs to a click (main.js:4692-4706), and cookiesPs
// already carries every CpS buff (5159-5167): under a Frenzy that part of a click is 7x bigger.
const MICE = ['Thousand fingers', 'Plastic mouse', 'Iron mouse', 'Titanium mouse'];

test('no CpS buff is counted in the click power, alone or beside a click buff', { skip }, () =>
    withGame(async (game) => {
        const out = await game.eval((mice) => {
            for (const name of mice) Game.Upgrades[name].earn();
            Game.CalculateGains();
            const read = () => MushieCookies.readState(Game, { autoClick: 1, cookieClickSpeed: 50 });
            const calm = read();
            const buffs = [
                [['frenzy', 77, 7]],
                [['blood frenzy', 6, 666]],
                [['dragon harvest', 60, 15]],
                [['building buff', 30, 4, 2]],
                [['clot', 66, 0.5]],
                [['sugar frenzy', 3600, 3]],
                [['cursed finger', 10, 1e9]],
                [['frenzy', 77, 7], ['click frenzy', 13, 777]],
            ];
            const rows = buffs.map((list) => {
                Game.killBuffs();
                for (const b of list) Game.gainBuff(...b);
                Game.CalculateGains();
                const cps = Game.cookiesPs;
                const hasBuff = Game.hasBuff;
                const s = read();
                return {
                    buffs: list.map((b) => b[0]).join(' + '),
                    click: s.clickPower,
                    // readState leaves the game as it found it
                    kept: Game.cookiesPs === cps && Game.hasBuff === hasBuff,
                };
            });
            Game.killBuffs();
            Game.CalculateGains();
            return { calm: calm.clickPower, gameCalm: Game.computedMouseCps, cps: calm.cps, rows };
        }, MICE);
        assert.equal(out.calm, out.gameCalm);
        assert.ok(out.calm > 0.03 * out.cps, 'the mice make a share of CpS part of every click');
        for (const row of out.rows) {
            assert.ok(Math.abs(row.click - out.calm) <= 1e-9 * out.calm, `${row.buffs}: click power ${row.click} is not ${out.calm}`);
            assert.ok(row.kept, `${row.buffs}: the game was left changed`);
        }
    }));

test('a ranking made during a Frenzy is the ranking made without one', { skip }, () =>
    withGame(async (game) => {
        const out = await game.eval((mice) => {
            for (const name of mice) Game.Upgrades[name].earn();
            Game.CalculateGains();
            // Clicks are counted (at the speed setting; the clicker itself is not started).
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            const rankNow = () => {
                MushieCookies.buyer.invalidate();
                const r = MushieCookies.buyer.report();
                return { reserve: r.reserve, income: r.income.total, top: r.top.map((c) => [c.name, c.payback]) };
            };
            const calm = rankNow();
            Game.gainBuff('frenzy', 77, 7);
            Game.CalculateGains();
            const frenzy = rankNow();
            Game.killBuffs();
            Game.CalculateGains();
            return { calm, frenzy };
        }, MICE);
        assert.ok(out.calm.top.length >= 3, 'something to rank');
        const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
        assert.ok(near(out.frenzy.income, out.calm.income), `income ${out.frenzy.income} under a Frenzy, ${out.calm.income} without`);
        assert.deepEqual(out.frenzy.top.map((c) => c[0]), out.calm.top.map((c) => c[0]));
        out.calm.top.forEach(([name, payback], i) =>
            assert.ok(near(out.frenzy.top[i][1], payback), `${name}: payback ${out.frenzy.top[i][1]} under a Frenzy, ${payback} without`)
        );
        assert.equal(out.frenzy.reserve, out.calm.reserve);
    }));

test('Lucky day halves the expected wait for a golden cookie', { skip }, () =>
    withGame(async (game) => {
        const out = await game.eval(() => {
            const before = MushieCookies.readState(Game, {}).golden.meanInterval;
            Game.Upgrades['Lucky day'].earn();
            const after = MushieCookies.readState(Game, {}).golden.meanInterval;
            return { before, after };
        });
        assert.ok(Math.abs(out.after / out.before - 0.5) < 0.05, `${out.after} / ${out.before}`);
    }));

test('the fiftieth cursor is worth its achievement inside a what-if', { skip }, () =>
    withGame(async (game) => {
        const out = await game.eval(() => {
            Game.Upgrades['Kitten helpers'].earn(); // milk only pays through kittens
            const cursor = Game.Objects['Cursor'];
            cursor.amount = 49;
            cursor.bought = 49;
            Game.BuildingsOwned = Game.ObjectsById.reduce((s, b) => s + b.amount, 0);
            Game.CalculateGains();
            const owned = Game.AchievementsOwned;
            const plain = { apply: () => { cursor.amount++; cursor.bought++; Game.BuildingsOwned++; } };
            const aware = { apply: () => { plain.apply(); MushieCookies.awardForBuildings(Game, cursor); } };
            const [a, b] = MushieCookies.simulateEach(Game, [plain, aware], () => ({ cps: Game.cookiesPs, owned: Game.AchievementsOwned }));
            return { plain: a, aware: b, ownedAfter: Game.AchievementsOwned, ownedBefore: owned, amount: cursor.amount };
        });
        assert.ok(out.aware.owned > out.plain.owned, 'the tier achievement should be counted in the aware trial');
        assert.ok(out.aware.cps > out.plain.cps, 'the achievement raises milk and so CpS');
        assert.equal(out.ownedAfter, out.ownedBefore);
        assert.equal(out.amount, 49);
    }));

test('a what-if of every building takes well under a millisecond each', { skip }, () =>
    withGame(async (game) => {
        const perTrialMs = await game.eval(() => {
            const frame = document.createElement('iframe');
            document.body.appendChild(frame);
            const now = frame.contentWindow.performance.now.bind(frame.contentWindow.performance);
            const trials = Game.ObjectsById.map((b) => ({
                apply: () => { b.amount++; b.bought++; Game.BuildingsOwned++; MushieCookies.awardForBuildings(Game, b); },
            }));
            MushieCookies.simulateEach(Game, trials, () => Game.cookiesPs); // warm up
            const t0 = now();
            for (let i = 0; i < 10; i++) MushieCookies.simulateEach(Game, trials, () => Game.cookiesPs);
            return (now() - t0) / (10 * trials.length);
        });
        assert.ok(perTrialMs < 1, `${perTrialMs.toFixed(3)} ms per trial`);
    }));

test('no golden cookie income is expected while golden cookies cannot spawn', { skip }, () =>
    withGame(async (game) => {
        const out = await game.eval(() => {
            const on = MushieCookies.readState(Game, {}).golden.meanInterval;
            Game.Upgrades['Golden switch [off]'].earn(); // the switch is on: spawning stops
            const off = MushieCookies.readState(Game, {}).golden.meanInterval;
            return { on, off, spawns: Game.shimmerTypes.golden.spawnConditions() };
        });
        assert.ok(Number.isFinite(out.on));
        assert.equal(out.spawns, false);
        assert.equal(out.off, Infinity);
    }));

test('storm drops are counted at the game frame rate, all of them when the shimmer system clicks', { skip }, () =>
    withGame(async (game) => {
        const out = await game.eval(() => ({
            on: MushieCookies.readState(Game, { autoGC: 1 }).golden,
            off: MushieCookies.readState(Game, { autoGC: 0 }).golden,
            fps: Game.fps,
        }));
        assert.equal(out.on.fps, out.fps);
        assert.equal(out.on.stormReach, 1);
        assert.equal(out.off.stormReach, 0.5, 'by hand, the inherited guess of half');
    }));
