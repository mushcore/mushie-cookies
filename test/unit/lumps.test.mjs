import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    nextLevelUp,
    bestLevel,
    lumpWorth,
    frenzyValue,
    decideFrenzy,
    decideHarvest,
    cpsBuffChance,
    GOLDEN,
    LEVEL_HORIZON_SECONDS,
    HARVEST_SAFETY_MS,
} from '../../src/core/lumps.js';

const building = (name, over = {}) => ({ name, level: 0, amount: 10, share: 0.05, ...over });
const bakery = (over = {}) =>
    ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower'].map((name) => building(name, over[name] || {}));

test('minigames are unlocked first, in order, and only for buildings that are owned', () => {
    assert.equal(nextLevelUp({ buildings: bakery(), lumps: 1, sugarBaking: false }).name, 'Wizard tower');
    const noTowers = bakery({ 'Wizard tower': { amount: 0 } });
    assert.equal(nextLevelUp({ buildings: noTowers, lumps: 1, sugarBaking: false }).name, 'Temple');
});

test('then the Farm to 9 and the Cursor to 12', () => {
    const minigamesDone = { 'Wizard tower': { level: 1 }, Temple: { level: 1 }, Farm: { level: 1 }, Bank: { level: 1 } };
    const out = nextLevelUp({ buildings: bakery(minigamesDone), lumps: 5, sugarBaking: false });
    assert.deepEqual([out.name, out.cost], ['Farm', 2]);
    const farmDone = { ...minigamesDone, Farm: { level: 9 } };
    const cursor = nextLevelUp({ buildings: bakery(farmDone), lumps: 5, sugarBaking: false });
    assert.deepEqual([cursor.name, cursor.cost], ['Cursor', 1]);
});

test('a level it cannot afford yet is waited for, not skipped', () => {
    const state = { 'Wizard tower': { level: 1 }, Temple: { level: 1 }, Farm: { level: 5 }, Bank: { level: 1 } };
    assert.equal(nextLevelUp({ buildings: bakery(state), lumps: 5, sugarBaking: false }), null, 'Farm 6 costs 6');
});

test('after the targets, the building with the best CpS gain per lump', () => {
    const done = {
        'Wizard tower': { level: 1 }, Temple: { level: 1 }, Farm: { level: 9 }, Bank: { level: 1 }, Cursor: { level: 12 },
        Grandma: { share: 0.4 }, Mine: { share: 0.2, level: 0 },
    };
    const out = nextLevelUp({ buildings: bakery(done), lumps: 10, sugarBaking: false });
    assert.equal(out.name, 'Grandma');
    // A level-3 Grandma costs 4 lumps: 0.4/4 = 0.1 per lump, against the Mine's 0.2/1.
    const later = nextLevelUp({ buildings: bakery({ ...done, Grandma: { share: 0.4, level: 3 } }), lumps: 10, sugarBaking: false });
    assert.equal(later.name, 'Mine');
});

test('with Sugar baking, a hundred lumps are held and only the excess is spent', () => {
    const done = { 'Wizard tower': { level: 1 }, Temple: { level: 1 }, Farm: { level: 9 }, Bank: { level: 1 }, Cursor: { level: 12 } };
    assert.equal(nextLevelUp({ buildings: bakery(done), lumps: 100, sugarBaking: true }), null);
    assert.ok(nextLevelUp({ buildings: bakery(done), lumps: 101, sugarBaking: true }));
    assert.ok(nextLevelUp({ buildings: bakery(done), lumps: 2, sugarBaking: false }), 'without Sugar baking nothing is held');
});

test('the guard alone holds a jar for Sugar baking but lets the community targets go first', () => {
    const minigamesDone = { 'Wizard tower': { level: 1 }, Temple: { level: 1 }, Farm: { level: 1 }, Bank: { level: 1 } };
    const out = nextLevelUp({ buildings: bakery(minigamesDone), lumps: 50, sugarBaking: false, guard: true });
    assert.equal(out.name, 'Farm');
    const done = { ...minigamesDone, Farm: { level: 9 }, Cursor: { level: 12 } };
    assert.equal(nextLevelUp({ buildings: bakery(done), lumps: 100, sugarBaking: false, guard: true }), null);
    assert.ok(nextLevelUp({ buildings: bakery(done), lumps: 101, sugarBaking: false, guard: true }));
});

test('once Sugar baking is owned, the Farm and Cursor targets respect the hold too', () => {
    // Defect: with Sugar baking owned the targets spent up to 44 + 78 lumps below 100, each lump
    // costing 1/(100 + L) of all CpS until it grew back (main.js:5095).
    const minigamesDone = { 'Wizard tower': { level: 1 }, Temple: { level: 1 }, Farm: { level: 1 }, Bank: { level: 1 } };
    assert.equal(nextLevelUp({ buildings: bakery(minigamesDone), lumps: 100, sugarBaking: true }), null, 'Farm 2 would leave 98');
    assert.equal(nextLevelUp({ buildings: bakery(minigamesDone), lumps: 101, sugarBaking: true }), null, 'Farm 2 costs 2: 99 left');
    assert.deepEqual(
        (({ name, cost }) => ({ name, cost }))(nextLevelUp({ buildings: bakery(minigamesDone), lumps: 102, sugarBaking: true })),
        { name: 'Farm', cost: 2 }
    );
    const farmDone = { ...minigamesDone, Farm: { level: 9 } };
    assert.equal(nextLevelUp({ buildings: bakery(farmDone), lumps: 100, sugarBaking: true }), null, 'Cursor 1 would leave 99');
    assert.equal(nextLevelUp({ buildings: bakery(farmDone), lumps: 101, sugarBaking: true }).name, 'Cursor');
});

test('the minigame unlocks go first, and once Sugar baking is owned they too wait for the excess', () => {
    // Spec 4.8: minigame and Farm/Cursor targets respect the hold. A save that owns Sugar baking
    // (200 million chips in) without every minigame is all but unreachable, so the wait is moot.
    assert.equal(nextLevelUp({ buildings: bakery(), lumps: 1, sugarBaking: false, guard: true }).name, 'Wizard tower');
    assert.equal(nextLevelUp({ buildings: bakery(), lumps: 100, sugarBaking: true }), null);
    assert.equal(nextLevelUp({ buildings: bakery(), lumps: 101, sugarBaking: true }).name, 'Wizard tower');
});

test('nothing owned, nothing to level', () => {
    const empty = bakery(Object.fromEntries(['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower'].map((n) => [n, { amount: 0 }])));
    assert.equal(nextLevelUp({ buildings: empty, lumps: 500, sugarBaking: false }), null);
    assert.equal(bestLevel(empty), null);
});

// --- Harvest -------------------------------------------------------------------------------

const HOUR = 3600 * 1000;
const DAY = 86400;
// Lump times with no upgrades: mature at 20 h, ripe at 23 h, falls at 24 h (main.js:4412-4430).
const times = { matureAge: 20 * HOUR, ripeAge: 23 * HOUR, overripeAge: 24 * HOUR };
const lastSafe = times.overripeAge - HARVEST_SAFETY_MS;
const harvestAt = (over) =>
    decideHarvest({ ...times, age: 0, type: 0, bank: 0, cps: 1, unbuffedCps: 1, payback: 3600, lumpWorth: 3600, goldenWait: 300, buffChance: 0.5, ascending: false, ...over });

test('a ripe lump is harvested at once: waiting for it to fall pays the same and starts the next later', () => {
    // A ripe click pays harvestLumps(1), as the fall at overripe does (main.js:4476-4483, 4605-4613).
    for (const type of [0, 1, 3, 4]) assert.equal(harvestAt({ type, age: times.ripeAge }).harvest, true, `type ${type}`);
    assert.equal(harvestAt({ age: times.ripeAge - 1 }).harvest, false, 'a mature click pays nothing half the time');
    assert.equal(harvestAt({ age: 1 }).harvest, false);
    assert.equal(harvestAt({ age: times.ripeAge }).hold, 0, 'an ordinary lump asks the buyer for nothing');
});

test('a golden lump is held inside its window while the bank grows, when holding pays', () => {
    // The payout is min(CpS x 86400, bank) at the click (main.js:4492-4496). Bank far under the
    // cap, purchases repaying in ten hours: an hour of income held costs little.
    const golden = { type: GOLDEN, bank: 1000, cps: 1, unbuffedCps: 1, payback: 36000 };
    const early = harvestAt({ ...golden, age: times.ripeAge });
    assert.equal(early.harvest, false, early.reason);
    assert.equal(early.hold, DAY, 'the buyer keeps everything up to the cap');
    const late = harvestAt({ ...golden, age: lastSafe });
    assert.equal(late.harvest, true, 'never past the last safe moment before it falls');
    assert.equal(harvestAt({ ...golden, age: times.overripeAge - 1 }).harvest, true);
});

test('a golden lump is harvested at ripe when purchases repay faster than holding the bank', () => {
    const out = harvestAt({ type: GOLDEN, age: times.ripeAge, bank: 1000, payback: 60 });
    assert.equal(out.harvest, true, out.reason);
    assert.equal(out.hold, 0);
});

test('with the bank at the cap, a golden lump waits for a CpS buff and takes it when one runs', () => {
    const capped = { type: GOLDEN, age: times.ripeAge, bank: 5 * DAY, unbuffedCps: 1 };
    const waiting = harvestAt({ ...capped, cps: 1, goldenWait: 300 });
    assert.equal(waiting.harvest, false, waiting.reason);
    assert.ok(waiting.hold >= 5 * DAY, 'the bank a buff would pay on is kept');
    assert.equal(harvestAt({ ...capped, cps: 7 }).harvest, true, 'a Frenzy lifts the cap to 7 x 24 h of CpS');
    assert.equal(harvestAt({ ...capped, cps: 1, goldenWait: Infinity }).harvest, true, 'no golden cookie will come');
});

test('the wait for a CpS buff lasts only while it is expected to pay more than it holds up', () => {
    // Defect: at the cap the lump waited whenever a golden cookie was due before its last safe
    // moment, holding the buyer for up to 59 minutes, even where no buff could raise the payout.
    const capped = { type: GOLDEN, age: times.ripeAge, cps: 1, unbuffedCps: 1 };
    // The bank just at the cap: a buff lifts the cap, not the bank the payout is taken from
    // (main.js:4492-4496), so the wait would buy minutes of income for an hour of purchases.
    const atCap = harvestAt({ ...capped, bank: DAY, payback: 60 });
    assert.equal(atCap.harvest, true, atCap.reason);
    assert.equal(harvestAt({ ...capped, bank: DAY }).harvest, true, 'even with purchases repaying in an hour');
    // Five days banked, a Frenzy would pay five times as much: worth the wait with purchases that
    // take an hour to repay, not with ones that repay in a minute, nor with a CpS buff unlikely.
    assert.equal(harvestAt({ ...capped, bank: 5 * DAY }).harvest, false);
    assert.equal(harvestAt({ ...capped, bank: 5 * DAY, payback: 60 }).harvest, true);
    assert.equal(harvestAt({ ...capped, bank: 5 * DAY, buffChance: 0.001 }).harvest, true);
    assert.equal(harvestAt({ ...capped, bank: 5 * DAY, buffChance: 0 }).harvest, true, 'no golden cookie gives a CpS buff');
});

test('the chance of a CpS buff counts the golden cookie outcomes of x7 or more', () => {
    // Frenzy x7, Dragon Harvest x15, Elder frenzy x666; a building special multiplies by
    // 1 + amount/10 of the building it picks (main.js:5505), x7 from 60 of it.
    const probabilities = { frenzy: 0.5, 'dragon harvest': 0.125, 'blood frenzy': 0.0625, 'building special': 0.25, 'click frenzy': 0.25, clot: 0.5 };
    assert.equal(cpsBuffChance({ probabilities, buildingSpecialMean: 60 }), 0.9375);
    assert.equal(cpsBuffChance({ probabilities, buildingSpecialMean: 59 }), 0.6875);
    assert.equal(cpsBuffChance({ probabilities: {} }), 0);
});

test('a known golden lump starts holding the bank a payback ahead of its harvest', () => {
    const golden = { type: GOLDEN, bank: 0, cps: 1, unbuffedCps: 1, payback: 2 * 3600 };
    // The harvest is planned for the last safe moment; the hold starts two hours (the payback) before.
    assert.equal(harvestAt({ ...golden, age: lastSafe - 3 * HOUR }).hold, 0);
    const holding = harvestAt({ ...golden, age: lastSafe - 1.5 * HOUR });
    assert.equal(holding.harvest, false);
    assert.equal(holding.hold, DAY);
    // No longer than it takes to fill the bank to the cap.
    assert.equal(harvestAt({ ...golden, bank: DAY - 1800, age: lastSafe - 1.5 * HOUR }).hold, 0);
});

test('a golden lump is collected before an ascension, when the bank it pays on is at its biggest', () => {
    assert.equal(harvestAt({ type: GOLDEN, age: times.ripeAge, bank: 1000, payback: 36000, ascending: true }).harvest, true);
    // Mature: the cookies still come, but half the time no lumps (main.js:4471-4474, 4491-4496).
    const matureRich = harvestAt({ type: GOLDEN, age: times.matureAge, bank: 100 * 3600, ascending: true, lumpWorth: 3600 });
    assert.equal(matureRich.harvest, true, matureRich.reason);
    const maturePoor = harvestAt({ type: GOLDEN, age: times.matureAge, bank: 3600, ascending: true, lumpWorth: 3600 });
    assert.equal(maturePoor.harvest, false, 'half of 4.5 lumps is worth more than an hour of CpS');
    assert.equal(harvestAt({ type: 0, age: times.matureAge, ascending: true }).harvest, false, 'an ordinary lump keeps');
});

test('a lump is worth its best building level over the horizon, plus the dent in a Sugar baking jar', () => {
    const base = { bestPerLump: 0.001, secondsToLump: 3600, lumpSeconds: 23 * 3600 };
    assert.equal(lumpWorth({ ...base, lumps: 100, sugarBaking: false }), 0.001 * LEVEL_HORIZON_SECONDS);
    assert.equal(lumpWorth({ ...base, lumps: 150, sugarBaking: true }), 0.001 * LEVEL_HORIZON_SECONDS, 'spent from the excess');
    // At 100 the jar is one short until the next harvest refills it.
    assert.equal(lumpWorth({ ...base, lumps: 100, sugarBaking: true }), (0.01 / 2) * 3600 + 0.001 * LEVEL_HORIZON_SECONDS);
    // At 90 it stays one short until the jar would have reached 100: ten more lumps.
    assert.equal(lumpWorth({ ...base, lumps: 90, sugarBaking: true }), (0.01 / 1.9) * (3600 + 10 * 23 * 3600) + 0.001 * LEVEL_HORIZON_SECONDS);
});

// --- Sugar frenzy ----------------------------------------------------------------------------

test('Sugar frenzy is worth two hours of CpS, more when it lands on a running CpS buff', () => {
    // x3 for an hour (main.js:11043, 14089-14099) adds two hours; buffs multiply with it.
    assert.equal(frenzyValue([]), 7200);
    assert.equal(frenzyValue([{ multCpS: 7, secondsLeft: 77 }]), 7200 + 2 * 6 * 77);
    assert.equal(frenzyValue([{ multCpS: 0.5, secondsLeft: 66 }]), 7200 - 2 * 0.5 * 66, 'a clot takes some away');
    assert.equal(frenzyValue([{ multCpS: 2, secondsLeft: 99999 }]), 7200 + 2 * 3600, 'only the hour it runs counts');
    assert.equal(frenzyValue([{ multClick: 777, secondsLeft: 13 }]), 7200, 'click buffs are not CpS');
});

test('buffs running together multiply the frenzy\'s extra, as they multiply CpS', () => {
    // CalculateGains multiplies every buff's multCpS into CpS (main.js:5159). A Frenzy (x7, 77 s)
    // with a x10 buff for 30 s: the frenzy's hour runs 30 s at x70, 47 s at x7, the rest at x1.
    const both = 2 * (30 * 70 + 47 * 7 + (3600 - 77));
    assert.equal(frenzyValue([{ multCpS: 7, secondsLeft: 77 }, { multCpS: 10, secondsLeft: 30 }]), both);
    assert.equal(frenzyValue([{ multCpS: 10, secondsLeft: 30 }, { multCpS: 7, secondsLeft: 77 }]), both, 'in any order');
    // A Cursed finger (x0, 10 s) stops CpS, and the frenzy with it, while it runs.
    assert.equal(frenzyValue([{ multCpS: 0, secondsLeft: 10 }, { multCpS: 7, secondsLeft: 77 }]), 2 * (67 * 7 + (3600 - 77)));
});

const run = (ratio, rated = true) => ({ instantRate: ratio * 1e-6, averageRate: 1e-6, rated });
const frenzyAt = (over) => decideFrenzy({ available: true, buffs: [], worth: 1000, run: run(1.05), ascending: false, ...over });

test('Sugar frenzy waits for the end of the run, when two hours of CpS are worth the most', () => {
    assert.equal(frenzyAt({ run: run(3) }).activate, false, 'the run is still growing fast');
    assert.equal(frenzyAt({ run: run(1.05) }).activate, true);
    assert.equal(frenzyAt({ run: run(0.9) }).activate, true, 'past the rule but still playing: a guard holds the ascension');
    assert.equal(frenzyAt({ run: { instantRate: Infinity, averageRate: 1e-6 } }).activate, false, 'growth not known yet');
    assert.equal(frenzyAt({ ascending: true }).activate, false, 'the ascension has begun: the hour would be lost');
    assert.equal(frenzyAt({ available: false }).activate, false);
});

test('Sugar frenzy ignores the rates until the ascension\'s rule is live', () => {
    // Early in a run the rates swing (measured: 1.3x the average at 15 minutes, 3.4x at 90), and a
    // frenzy there would triple a CpS that is still tiny.
    assert.equal(frenzyAt({ run: run(1.05, false) }).activate, false);
    assert.equal(frenzyAt({ run: run(1.05, false), buffs: [{ multCpS: 7, secondsLeft: 77 }] }).activate, false);
});

test('Sugar frenzy starts a little earlier to land on a Frenzy', () => {
    const frenzy = [{ multCpS: 7, secondsLeft: 77 }];
    assert.equal(frenzyAt({ run: run(1.2) }).activate, false);
    assert.equal(frenzyAt({ run: run(1.2), buffs: frenzy }).activate, true);
    assert.equal(frenzyAt({ run: run(2), buffs: frenzy }).activate, false);
});

test('Sugar frenzy is skipped when the lump is worth more on a building level', () => {
    assert.equal(frenzyAt({ worth: 7200 }).activate, false);
    assert.equal(frenzyAt({ worth: 7199 }).activate, true);
});

test('with nothing ending the run, Sugar frenzy waits for a CpS buff to stack on', () => {
    assert.equal(frenzyAt({ run: null }).activate, false);
    assert.equal(frenzyAt({ run: null, buffs: [{ multCpS: 7, secondsLeft: 77 }] }).activate, true);
    assert.equal(frenzyAt({ run: null, buffs: [{ multCpS: 1.5, secondsLeft: 30 }] }).activate, false, 'a small buff adds too little');
});
