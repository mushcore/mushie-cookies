import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPop, fortuneChoice } from '../../src/core/shimmers.js';

const s = (type, id) => ({ type, id });

// A reindeer pays a minute of Game.cookiesPs, cut to 0.75 by a Frenzy and 0.5 by an Elder frenzy
// the moment it runs (main.js:5787-5789), while the CpS those buffs raise is recalculated only on
// the next frame (13748-13793, 16274): a golden cookie popped first can only lower a reindeer.
test('every golden cookie is popped, and every reindeer, reindeer first', () => {
    const list = [s('reindeer', 1), s('golden', 2), s('golden', 3), s('reindeer', 4), s('golden', 5)];
    assert.deepEqual(toPop(list, { golden: true, reindeer: true }).map((x) => x.id), [1, 4, 2, 3, 5]);
    assert.deepEqual(toPop(list, { golden: true, reindeer: false }).map((x) => x.id), [2, 3, 5]);
    assert.deepEqual(toPop(list, { golden: false, reindeer: true }).map((x) => x.id), [1, 4]);
    assert.deepEqual(toPop(list, { golden: false, reindeer: false }), []);
});

test('the list to pop is a copy: popping splices the game list (main.js:5244)', () => {
    const list = [s('golden', 1), s('golden', 2), s('golden', 3), s('golden', 4), s('golden', 5)];
    const popped = [];
    for (const shimmer of toPop(list, { golden: true })) {
        popped.push(shimmer.id);
        list.splice(list.indexOf(shimmer), 1); // what die() does
    }
    assert.deepEqual(popped, [1, 2, 3, 4, 5], 'none skipped');
});

const hour = 3600;
const base = { bank: 0, cps: 1000, unbuffedCps: 1000, ascensionImminent: false };
const choose = (sub, over = {}) => fortuneChoice({ effect: { type: 'fortune', sub }, ...base, ...over });

test('only a fortune is clicked', () => {
    assert.equal(fortuneChoice({ effect: 0, ...base }).take, false);
    assert.equal(fortuneChoice({ effect: { type: 'other' }, ...base }).take, false);
});

test('a fortune upgrade and the fortune golden cookie are taken on sight', () => {
    assert.equal(choose({ name: 'Fortune #001' }).take, true);
    assert.equal(choose('fortuneGC').take, true);
});

test('the hour of CpS is taken only when the bank covers it (the payout is capped at the bank, main.js:7646)', () => {
    assert.equal(choose('fortuneCPS', { bank: 0.2 * hour * 1000 }).take, false, 'a fifth of an hour now, gone for the ascension');
    assert.equal(choose('fortuneCPS', { bank: hour * 1000 }).take, true);
    assert.equal(choose('fortuneCPS', { bank: 5 * hour * 1000 }).take, true);
});

test('during a CpS buff the payout is larger, and a bank of an unbuffed hour is enough', () => {
    // Frenzy: buffed CpS ×7. The bank covers two unbuffed hours: the payout is two hours.
    const frenzy = choose('fortuneCPS', { cps: 7000, bank: 2 * hour * 1000 });
    assert.equal(frenzy.take, true);
    // A clot halves CpS: the payout would be half an hour, so wait.
    assert.equal(choose('fortuneCPS', { cps: 500, bank: 5 * hour * 1000 }).take, false);
    // A cursed finger stops CpS: nothing to gain.
    assert.equal(choose('fortuneCPS', { cps: 0, bank: 5 * hour * 1000 }).take, false);
});

test('with an ascension imminent, any payout is taken: the fortune is reset with the run (main.js:3542)', () => {
    assert.equal(choose('fortuneCPS', { bank: 0.2 * hour * 1000, ascensionImminent: true }).take, true);
    assert.equal(choose('fortuneCPS', { bank: 0, ascensionImminent: true }).take, false, 'but not nothing');
});
