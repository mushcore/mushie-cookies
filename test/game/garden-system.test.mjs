// The garden system on the game's own garden: money, soil, harvests, sacrifice, small plots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

// Everything but the two plants that need more neighbours than a 2×2 or 3×2 plot has around a
// tile: the juicy queenbeet (eight queenbeets) and the everdaisy (three tidygrass, three elderwort).
const ALL_BUT_BIG_RINGS = [
    'bakerWheat', 'thumbcorn', 'cronerice', 'gildmillet', 'clover', 'goldenClover', 'shimmerlily', 'elderwort',
    'bakeberry', 'chocoroot', 'whiteChocoroot', 'whiteMildew', 'brownMold', 'meddleweed', 'whiskerbloom',
    'chimerose', 'nursetulip', 'drowsyfern', 'wardlichen', 'keenmoss', 'queenbeet', 'duketater', 'crumbspore',
    'doughshroom', 'glovemorel', 'cheapcap', 'foolBolete', 'wrinklegill', 'greenRot', 'shriekbulb', 'tidygrass',
    'ichorpuff',
];

/**
 * A bakery with the garden at `level`, `farms` farms and the seeds in `unlocked` ('all', or a
 * list; by default the fresh log of Baker's wheat alone). Nothing is automated until the test
 * says so, and autoBuy stays off, so the garden is the only thing spending.
 */
async function withGarden({ level = 9, farms = 320, unlocked = null } = {}, run) {
    const game = await launchWithMod();
    try {
        await game.eval(
            ({ level, farms }) => {
                Game.Earn(1e30);
                for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory']) Game.Objects[name].buy(name === 'Farm' ? farms : 100);
                // Cookies earned is where income is read: at 1e30 a second of it would not register.
                Game.cookies = 1e15;
                Game.cookiesEarned = 1e15;
                Game.Objects['Farm'].level = level;
                Game.LoadMinigames();
            },
            { level, farms }
        );
        await game.waitFor(() => !!(Game.Objects['Farm'].minigame && Game.Objects['Farm'].minigame.plants));
        await game.eval((keys) => {
            const M = Game.Objects['Farm'].minigame;
            window.failures = () =>
                Object.entries(MushieCookies.status())
                    .filter(([, s]) => s.failures > 0)
                    .map(([n, s]) => `${n}: ${s.lastError}`);
            window.plotPlants = () => M.plot.reduce((n, row) => n + row.filter((t) => t[0] > 0).length, 0);
            window.setSoil = (key) => {
                M.nextSoil = 0;
                document.getElementById('gardenSoil-' + M.soils[key].id).click();
                M.nextSoil = 0; // free to change again at once: only the garden's choice keeps it
            };
            if (!keys) return;
            for (const p of Object.values(M.plants)) {
                if (keys === 'all' || keys.includes(p.key)) M.unlockSeed(p);
                else M.lockSeed(p);
            }
        }, unlocked);
        return await run(game);
    } finally {
        await game.close();
    }
}

/** Advances until the garden has a plan: a replan lays out one candidate a second. */
async function untilPlanned(game) {
    for (let i = 0; i < 60; i++) {
        const mode = await game.eval(() => MushieCookies.garden.report().mode);
        if (mode && mode !== 'planning') return mode;
        await game.advanceSeconds(2);
    }
    throw new Error('no plan within two minutes');
}

test("seeds are bought only with cookies above the buyer's reserve", { skip }, () =>
    withGarden({}, async (game) => {
        const reserve = await game.eval(() => {
            const held = Game.cookiesPs * 3600;
            Game.cookies = held; // the bank sits exactly at the reserve
            MushieCookies.buyer.reserve = () => held;
            window.spends = { n: 0, lowest: Infinity };
            const spend = Game.Spend;
            Game.Spend = (amount) => {
                spend(amount);
                window.spends.n++;
                window.spends.lowest = Math.min(window.spends.lowest, Game.cookies - held);
            };
            FrozenCookies.autoGarden = 1;
            return held;
        });
        await game.advanceSeconds(1800);
        const out = await game.eval(() => ({ spends: window.spends, report: MushieCookies.garden.report(), failures: failures() }));
        assert.ok(out.report.planted > 0, 'once income lifts the bank above the reserve, seeds are planted');
        assert.ok(out.spends.lowest >= 0, `a seed took the bank ${(-out.spends.lowest / reserve * 100).toFixed(1)}% of the reserve below it`);
        assert.deepEqual(out.failures, []);
    }));

test("seeds take no more than the garden's share of income", { skip }, () =>
    withGarden({ unlocked: ['bakerWheat', 'thumbcorn', 'cronerice', 'gildmillet'] }, async (game) => {
        await game.eval(() => {
            window.seeds = 0;
            const spend = Game.Spend;
            Game.Spend = (amount) => {
                spend(amount);
                window.seeds += amount;
            };
            window.earnedAt = Game.cookiesEarned;
            FrozenCookies.autoGarden = 1;
        });
        await game.advanceSeconds(3600);
        const out = await game.eval(() => ({
            seeds: window.seeds,
            earned: Game.cookiesEarned - window.earnedAt,
            share: (MushieCookies.garden.options || {}).seedShare,
            planted: MushieCookies.garden.report().planted,
        }));
        assert.ok(out.planted > 0, 'the garden still plants');
        assert.ok(out.seeds <= out.share * out.earned * (1 + 1e-9), `seeds took ${((out.seeds / out.earned) * 100).toFixed(1)}% of income; the share is ${out.share}`);
    }));

test('wood chips stay on while the parents are mature', { skip }, () =>
    withGarden({}, async (game) => {
        await game.eval(() => {
            FrozenCookies.autoGarden = 1;
        });
        await game.advanceSeconds(2);
        await untilPlanned(game);
        await game.eval(() => Game.Earn(1e25)); // seed money for a whole planting
        await game.advanceSeconds(3);
        const set = await game.eval(() => {
            const M = Game.Objects['Farm'].minigame;
            for (const row of M.plot) for (const tile of row) if (tile[0] > 0) tile[1] = Math.ceil(M.plantsById[tile[0] - 1].mature);
            setSoil('woodchips');
            M.nextStep = Date.now() + M.stepT * 1000; // no garden tick, so no mutation, while this is checked
            return { plants: plotPlants(), soil: M.soil, mode: MushieCookies.garden.report().mode };
        });
        assert.ok(set.plants > 0, 'fixture: parents planted');
        assert.equal(set.mode, 'breed');
        assert.equal(set.soil, 4, 'fixture: wood chips on');
        await game.advanceSeconds(60);
        assert.equal(await game.eval(() => Game.Objects['Farm'].minigame.soil), 4);
    }));

test('on a plot too small for every locked recipe nothing is planted and the soil stays put', { skip }, () =>
    withGarden({ level: 1, farms: 120, unlocked: ALL_BUT_BIG_RINGS }, async (game) => {
        await game.eval(() => {
            setSoil('fertilizer');
            FrozenCookies.autoGarden = 1;
        });
        await game.advanceSeconds(2);
        await untilPlanned(game);
        await game.eval(() => Game.Earn(1e25)); // the bank could pay for any seed
        const soils = [];
        for (let i = 0; i < 4; i++) {
            await game.advanceSeconds(600);
            soils.push(await game.eval(() => Game.Objects['Farm'].minigame.soil));
        }
        const small = await game.eval(() => MushieCookies.garden.report());
        assert.equal(small.planted, 0, `2×2: planted ${small.planted} seeds for ${small.target}`);
        assert.equal(small.mode, 'wait');
        assert.deepEqual(soils, [1, 1, 1, 1], 'fertilizer throughout');

        await game.eval(() => {
            Game.Objects['Farm'].level = 2;
        });
        await game.advanceSeconds(2);
        await untilPlanned(game);
        await game.eval(() => Game.Earn(1e25));
        await game.advanceSeconds(1200);
        const wider = await game.eval(() => MushieCookies.garden.report());
        assert.equal(wider.planted, 0, `3×2: planted ${wider.planted} seeds for ${wider.target}`);

        // A 3×3 plot fits the everdaisy's six parents around the centre: now it is worth planting.
        await game.eval(() => {
            Game.Objects['Farm'].level = 3;
        });
        await game.advanceSeconds(2);
        await untilPlanned(game);
        await game.eval(() => Game.Earn(1e25));
        await game.advanceSeconds(5);
        const reachable = await game.eval(() => ({ report: MushieCookies.garden.report(), plants: plotPlants(), failures: failures() }));
        assert.equal(reachable.report.mode, 'breed');
        assert.ok(reachable.report.planted > 0 && reachable.plants > 0, JSON.stringify(reachable.report));
        assert.deepEqual(reachable.failures, []);
    }));

test('a mature plant with no seed yet is harvested, which unlocks its seed', { skip }, () =>
    withGarden({}, async (game) => {
        const before = await game.eval(() => {
            const M = Game.Objects['Farm'].minigame;
            const p = M.plants.thumbcorn;
            M.plot[2][2] = [p.id + 1, Math.ceil(p.mature)];
            FrozenCookies.autoGarden = 1;
            return p.unlocked;
        });
        await game.advanceSeconds(3);
        const after = await game.eval(() => {
            const M = Game.Objects['Farm'].minigame;
            return { unlocked: M.plants.thumbcorn.unlocked, report: MushieCookies.garden.report(), tile: M.plot[2][2][0] };
        });
        assert.equal(before, 0, 'fixture: thumbcorn locked');
        assert.equal(after.unlocked, 1);
        assert.equal(after.report.harvested, 1);
    }));

test('with every seed unlocked the garden is sacrificed once, for ten lumps', { skip }, () =>
    withGarden({ unlocked: 'all' }, async (game) => {
        const before = await game.eval(() => {
            FrozenCookies.autoGarden = 1;
            return Math.max(0, Game.lumpsTotal);
        });
        await game.advanceSeconds(5);
        const after = await game.eval(() => ({ lumps: Game.lumpsTotal, report: MushieCookies.garden.report() }));
        await game.advanceSeconds(600);
        const later = await game.eval(() => ({ report: MushieCookies.garden.report(), failures: failures() }));
        assert.equal(after.report.sacrifices, 1);
        assert.equal(after.lumps - before, 10);
        assert.equal(after.report.unlocked, 1, "only Baker's wheat is left");
        assert.equal(later.report.sacrifices, 1, 'and not again');
        assert.deepEqual(later.failures, []);
    }));

test('the garden stands aside while the inherited consistency combo is on', { skip }, () =>
    withGarden({}, async (game) => {
        await game.eval(() => {
            FrozenCookies.auto100ConsistencyCombo = 1; // it plants whiskerblooms of its own
            FrozenCookies.autoGarden = 1;
        });
        await game.advanceSeconds(2);
        await game.eval(() => Game.Earn(1e25));
        await game.advanceSeconds(60);
        const during = await game.eval(() => ({ report: MushieCookies.garden.report(), combo: FrozenCookies.auto100ConsistencyCombo, plants: plotPlants() }));
        assert.equal(during.combo, 1, 'fixture: the combo stays switched on');
        assert.equal(during.report.planted, 0);
        assert.equal(during.plants, 0);

        await game.eval(() => {
            FrozenCookies.auto100ConsistencyCombo = 0;
        });
        await game.advanceSeconds(2);
        await untilPlanned(game);
        await game.eval(() => Game.Earn(1e25));
        await game.advanceSeconds(5);
        assert.ok((await game.eval(() => MushieCookies.garden.report().planted)) > 0, 'and comes back once it is off');
    }));

test("the garden's work in one frame stays small, even right after a seed unlocks", { skip }, () =>
    withGarden({ unlocked: ALL_BUT_BIG_RINGS.slice(0, 23) }, async (game) => {
        const out = await game.eval(() => {
            // The harness replaces performance.now with virtual time; timing needs the real clock.
            const frame = document.createElement('iframe');
            document.body.appendChild(frame);
            const now = frame.contentWindow.performance.now.bind(frame.contentWindow.performance);
            const M = Game.Objects['Farm'].minigame;
            FrozenCookies.autoGarden = 1;
            // The mod's own loop, on frames where the garden is the only thing due: odd multiples
            // of 30 (the inherited infobox runs every 8 frames; every other system is off).
            let n = 30 * (2e6 + 1);
            const frames = (count) => {
                const times = [];
                for (let i = 0; i < count; i++) {
                    n += 60;
                    const t0 = now();
                    MushieCookies.loop.run(n);
                    times.push(now() - t0);
                }
                return times;
            };
            const first = frames(60); // also compiles the code: not what a frame costs later
            const planned = MushieCookies.garden.report();
            // Then everything the plan was built from changes at once: a seed unlocks, which
            // changes every recipe, and a mutant appears, which changes the tiles of every layout.
            M.unlockSeed(M.plants.cheapcap);
            M.plot[0][0] = [M.plants.everdaisy.id + 1, 0];
            const replan = frames(60);
            return { first, replan, planned, report: MushieCookies.garden.report() };
        });
        const show = (xs) => xs.filter((t) => t >= 1).map((t) => t.toFixed(1)).join(', ') || 'all under 1';
        assert.equal(out.planned.mode, 'breed', `fixture: a plan within a minute (first plan, ms per frame: ${show(out.first)})`);
        assert.equal(out.report.mode, 'breed', 'and again after the change');
        assert.ok(Math.max(...out.replan) < 10, `replanning, ms per frame: ${show(out.replan)}`);
    }));
