import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    switchPrice,
    santaPrice,
    uniformWaits,
    eggWaits,
    collectionValue,
    heartVisit,
    planSeason,
    MAX_VISIT_SECONDS,
} from '../../src/core/seasons.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test('a season switch costs a billion plus a minute of unbuffed CpS, growing 1.5 times a use', () => {
    assert.equal(switchPrice({ unbuffedCps: 0, uses: 0 }), 1e9);
    assert.equal(switchPrice({ unbuffedCps: 1e6, uses: 0 }), 1e9 + 6e7);
    assert.equal(switchPrice({ unbuffedCps: 1e6, uses: 2 }), 1e9 + 6e7 * 2.25);
    // Selebrak in the diamond slot doubles the CpS part (main.js:12436-12439).
    assert.equal(switchPrice({ unbuffedCps: 1e6, uses: 0, godMult: 2 }), 1e9 + 1.2e8);
});

test('a Santa level costs (level+1)^(level+1): 1.14e16 from nothing to the last', () => {
    assert.equal(santaPrice(0), 1);
    assert.equal(santaPrice(1), 4);
    assert.equal(santaPrice(13), Math.pow(14, 14));
    let total = 0;
    for (let l = 0; l < 14; l++) total += santaPrice(l);
    assert.ok(close(total, 1.1435e16, 1e-3), String(total));
    assert.equal(santaPrice(14), Infinity, 'Final Claus is the last level');
});

test('waits for a uniform pool lengthen as fewer drops are left to find', () => {
    // 7 drops, all missing, one roll every 100 s that drops with 20%: the first new one in
    // 100/0.2 = 500 s, the last in 7 × 500 s.
    const waits = uniformWaits({ missing: 7, total: 7, rate: 0.01, chance: 0.2 });
    assert.equal(waits.length, 7);
    assert.ok(close(waits[0], 500));
    assert.ok(close(waits[6], 3500));
    assert.deepEqual(uniformWaits({ missing: 0, total: 7, rate: 0.01, chance: 0.2 }), []);
    assert.deepEqual(uniformWaits({ missing: 3, total: 7, rate: 0, chance: 0.2 }), [Infinity, Infinity, Infinity]);
});

test('egg waits count the one reroll the game gives a duplicate', () => {
    // Everything missing: every successful roll is a new egg (main.js:10444-10456).
    const all = eggWaits({ rareMissing: 8, commonMissing: 12, rate: 0.01 });
    assert.equal(all.length, 20);
    assert.ok(close(all[0], 100));
    // Only one common egg missing: q = 0.9/12 per draw, and a reroll on a duplicate.
    const q = 0.9 / 12;
    const one = eggWaits({ rareMissing: 0, commonMissing: 1, rate: 0.01 });
    assert.equal(one.length, 1);
    assert.ok(close(one[0], 1 / (0.01 * (q + (1 - q) * q))));
});

test('a drop is worth its income for the rest of the horizon', () => {
    assert.equal(collectionValue({ waits: [100, 200], gain: 10, horizon: 1000 }), 10 * 900 + 10 * 700);
    assert.equal(collectionValue({ waits: [100, 2000], gain: 10, horizon: 1000 }), 10 * 900, 'a drop after the horizon is worth nothing');
    assert.equal(collectionValue({ waits: [Infinity], gain: 10, horizon: 1000 }), 0);
    assert.equal(collectionValue({ waits: [], gain: 10, horizon: 1000 }), 0);
});

// Hearts cost 1e6, 1e9, ... 1e24; each unlocks at price/20 cookies earned, in Valentine's, once
// the previous one is bought (main.js:10302-10307, 11479, 16335-16345).
const hearts = (bought = 0, unlocked = bought) =>
    [1e6, 1e9, 1e12, 1e15, 1e18, 1e21, 1e24].map((price, i) => ({ price, basePrice: price, bought: i < bought, unlocked: i < unlocked }));

test('a Valentine visit counts the hearts in the chain that unlock now and pay for themselves', () => {
    const visit = heartVisit({ hearts: hearts(0), earned: 1e11, gain: 1e9, horizon: 3600, budget: 1e13, income: 1e10 });
    // Earned 1e11 passes 1e6/20, 1e9/20 and 1e12/20 but not 1e15/20.
    assert.equal(visit.count, 3);
    assert.equal(visit.locked, 3);
    assert.ok(close(visit.value, 3 * 1e9 * 3600 - (1e6 + 1e9 + 1e12)));
    assert.ok(visit.seconds > 0);
});

test('the chain stops at a heart that would not repay or that the bank is far from', () => {
    // The third heart costs 1e12, all that its 1e9/s repays in 1000 s.
    const pay = heartVisit({ hearts: hearts(0), earned: 1e11, gain: 1e9, horizon: 1000, budget: 1e13, income: 1e10 });
    assert.equal(pay.count, 2);
    // A heart that costs more than the bank plus five minutes of income is not waited for.
    const far = heartVisit({ hearts: hearts(0), earned: 1e11, gain: 1e9, horizon: 3600, budget: 1e9, income: 1e6 });
    assert.equal(far.count, 2);
});

test('hearts already unlocked need no visit; the next locked one does', () => {
    const done = heartVisit({ hearts: hearts(2, 3), earned: 1e11, gain: 1e9, horizon: 3600, budget: 1e13, income: 1e10 });
    assert.equal(done.count, 1, 'the third heart is still to buy');
    assert.equal(done.locked, 0, 'but it is already unlocked: the buyer can buy it in any season');
    const next = heartVisit({ hearts: hearts(3), earned: 1e17, gain: 1e15, horizon: 3600, budget: 1e19, income: 1e16 });
    assert.equal(next.locked, 2);
});

// Christmas: reindeer pay about a quarter of CpS; the other seasons pay only their drops.
const base = (over = {}) => ({
    season: '',
    baseSeason: '',
    canSwitch: true,
    prices: [1e9, 1.5e9],
    horizon: 3600,
    secondsInSeason: 1e6,
    visit: null,
    blocked: [],
    values: {
        christmas: { standing: 1e6, collection: 0, nextDrop: Infinity },
        easter: { standing: 0, collection: 0, nextDrop: Infinity },
        halloween: { standing: 0, collection: 0, nextDrop: Infinity },
        valentines: { standing: 0, collection: 0, nextDrop: Infinity },
        fools: { standing: 0, collection: 0, nextDrop: Infinity },
        '': { standing: 0, collection: 0, nextDrop: Infinity },
    },
    ...over,
});
const withValues = (values) => base({ values: { ...base().values, ...values } });

test('never switches without Season switcher', () => {
    const out = planSeason(base({ canSwitch: false }));
    assert.equal(out.action, 'stay');
});

test('switches to Christmas when reindeer repay the switch within the horizon', () => {
    const out = planSeason(base());
    assert.equal(out.action, 'switch');
    assert.equal(out.to, 'christmas');
    assert.ok(close(out.gain, 1e6 * 3600 - 1e9));
    assert.equal(out.price, 1e9);
});

test('stays when the switch would not repay before the run ends', () => {
    const out = planSeason(base({ horizon: 900 })); // 9e8 of reindeer for a 1e9 switch
    assert.equal(out.action, 'stay');
});

test('already in the best season, stays', () => {
    const out = planSeason(base({ season: 'christmas' }));
    assert.equal(out.action, 'stay');
});

test('a season whose drops are worth more than the reindeer is chosen first', () => {
    const out = planSeason(withValues({ easter: { standing: 0, collection: 1e10, nextDrop: 60 } }));
    assert.equal(out.to, 'easter');
});

test('never switches into a blocked season', () => {
    const out = planSeason({ ...withValues({ easter: { standing: 0, collection: 1e11, nextDrop: 60 } }), blocked: ['easter'] });
    assert.equal(out.to, 'christmas');
});

test('stays in the calendar season while it still has drops to give', () => {
    const halloween = { standing: 0, collection: 1e8, nextDrop: 600 };
    const stay = planSeason(base({ season: 'halloween', baseSeason: 'halloween', values: { ...base().values, halloween } }));
    assert.equal(stay.action, 'stay');
    // Once its drops are all in (or too slow to come before the run ends), Christmas pays more.
    const done = { standing: 0, collection: 0, nextDrop: Infinity };
    const leave = planSeason(base({ season: 'halloween', baseSeason: 'halloween', values: { ...base().values, halloween: done } }));
    assert.equal(leave.to, 'christmas');
});

test('returning to a calendar season costs nothing: the active switch is cancelled', () => {
    const out = planSeason(base({ season: 'easter', baseSeason: 'christmas' }));
    assert.equal(out.action, 'cancel');
    assert.equal(out.to, 'christmas');
    assert.ok(close(out.gain, 1e6 * 3600));
});

test('from no season, a worthwhile Valentine visit comes before settling in Christmas', () => {
    const visit = { value: 5e9, locked: 3, seconds: 60 };
    const out = planSeason(base({ visit }));
    assert.equal(out.action, 'switch');
    assert.equal(out.to, 'valentines');
    assert.equal(out.rest, 'christmas');
    // Visit then Christmas: 5e9 + 1e6 × (3600 − 60) − 1e9 − 1.5e9, against staying put at 0.
    assert.ok(close(out.gain, 5e9 + 1e6 * 3540 - 2.5e9));
});

test('a visit that does not repay its two switches is skipped', () => {
    const visit = { value: 1e9, locked: 1, seconds: 30 }; // less than the 1.5e9 second switch
    const out = planSeason(base({ visit }));
    assert.equal(out.to, 'christmas');
});

test('from Christmas, a visit is worth its hearts minus two switches and the reindeer missed', () => {
    const visit = { value: 3e9, locked: 2, seconds: 100 };
    const out = planSeason(base({ season: 'christmas', visit }));
    assert.equal(out.to, 'valentines');
    assert.ok(close(out.gain, 3e9 - 2.5e9 - 1e6 * 100));
    const small = planSeason(base({ season: 'christmas', visit: { value: 2.5e9, locked: 2, seconds: 100 } }));
    assert.equal(small.action, 'stay');
});

test('in Valentine\'s, stays while hearts are still unlocking, then leaves', () => {
    const visit = { value: 1e9, locked: 1, seconds: 30 };
    const stay = planSeason(base({ season: 'valentines', visit, secondsInSeason: 30 }));
    assert.equal(stay.action, 'stay');
    const done = planSeason(base({ season: 'valentines', visit: null, secondsInSeason: 30 }));
    assert.equal(done.to, 'christmas');
    const stuck = planSeason(base({ season: 'valentines', visit, secondsInSeason: MAX_VISIT_SECONDS + 1 }));
    assert.equal(stuck.to, 'christmas', 'a visit that stalls is given up');
});

test('a switch that barely pays is not made: switching back and forth would lose', () => {
    // Gains of a few percent of the price are within the estimate's error.
    const out = planSeason(base({ horizon: 1e9 / 1e6 + 10 }));
    assert.equal(out.action, 'stay');
});

test('in a calendar season with drops to give, a visit that comes back to it for free is still made', () => {
    // Natural Christmas: a Valentine's visit costs one switch; the way back is a cancel.
    const christmas = { standing: 1e6, collection: 1e9, nextDrop: 300 };
    const visit = { value: 5e9, locked: 3, seconds: 60 };
    const out = planSeason(base({ season: 'christmas', baseSeason: 'christmas', visit, values: { ...base().values, christmas } }));
    assert.equal(out.to, 'valentines');
    assert.equal(out.rest, 'christmas');
    assert.ok(close(out.gain, 5e9 - 1e9 - 1e6 * 60));
    // Resting anywhere else would forfeit the calendar season's drops.
    const easter = { standing: 0, collection: 1e12, nextDrop: 60 };
    const stay = planSeason(base({ season: 'christmas', baseSeason: 'christmas', values: { ...base().values, christmas, easter } }));
    assert.equal(stay.action, 'stay');
});

test('when the calendar season is Valentine\'s, a visit to it is a free cancel and the next switch is the first', () => {
    const visit = { value: 5e9, locked: 3, seconds: 60 };
    // Hearts to unlock make Valentine's the calendar season with drops to give, as the system reports it.
    const valentines = { standing: 0, collection: 0, nextDrop: 0 };
    const kept = planSeason(base({ season: 'christmas', baseSeason: 'valentines', visit, values: { ...base().values, valentines } }));
    assert.equal(kept.action, 'cancel', JSON.stringify(kept));
    assert.equal(kept.to, 'valentines');
    assert.equal(kept.price, 0);
    assert.ok(close(kept.gain, 5e9 - 1e6 * 3600));
    // Read without the drops flag, the visit is still free, and Christmas after it costs the first
    // price (a cancel is not a use), not the second.
    const out = planSeason(base({ season: 'christmas', baseSeason: 'valentines', visit }));
    assert.equal(out.action, 'cancel', JSON.stringify(out));
    assert.equal(out.to, 'valentines');
    assert.equal(out.rest, 'christmas');
    assert.equal(out.price, 0);
    assert.ok(close(out.gain, 5e9 + 1e6 * 3540 - 1e9 - 1e6 * 3600));
});

test('after a visit away from a calendar season with drops to give, it goes back to it, for free', () => {
    const easter = { standing: 0, collection: 1e8, nextDrop: 600 };
    const out = planSeason(base({ season: 'valentines', baseSeason: 'easter', values: { ...base().values, easter } }));
    assert.equal(out.action, 'cancel', JSON.stringify(out));
    assert.equal(out.to, 'easter');
    // Once the calendar season has nothing more to give, Christmas is free to win.
    const done = planSeason(base({ season: 'valentines', baseSeason: 'easter' }));
    assert.equal(done.to, 'christmas');
});
