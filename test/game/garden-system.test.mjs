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

/**
 * Follows every seed the garden plants until it is gone, and counts the cookies spent on seeds
 * that were never mature while the plot could produce the garden's target: a mutation of the
 * target has a chance in some empty tile, from the mature plants around it
 * (minigameGarden.js:1930-1967). Checked every second, against garden ticks of minutes.
 */
function trackWaste() {
    const M = Game.Objects['Farm'].minigame;
    const seeds = new Map(); // "x,y" -> { id, cost, useful }
    window.waste = { spent: 0, wasted: 0, seeds: 0, lost: 0, usefulTicks: 0 };
    const use = M.useTool;
    M.useTool = function (what, x, y) {
        const before = Game.cookies;
        const ok = use.apply(this, arguments);
        if (ok) {
            seeds.set(x + ',' + y, { id: what, cost: before - Game.cookies, useful: false });
            window.waste.spent += before - Game.cookies;
            window.waste.seeds++;
        }
        return ok;
    };
    const producing = (target) => {
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6; x++) {
                if (!M.isTileUnlocked(x, y) || M.plot[y][x][0] > 0) continue;
                const neighs = {};
                const neighsM = {};
                for (const key of Object.keys(M.plants)) neighs[key] = neighsM[key] = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const tile = (dx || dy) && M.getTile(x + dx, y + dy);
                        if (!tile || !(tile[0] > 0)) continue;
                        const plant = M.plantsById[tile[0] - 1];
                        neighs[plant.key]++;
                        if (tile[1] >= plant.mature) neighsM[plant.key]++;
                    }
                }
                if (M.getMuts(neighs, neighsM).some(([key, chance]) => key === target && chance > 0)) return true;
            }
        }
        return false;
    };
    let frames = 0;
    Game.registerHook('logic', () => {
        if (++frames % 30) return;
        const target = MushieCookies.garden.report().target;
        const useful = !!target && producing(target);
        if (useful) window.waste.usefulTicks++;
        for (const [at, seed] of seeds) {
            const [x, y] = at.split(',').map(Number);
            const tile = M.plot[y][x];
            if (tile[0] !== seed.id + 1) {
                // Gone: died of old age, or harvested.
                if (!seed.useful) {
                    window.waste.wasted += seed.cost;
                    window.waste.lost++;
                }
                seeds.delete(at);
            } else if (useful && tile[1] >= M.plantsById[seed.id].mature) seed.useful = true;
        }
    });
}

// Ten game hours: about five minutes of wall time on its own.
test('seeds are bought only for a layout that can be mature together', { skip, timeout: 20 * 60 * 1000 }, () =>
    // From these seeds only gildmillet can be bred, from cronerice and thumbcorn. Seed prices are
    // minutes of CpS and the budget a tenth of income, so a cronerice takes two and a half hours to
    // afford and lives under seven (minigameGarden.js:51-62, 1097-1101). Bought one seed at a time,
    // the cronerice died before the layout filled, and the thumbcorn, held back until every
    // cronerice slot was planted, never was: cookies spent, nothing produced.
    withGarden({ unlocked: ['bakerWheat', 'thumbcorn', 'cronerice', 'bakeberry', 'meddleweed'] }, async (game) => {
        await game.eval(() => {
            Game.shimmerTypes.golden.spawnConditions = () => false;
            FrozenCookies.autoGarden = 1;
        });
        await game.eval(trackWaste);
        await game.advanceSeconds(10 * 3600);
        const out = await game.eval(() => ({ waste: window.waste, cps: Game.cookiesPs, report: MushieCookies.garden.report(), failures: failures() }));
        const minutes = (cookies) => (cookies / out.cps / 60).toFixed(1);
        assert.equal(
            out.waste.wasted,
            0,
            `${out.waste.lost} of ${out.waste.seeds} seeds died unproductive, ${minutes(out.waste.wasted)} of ${minutes(out.waste.spent)} minutes of CpS spent (${JSON.stringify(out.report)})`
        );
        assert.deepEqual(out.failures, []);
    }));

test('a layout the pot covers is planted and produces', { skip }, () =>
    withGarden({ unlocked: ['bakerWheat', 'thumbcorn'] }, async (game) => {
        await game.eval(() => {
            Game.shimmerTypes.golden.spawnConditions = () => false;
            FrozenCookies.autoGarden = 1;
        });
        await game.eval(trackWaste);
        await game.advanceSeconds(2);
        await untilPlanned(game);
        await game.eval(() => Game.Earn(1e25)); // seed money for a whole planting
        await game.advanceSeconds(3600);
        const out = await game.eval(() => ({ waste: window.waste, report: MushieCookies.garden.report(), failures: failures() }));
        assert.ok(out.waste.seeds > 0, 'planted');
        assert.ok(out.waste.usefulTicks > 0, `the layout produced: ${JSON.stringify(out)}`);
        assert.deepEqual(out.failures, []);
    }));

test("seeds are bought only with cookies above the buyer's reserve", { skip }, () =>
    withGarden({}, async (game) => {
        await game.eval(() => {
            FrozenCookies.autoGarden = 1;
        });
        await game.advanceSeconds(2);
        await untilPlanned(game);
        const reserve = await game.eval(() => {
            const held = Game.cookiesPs * 3600;
            // Set on the buyer: the garden reads it through the bridge (src/game/bridge.js).
            MushieCookies.buyer.reserve = () => held;
            window.spends = { n: 0, lowest: Infinity };
            const spend = Game.Spend;
            Game.Spend = (amount) => {
                spend(amount);
                window.spends.n++;
                window.spends.lowest = Math.min(window.spends.lowest, Game.cookies - held);
            };
            // Income fills the pot while the bank is held at the reserve: only the reserve can
            // stop the garden. Each frame's CpS lands before the next pin, a thirtieth of a
            // second of it, far less than a seed.
            window.pinned = true;
            Game.registerHook('logic', () => {
                if (!window.pinned) return;
                Game.cookies = held;
                Game.cookiesEarned += held;
            });
            return held;
        });
        await game.advanceSeconds(120);
        const held = await game.eval(() => {
            const M = Game.Objects['Farm'].minigame;
            return { spends: window.spends, report: MushieCookies.garden.report(), seed: M.getCost(M.plants.bakerWheat), plants: plotPlants() };
        });
        assert.ok(held.report.budget >= held.seed, `fixture: the pot holds ${held.report.budget}, a seed costs ${held.seed}`);
        assert.equal(held.spends.n, 0, `planted ${held.plants}, taking the bank ${(-held.spends.lowest / reserve * 100).toFixed(1)}% of the reserve below it`);
        assert.equal(held.plants, 0);

        // With an hour of CpS above the reserve, seeds are planted, and never below it.
        await game.eval((reserve) => {
            window.pinned = false;
            Game.cookies = 2 * reserve;
        }, reserve);
        await game.advanceSeconds(60);
        const out = await game.eval(() => ({ spends: window.spends, report: MushieCookies.garden.report(), failures: failures() }));
        assert.ok(out.report.planted > 0, 'once the bank is above the reserve, seeds are planted');
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
            // Ten times CpS in income, as clicking earns: a tenth of an hour of CpS alone pays
            // for no whole layout, and a layout is planted only whole.
            Game.registerHook('logic', () => Game.Earn((9 * Game.cookiesPs) / Game.fps));
            FrozenCookies.autoGarden = 1;
        });
        await game.advanceSeconds(3600);
        const out = await game.eval(() => ({
            seeds: window.seeds,
            earned: Game.cookiesEarned - window.earnedAt,
            // A build from before the budget has no options: the share it is held to is the
            // budget's, so its spending is measured against that rather than failing to read it.
            share: MushieCookies.garden.options ? MushieCookies.garden.options.seedShare : 0.1,
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
        // A plan first, and seed money that registers as income after it (the pot holds at most
        // one planting of the plan, none before there is one): nothing but the stand-aside is
        // left to stop the planting.
        await game.eval(() => {
            FrozenCookies.autoGarden = 1;
        });
        await game.advanceSeconds(2);
        await untilPlanned(game);
        await game.eval(() => {
            FrozenCookies.auto100ConsistencyCombo = 1; // it plants whiskerblooms of its own
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

test('a seed unlocked while the garden is planning is in the plan that follows', { skip }, () =>
    // From these seeds only gildmillet can be bred, which takes most of a day of seed money. White
    // mildew breeds brown mold, one parent for eight tiles at 50% (minigameGarden.js:657).
    withGarden({ unlocked: ['bakerWheat', 'thumbcorn', 'cronerice', 'bakeberry', 'meddleweed'] }, async (game) => {
        await game.eval(() => {
            Game.shimmerTypes.golden.spawnConditions = () => false;
            FrozenCookies.autoGarden = 1;
            // Every target the garden holds, frame by frame: a plan is tended from the tick it
            // is adopted.
            window.targets = [];
            Game.registerHook('logic', () => {
                const target = MushieCookies.garden.report().target;
                if (target && !window.targets.includes(target)) window.targets.push(target);
            });
        });
        let mode = null;
        for (let frame = 0; frame < 120 && mode !== 'planning'; frame++) {
            await game.advance(1);
            mode = await game.eval(() => MushieCookies.garden.report().mode);
        }
        assert.equal(mode, 'planning', 'fixture: the recipes have been read');
        // Before the next garden tick: the plan is still being laid out.
        await game.eval(() => {
            const M = Game.Objects['Farm'].minigame;
            M.unlockSeed(M.plants.whiteMildew);
        });
        await game.advanceSeconds(2);
        await untilPlanned(game);
        await game.advanceSeconds(10);
        await untilPlanned(game);
        const out = await game.eval(() => ({ report: MushieCookies.garden.report(), targets: window.targets, failures: failures() }));
        assert.equal(out.report.target, 'brownMold', JSON.stringify(out.report));
        assert.deepEqual(out.targets, ['brownMold'], 'no plan laid out without the new seed was ever adopted');
        assert.deepEqual(out.failures, []);
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
