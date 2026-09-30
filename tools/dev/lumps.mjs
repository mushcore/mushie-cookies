// Measures the lump system against the inherited rules, or against doing nothing. Luck-free
// (golden cookies off), so one run per variant and seed is a fair comparison; games run one at a
// time.
//
// Usage:
//   node tools/dev/lumps.mjs harvest [seeds...]   lumps per day: the lump system, the inherited ripe
//                                                 click, and no harvest at all (lumps fall at overripe)
//   node tools/dev/lumps.mjs golden [seeds...]    a golden lump: harvested at ripe (inherited) against
//                                                 the lump system's timed harvest
//   node tools/dev/lumps.mjs frenzy [seeds...]    cookies over four game hours: no Sugar frenzy, one at
//                                                 the start, one in the last hour (where the system aims)
//   node tools/dev/lumps.mjs hold                 a save with Sugar baking and 100 lumps: the inherited
//                                                 spending order against the hold
//   node tools/dev/lumps.mjs run <hours> [seed] [--prestige=1e6,3e6]
//                                                 Sugar frenzy off, by the lump system's rule, and at the
//                                                 start of the run, through the rate rule's ascension,
//                                                 from a high-prestige start
//   golden and frenzy take --earn=N, the cookies the fixture bakery is built from.
import { launchWithMod } from '../../test/harness/game.mjs';

const [mode = 'harvest', ...args] = process.argv.slice(2);
const rest = args.filter((a) => !a.startsWith('--'));
// --earn=N: the cookies the fixture bakery is built from (golden, frenzy). Luck-free runs of one
// bakery come out the same on every seed, so the spread worth reporting is across bakeries.
const earnArg = args.find((a) => a.startsWith('--earn='));
const EARN = earnArg ? Number(earnArg.split('=')[1]) : 1e16;
const DEFAULT_SEEDS = ['lumps-a', 'lumps-b', 'lumps-c'];

const fmt = (n) => (Number.isFinite(n) ? (Math.abs(n) >= 1e5 || (Math.abs(n) < 1e-2 && n !== 0) ? n.toExponential(3) : n.toFixed(3)) : String(n));
const spread = (xs) => {
    const sorted = xs.slice().sort((a, b) => a - b);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    return { mean, min: sorted[0], max: sorted[sorted.length - 1], n: xs.length };
};
const describe = (s) => `${fmt(s.mean)} (range ${fmt(s.min)} to ${fmt(s.max)}, n=${s.n})`;

async function withGame(seed, run) {
    const game = await launchWithMod({ seed });
    if (!game) throw new Error('game location not configured');
    try {
        return await run(game);
    } finally {
        await game.close();
    }
}

// In the page: counts harvests and records what each paid, without changing what they do.
function instrumentHarvests() {
    window.__harvests = [];
    const harvest = Game.harvestLumps;
    Game.harvestLumps = function (amount, silent) {
        const before = { lumps: Game.lumps, cookies: Game.cookies, age: Date.now() - Game.lumpT, type: Game.lumpCurrentType };
        const out = harvest.call(this, amount, silent);
        window.__harvests.push({
            at: Date.now(),
            type: before.type,
            gained: Game.lumps - before.lumps,
            payout: Game.cookies - before.cookies,
            cps: Game.unbuffedCps,
            secondsAfterRipe: (before.age - Game.lumpRipeAge) / 1000,
        });
        return out;
    };
}

// In the page: the inherited rule, as autoCookieBody ran it every 100 ms (fc_main.js before this
// change): click once the lump is ripe, whatever its type.
function inheritedHarvest() {
    setInterval(() => {
        if (Date.now() - Game.lumpT >= Math.ceil(Game.lumpRipeAge)) Game.clickLump();
    }, 100);
}

// --- harvest ----------------------------------------------------------------------------------
// Lump times divided by 2000 (Glucose-charged air, a test fixture) make a game hour hold about 85
// lump cycles. A click's lag after ripe comes from tick timing, the same number of real seconds at
// either scale; a lump left to fall waits the scaled hour to overripe, which is a real hour. So
// harvests per real day follow as 86400 / (23 h + real lag). The type of each lump is drawn from
// the harvest's millisecond (main.js:4524), so yield per harvest is luck, the same in expectation
// for every rule: lumps per day use the yield pooled over every run.
async function harvest(seeds) {
    const variants = ['system', 'inherited', 'none'];
    const rows = [];
    for (const seed of seeds) {
        for (const variant of variants) {
            const row = await withGame(seed, async (game) => {
                await game.eval((v) => {
                    Game.shimmerTypes.golden.spawnConditions = () => false;
                    Game.lumpsTotal = 0;
                    Game.lumps = 0;
                    Game.Upgrades['Glucose-charged air'].earn();
                    Game.computeLumpTimes();
                    Game.lumpT = Date.now();
                    Game.computeLumpType();
                    FrozenCookies.autoSL = v === 'system' ? 1 : 0;
                }, variant);
                await game.eval(instrumentHarvests);
                if (variant === 'inherited') await game.eval(inheritedHarvest);
                await game.advanceSeconds(3600);
                return game.eval(() => ({ harvests: window.__harvests, ripe: Game.lumpRipeAge / 1000, overripe: Game.lumpOverripeAge / 1000 }));
            });
            const h = row.harvests;
            const fallWindow = row.overripe - row.ripe; // compressed seconds from ripe to falling
            // Real seconds after ripe: a fall waited the (real) hour; a click lagged by tick timing.
            const realLag = (x) => (x.secondsAfterRipe >= fallWindow - 0.1 ? 3600 + (x.secondsAfterRipe - fallWindow) : x.secondsAfterRipe);
            const lag = h.reduce((s, x) => s + realLag(x), 0) / h.length;
            const fell = h.filter((x) => x.secondsAfterRipe >= fallWindow - 0.1).length;
            const lumps = h.reduce((s, x) => s + x.gained, 0);
            const perDay = 86400 / (82800 + lag);
            rows.push({ seed, variant, harvests: h.length, fell, lagSeconds: lag, lumps, harvestsPerDay: perDay });
            process.stderr.write(`${seed} ${variant}: ${h.length} harvests (${fell} fell), ${fmt(lag)} real s after ripe, ${fmt(lumps / h.length)} lumps each -> ${fmt(perDay)} harvests a real day\n`);
        }
    }
    const pooledYield = rows.reduce((s, r) => s + r.lumps, 0) / rows.reduce((s, r) => s + r.harvests, 0);
    const summary = { pooledYieldPerHarvest: pooledYield };
    for (const v of variants) {
        const mine = rows.filter((r) => r.variant === v);
        summary[v] = {
            lagSeconds: spread(mine.map((r) => r.lagSeconds)),
            harvestsPerDay: spread(mine.map((r) => r.harvestsPerDay)),
            lumpsPerDay: spread(mine.map((r) => r.harvestsPerDay * pooledYield)),
            observedYieldPerHarvest: spread(mine.map((r) => r.lumps / r.harvests)),
        };
        process.stderr.write(`${v}: ${describe(summary[v].harvestsPerDay)} harvests a day, ${describe(summary[v].lumpsPerDay)} lumps a day at the pooled ${fmt(pooledYield)} per harvest\n`);
    }
    return { mode: 'harvest', rows, summary };
}

// --- a bakery some way into a run -----------------------------------------------------------
// Test fixture: every building bought while a large bank lasts, the store's upgrades with it,
// then an empty bank, so the buyer's next purchases take a while to repay.
function bakery({ earn, levels = 0, sugarCraving = false }) {
    Game.shimmerTypes.golden.spawnConditions = () => false;
    Game.Earn(earn);
    for (let pass = 0; pass < 4; pass++) {
        for (const b of Game.ObjectsById) {
            let n = 0;
            while (n < 50 && Game.cookies >= b.getPrice()) {
                b.buy(1);
                n++;
            }
        }
        Game.RebuildUpgrades();
        for (const u of Game.UpgradesInStore.slice()) if (['', 'cookie'].includes(u.pool) && !MushieCookies.NEVER_BUY.has(u.id) && Game.cookies >= u.getPrice()) u.buy(1);
    }
    if (levels) for (const b of Game.ObjectsById) b.level = levels;
    if (sugarCraving) for (const name of ['Stevia Caelestis', 'Sugar baking', 'Sugar craving']) Game.Upgrades[name].earn();
    Game.lumpsTotal = 150;
    Game.lumps = 150;
    Game.cookies = 0;
    Game.CalculateGains();
    Object.assign(FrozenCookies, { autoBuy: 1, autoClick: 1, cookieClickSpeed: 50, autoLumps: 0, sugarFrenzy: 0, autoSL: 0 });
    FCStart();
}

// --- golden -----------------------------------------------------------------------------------
async function golden(seeds) {
    const variants = ['inherited', 'system'];
    const rows = [];
    for (const seed of seeds) {
        for (const variant of variants) {
            const row = await withGame(seed, async (game) => {
                await game.eval(bakery, { earn: EARN });
                await game.eval(instrumentHarvests);
                await game.eval((v) => {
                    Game.computeLumpTimes();
                    Game.lumpCurrentType = 2; // fixture: the previous harvest rolled a golden lump
                    Game.lumpT = Date.now() - Game.lumpRipeAge + 90 * 60 * 1000; // ripe in 90 minutes
                    FrozenCookies.autoSL = v === 'system' ? 1 : 0;
                    window.__start = { earned: Game.cookiesEarned, cps: Game.unbuffedCps };
                }, variant);
                if (variant === 'inherited') await game.eval(inheritedHarvest);
                await game.advanceSeconds(3.5 * 3600);
                return game.eval(() => {
                    const h = window.__harvests.find((x) => x.type === 2);
                    return {
                        payoutSeconds: h ? h.payout / h.cps : null,
                        payout: h ? h.payout : null,
                        secondsAfterRipe: h ? h.secondsAfterRipe : null,
                        earned: Game.cookiesEarned - window.__start.earned,
                        cpsEnd: Game.unbuffedCps,
                        cpsStart: window.__start.cps,
                    };
                });
            });
            rows.push({ seed, variant, ...row });
            process.stderr.write(
                `${seed} ${variant}: harvested ${fmt(row.secondsAfterRipe)} s after ripe, paid ${fmt(row.payoutSeconds)} s of CpS; ` +
                    `earned ${fmt(row.earned)} in 3.5 h, CpS ${fmt(row.cpsStart)} -> ${fmt(row.cpsEnd)}\n`
            );
        }
    }
    const pairs = seeds.map((seed) => {
        const a = rows.find((r) => r.seed === seed && r.variant === 'inherited');
        const b = rows.find((r) => r.seed === seed && r.variant === 'system');
        return { seed, payoutRatio: b.payout / a.payout, earnedRatio: b.earned / a.earned, cpsRatio: b.cpsEnd / a.cpsEnd, payoutSecondsGain: b.payoutSeconds - a.payoutSeconds };
    });
    const summary = {
        payoutRatio: spread(pairs.map((p) => p.payoutRatio)),
        earnedRatio: spread(pairs.map((p) => p.earnedRatio)),
        cpsRatio: spread(pairs.map((p) => p.cpsRatio)),
        payoutSecondsGain: spread(pairs.map((p) => p.payoutSecondsGain)),
    };
    process.stderr.write(`system/inherited: payout ${describe(summary.payoutRatio)}; cookies earned ${describe(summary.earnedRatio)}; end CpS ${describe(summary.cpsRatio)}\n`);
    return { mode: 'golden', earn: EARN, rows, pairs, summary };
}

// --- frenzy -----------------------------------------------------------------------------------
async function frenzy(seeds) {
    const HOURS = 4;
    const variants = ['none', 'start', 'end'];
    const rows = [];
    const switchOn = () => {
        const ask = Game.prefs.askLumps;
        Game.prefs.askLumps = 0;
        Game.Upgrades['Sugar frenzy'].buy(); // as a player clicks the switch
        Game.prefs.askLumps = ask;
        return Game.Upgrades['Sugar frenzy'].bought;
    };
    for (const seed of seeds) {
        for (const variant of variants) {
            const row = await withGame(seed, async (game) => {
                await game.eval(bakery, { earn: EARN, levels: 10, sugarCraving: true });
                await game.advanceSeconds(2); // the game unlocks Sugar frenzy on its next check
                await game.eval(() => { window.__start = { earned: Game.cookiesEarned, cps: Game.unbuffedCps }; });
                let used = 0;
                if (variant === 'start') used = await game.eval(switchOn);
                await game.advanceSeconds((HOURS - 1) * 3600);
                if (variant === 'end') used = await game.eval(switchOn);
                await game.advanceSeconds(3600);
                const out = await game.eval(() => ({ earned: Game.cookiesEarned - window.__start.earned, cpsEnd: Game.unbuffedCps, cpsStart: window.__start.cps }));
                return { ...out, used };
            });
            rows.push({ seed, variant, ...row });
            process.stderr.write(`${seed} ${variant}: frenzy ${row.used ? 'on' : 'off'}, earned ${fmt(row.earned)} in ${HOURS} h, CpS ${fmt(row.cpsStart)} -> ${fmt(row.cpsEnd)}\n`);
        }
    }
    const ratio = (variant) =>
        seeds.map((seed) => rows.find((r) => r.seed === seed && r.variant === variant).earned / rows.find((r) => r.seed === seed && r.variant === 'none').earned);
    const hoursOfEndCps = (variant) =>
        seeds.map((seed) => {
            const none = rows.find((r) => r.seed === seed && r.variant === 'none');
            const v = rows.find((r) => r.seed === seed && r.variant === variant);
            return (v.earned - none.earned) / none.cpsEnd / 3600;
        });
    const summary = {
        startOverNone: spread(ratio('start')),
        endOverNone: spread(ratio('end')),
        startGainHoursOfEndCps: spread(hoursOfEndCps('start')),
        endGainHoursOfEndCps: spread(hoursOfEndCps('end')),
    };
    process.stderr.write(
        `cookies over ${HOURS} h against no frenzy: at the start ${describe(summary.startOverNone)}, in the last hour ${describe(summary.endOverNone)}\n` +
            `gain in hours of the no-frenzy run's final CpS: start ${describe(summary.startGainHoursOfEndCps)}, end ${describe(summary.endGainHoursOfEndCps)}\n`
    );
    return { mode: 'frenzy', earn: EARN, hours: HOURS, rows, summary };
}

// --- hold -------------------------------------------------------------------------------------
async function hold() {
    const rows = [];
    for (const variant of ['inherited', 'system']) {
        const row = await withGame('lumps-hold', async (game) => {
            await game.eval(() => {
                Game.shimmerTypes.golden.spawnConditions = () => false;
                Game.Earn(1e12);
                for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(20);
                for (const name of ['Wizard tower', 'Temple', 'Farm', 'Bank']) Game.Objects[name].level = 1;
                Game.Upgrades['Sugar baking'].earn();
                Game.lumpsTotal = 100;
                Game.lumps = 100;
                Game.CalculateGains();
                window.__cpsBefore = Game.unbuffedCps;
            });
            if (variant === 'system') await game.eval(() => { FrozenCookies.autoLumps = 1; });
            else {
                // The inherited order: the targets were spent before the hold was checked, which is
                // what the guard-only case still does.
                await game.eval(() => {
                    setInterval(() => {
                        const total = Game.ObjectsById.reduce((s, b) => s + (b.storedTotalCps || 0), 0);
                        const buildings = Game.ObjectsById.map((b) => ({ name: b.name, level: b.level, amount: b.amount, share: total ? b.storedTotalCps / total : 0 }));
                        const c = MushieCookies.nextLevelUp({ buildings, lumps: Game.lumps, sugarBaking: false, guard: true });
                        if (!c) return;
                        const ask = Game.prefs.askLumps;
                        Game.prefs.askLumps = 0;
                        Game.Objects[c.name].levelUp();
                        Game.prefs.askLumps = ask;
                    }, 1000);
                });
            }
            await game.advanceSeconds(120);
            return game.eval(() => ({ lumps: Game.lumps, cpsRatio: Game.unbuffedCps / window.__cpsBefore, farm: Game.Objects.Farm.level, cursor: Game.Objects.Cursor.level }));
        });
        rows.push({ variant, ...row });
        process.stderr.write(`${variant}: ${row.lumps} lumps left, Farm ${row.farm}, Cursor ${row.cursor}, CpS x${fmt(row.cpsRatio)} of before\n`);
    }
    return { mode: 'hold', rows };
}

// --- run ----------------------------------------------------------------------------------------
// From just after an ascension at a high prestige (test fixture: the chips' bonus makes a run
// reach the rate rule in game hours rather than days), play with buying, clicking, lumps and the
// ascension on until the rule's ascension completes: Sugar frenzy off, switched on by the lump
// system's rule, or switched on as soon as it is offered (the start of the run). The ascension's
// own objective is the log-prestige gained per second of run plus overhead (core/ascension.js).
// Luck-free runs from one start come out the same on every seed; the spread is across starting
// prestiges (--prestige=1e6,3e6).
async function run(hours, seed, prestiges) {
    const rows = [];
    const variants = ['off', 'rule', 'start'];
    for (const p0 of prestiges) {
        for (const variant of variants) {
            const row = await withGame(seed, async (game) => {
                await game.eval(({ p, on }) => {
                    Game.shimmerTypes.golden.spawnConditions = () => false;
                    Game.cookiesReset = Game.HowManyCookiesReset(p);
                    Game.prestige = p;
                    Game.heavenlyChips = 0;
                    Game.resets = 1;
                    const owned = ['Legacy', 'Heavenly cookies', 'How to bake your dragon', 'Box of brand biscuits', 'Heavenly luck', 'Permanent upgrade slot I', 'Twin Gates of Transcendence', 'Belphegor', 'Stevia Caelestis', 'Sugar baking', 'Sugar craving'];
                    for (const name of owned) Game.Upgrades[name].earn();
                    Game.lumpsTotal = 150;
                    Game.lumps = 150;
                    for (const b of Game.ObjectsById) b.level = 10;
                    Game.CalculateGains();
                    Object.assign(FrozenCookies, { autoBuy: 1, autoAscendToggle: 1, autoSL: 1, autoLumps: 1, sugarFrenzy: on, autoClick: 1, cookieClickSpeed: 50 });
                    FCStart();
                    window.__run = { p0: p, start: Game.startDate, frenzyAt: null, ascendedAt: null, prestigeAfter: null, reason: null };
                }, { p: p0, on: variant === 'rule' ? 1 : 0 });
                if (variant === 'start') {
                    await game.advanceSeconds(2); // the game offers Sugar frenzy on its next check
                    await game.eval(() => {
                        const ask = Game.prefs.askLumps;
                        Game.prefs.askLumps = 0;
                        Game.Upgrades['Sugar frenzy'].buy(); // as a player clicks the switch
                        Game.prefs.askLumps = ask;
                        if (Game.Upgrades['Sugar frenzy'].bought) window.__run.frenzyAt = Date.now();
                    });
                }
                for (let q = 1; q <= hours * 4; q++) {
                    await game.advanceSeconds(900);
                    const done = await game.eval(() => {
                        const r = MushieCookies.lumps.report();
                        if (r.frenzyAt && !window.__run.frenzyAt) window.__run.frenzyAt = r.frenzyAt;
                        const asc = MushieCookies.ascension.report();
                        if (Game.resets >= 2 && !window.__run.ascendedAt && asc.last) {
                            window.__run.ascendedAt = asc.last.at;
                            window.__run.prestigeAfter = asc.last.prestige;
                        }
                        if (!window.__run.ascendedAt) window.__run.reason = asc.verdict && asc.verdict.reason;
                        window.__run.projected = asc.projected;
                        return !!window.__run.ascendedAt;
                    });
                    if (done) break;
                }
                return game.eval(() => window.__run);
            });
            const u = (p) => Math.log(1 + p);
            const runSeconds = row.ascendedAt ? (row.ascendedAt - row.start) / 1000 : null;
            const out = {
                seed,
                p0,
                variant,
                ascended: !!row.ascendedAt,
                runHours: runSeconds && runSeconds / 3600,
                frenzyHoursIn: row.frenzyAt ? (row.frenzyAt - row.start) / 3600000 : null,
                frenzyHoursBeforeAscension: row.frenzyAt && row.ascendedAt ? (row.ascendedAt - row.frenzyAt) / 3600000 : null,
                prestigeGained: row.ascendedAt ? row.prestigeAfter - row.p0 : Math.floor(row.projected) - row.p0,
                // The ascension's own currency: log-prestige per second of run, with its 300 s overhead.
                yieldPerSecond: runSeconds ? (u(row.prestigeAfter) - u(row.p0)) / (runSeconds + 300) : null,
                lastVerdict: row.reason,
            };
            rows.push(out);
            process.stderr.write(`p0=${p0} ${variant}: ${JSON.stringify(out)}\n`);
        }
    }
    const summary = {};
    for (const variant of ['rule', 'start']) {
        const ratios = prestiges
            .map((p0) => {
                const off = rows.find((r) => r.p0 === p0 && r.variant === 'off');
                const v = rows.find((r) => r.p0 === p0 && r.variant === variant);
                return off.yieldPerSecond && v.yieldPerSecond ? { y: v.yieldPerSecond / off.yieldPerSecond, p: v.prestigeGained / off.prestigeGained } : null;
            })
            .filter(Boolean);
        if (!ratios.length) continue;
        summary[variant] = { yieldRatio: spread(ratios.map((r) => r.y)), prestigeRatio: spread(ratios.map((r) => r.p)) };
        process.stderr.write(`${variant} against off: yield per second ${describe(summary[variant].yieldRatio)}; prestige per run ${describe(summary[variant].prestigeRatio)}\n`);
    }
    return { mode: 'run', hours, seed, prestiges, rows, summary };
}

const seedsFrom = (args) => (args.length ? args : DEFAULT_SEEDS);
let result;
if (mode === 'harvest') result = await harvest(seedsFrom(rest));
else if (mode === 'golden') result = await golden(seedsFrom(rest).slice(0, rest.length || 2));
else if (mode === 'frenzy') result = await frenzy(seedsFrom(rest).slice(0, rest.length || 2));
else if (mode === 'hold') result = await hold();
else if (mode === 'run') {
    const prestigeArg = args.find((a) => a.startsWith('--prestige='));
    const prestiges = prestigeArg ? prestigeArg.split('=')[1].split(',').map(Number) : [1e6];
    result = await run(Number(rest[0] || 24), rest[1] || DEFAULT_SEEDS[0], prestiges);
}
else {
    console.error(`unknown mode ${mode}`);
    process.exit(1);
}
console.log(JSON.stringify(result, null, 1));
