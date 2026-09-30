import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOANS, incomeOver, loanValue, chooseLoan, secondsToAscension, comboProfile, castTimes, loanOccasion } from '../../src/core/loans.js';
import { BUFF_FIXTURES, buffFromFixture } from '../fixtures/buffs.mjs';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const [loan1, loan2, loan3] = LOANS;

test('the loan terms are the game\'s, with its durations in minutes turned into seconds', () => {
    // minigameMarket.js:348-353 stores minutes; takeLoan passes loan[2]*60 and loan[4]*60 seconds (:376, :380).
    assert.deepEqual(
        LOANS.map((l) => [l.id, l.mult, l.seconds, l.interestMult, l.interestSeconds, l.downpayment]),
        [
            [1, 1.5, 7200, 0.25, 14400, 0.2],
            [2, 2, 0.67 * 60, 0.1, 2400, 0.4],
            [3, 1.2, 172800, 0.8, 432000, 0.5],
        ]
    );
    // The buttons show from these office levels (minigameMarket.js:1090-1095).
    assert.deepEqual(LOANS.map((l) => l.office), [2, 4, 5]);
});

test('income over a stretch follows the known profile, then the expected rate', () => {
    const profile = [{ seconds: 10, perSecond: 100 }, { seconds: 5, perSecond: 20 }];
    assert.equal(incomeOver(profile, 1, 0, 10), 1000);
    assert.equal(incomeOver(profile, 1, 0, 20), 1000 + 100 + 5);
    assert.equal(incomeOver(profile, 1, 12, 30), 3 * 20 + 15);
    assert.equal(incomeOver([], 2, 0, 50), 100);
    assert.equal(incomeOver(profile, 1, 5, 5), 0);
});

test('on ordinary income every loan loses, before its downpayment', () => {
    // Gain (mult - 1) × duration against (1 - interest mult) × interest duration, in seconds of income.
    const at = (loan) => loanValue({ loan, profile: [], expected: 1, bank: 0 }).net;
    assert.ok(close(at(loan1), 0.5 * 7200 - 0.75 * 14400)); // -7200
    assert.ok(close(at(loan2), 1 * 40.2 - 0.9 * 2400)); // -2119.8
    assert.ok(close(at(loan3), 0.2 * 172800 - 0.2 * 432000)); // -51840
});

test('the downpayment is a share of the whole bank and counts as lost', () => {
    const without = loanValue({ loan: loan2, profile: [], expected: 1, bank: 0 });
    const withBank = loanValue({ loan: loan2, profile: [], expected: 1, bank: 10000 });
    assert.ok(close(withBank.cost - without.cost, 0.4 * 10000));
});

test('a pawnshop loan pays on a click frenzy: 40 seconds doubled against 40 minutes at a tenth', () => {
    // A combo making 1000× ordinary income for 26 s, then ordinary income.
    const v = loanValue({ loan: loan2, profile: [{ seconds: 26, perSecond: 1000 }], expected: 1, bank: 1000 });
    assert.ok(close(v.gain, 26 * 1000 + (40.2 - 26) * 1));
    assert.ok(close(v.cost, 0.4 * 1000 + 0.9 * 2400));
    assert.ok(v.net > 0);
});

test('an ascension ends a loan and its interest: nothing after the run counts', () => {
    // killBuffs at the reset never runs a loan's onDie, so no interest is ever charged (main.js:3492, 13827).
    const v = loanValue({ loan: loan1, profile: [], expected: 1, bank: 1000, secondsLeft: 3600 });
    assert.ok(close(v.gain, 0.5 * 3600));
    assert.ok(close(v.cost, 0.2 * 1000), 'only the downpayment');
    const partial = loanValue({ loan: loan1, profile: [], expected: 1, bank: 0, secondsLeft: 7200 + 1000 });
    assert.ok(close(partial.cost, 0.75 * 1000), 'interest only until the run ends');
});

test('a loan is taken only when it is worth more than it costs', () => {
    const now = { profile: [], expected: 1, bank: 1000, secondsLeft: Infinity };
    assert.equal(chooseLoan({ loans: LOANS, now, spendable: 1000 }), null);
});

test('the downpayment may take only what the buyer is not holding', () => {
    const now = { profile: [{ seconds: 26, perSecond: 1000 }], expected: 1, bank: 1000, secondsLeft: Infinity };
    assert.equal(chooseLoan({ loans: [loan2], now, spendable: 1000 }).loan.id, 2);
    // 40% of a 1000 bank is 400; with 300 free above the reserve, no loan.
    assert.equal(chooseLoan({ loans: [loan2], now, spendable: 300 }), null);
});

test('of the loans worth taking, the most valuable is taken', () => {
    // Close to the end of the run: the modest loan's two hours pay, the pawnshop's 40 seconds barely.
    const now = { profile: [], expected: 1, bank: 100, secondsLeft: 3000 };
    const choice = chooseLoan({ loans: [loan1, loan2], now, spendable: 100 });
    assert.equal(choice.loan.id, 1);
    assert.ok(close(choice.net, 0.5 * 3000 - 0.2 * 100));
});

test('a loan waits when a better combo is forecast inside its window', () => {
    const now = { profile: [{ seconds: 26, perSecond: 1000 }], expected: 1, bank: 1000, secondsLeft: Infinity };
    const bigger = { profile: [{ seconds: 26, perSecond: 5000 }] };
    // In 10 minutes, inside the pawnshop loan's 40 minutes of interest: wait for it.
    assert.equal(chooseLoan({ loans: [loan2], now, spendable: 1000, ahead: [{ inSeconds: 600, ...bigger }] }), null);
    // After the window closes, the loan is free again by then: take this one.
    assert.equal(chooseLoan({ loans: [loan2], now, spendable: 1000, ahead: [{ inSeconds: 3000, ...bigger }] }).loan.id, 2);
    // A smaller combo ahead does not hold it back.
    const smaller = { profile: [{ seconds: 26, perSecond: 100 }] };
    assert.equal(chooseLoan({ loans: [loan2], now, spendable: 1000, ahead: [{ inSeconds: 600, ...smaller }] }).loan.id, 2);
});

test('the ascension is forecast where the run\'s current growth, falling in a line, meets its average', () => {
    // The ascension system ascends once the current growth rate drops under the run's average
    // (src/core/ascension.js); `gap` is the first minus the second, sampled once a minute.
    const slow = Array.from({ length: 31 }, (_, i) => ({ t: 60 * i, gap: 30 - 0.01 * 60 * i }));
    assert.ok(close(secondsToAscension(slow), (30 - 18) / 0.01), 'twelve more at a hundredth a second');
    const rising = Array.from({ length: 31 }, (_, i) => ({ t: 60 * i, gap: 1 + 0.01 * 60 * i }));
    assert.equal(secondsToAscension(rising), Infinity);
    const crossed = slow.concat([{ t: 1860, gap: -1 }]);
    assert.equal(secondsToAscension(crossed), 0, 'already below: the ascension is due');
    assert.equal(secondsToAscension(slow.slice(0, 5)), Infinity, 'too little history to say');
    assert.equal(secondsToAscension([]), Infinity);
});

test('a downpayment takes what the buyer is saving for only when the loan out-earns that purchase', () => {
    // Near the end of the run the modest loan pays: 0.5 × 3000 = 1500 over 20 of downpayment.
    const now = { profile: [], expected: 1, bank: 100, secondsLeft: 3000 };
    // With 100 free but 90 of it saved for a purchase, the 20 of downpayment cuts into the saving.
    // The loan returns 1480 on 20 over 3000 s, about 0.025 a second.
    assert.equal(chooseLoan({ loans: [loan1], now, spendable: 100, committed: 90, buyerReturn: 0.01 }).loan.id, 1);
    assert.equal(chooseLoan({ loans: [loan1], now, spendable: 100, committed: 90, buyerReturn: 0.05 }), null);
    assert.equal(chooseLoan({ loans: [loan1], now, spendable: 100, committed: 50, buyerReturn: 0.05 }).loan.id, 1, 'the saving is untouched');
});

test('a combo\'s profile is what a loan scales, piece by piece as each buff ends', () => {
    // Frenzy ×7 for 60 s and Click frenzy ×777 for 20 s, on 100 CpS, 10 clicks a second, and a
    // CpS share of 1000 cookies a click with both running.
    const buffs = [
        { seconds: 60, multCpS: 7 },
        { seconds: 20, multClick: 777 },
    ];
    const profile = comboProfile({ buffs, cps: 100, clicksPerSecond: 10, clickShare: 1000 });
    assert.deepEqual(profile.map((p) => p.seconds), [20, 40]);
    assert.ok(close(profile[0].perSecond, 700 + 10 * 1000));
    assert.ok(close(profile[1].perSecond, 700 + (10 * 1000) / 777), 'the click frenzy has ended');
    assert.deepEqual(comboProfile({ buffs: [{ seconds: 60, multCpS: 0.5 }], cps: 100, clicksPerSecond: 10, clickShare: 1 }), [], 'a debuff is no combo');
    assert.deepEqual(comboProfile({ buffs: [], cps: 100, clicksPerSecond: 10, clickShare: 1 }), []);
});

test('casts are timed at the soonest the mana covers them, with the game\'s regeneration', () => {
    // Full mana: the first cast is now. Then the bar refills at max(0.002, √(m/M)) × 0.002 a frame
    // (minigameGrimoire.js:486-488).
    const times = castTimes({ mana: 100, maxMana: 100, cost: 60, count: 3, window: 1e6 });
    assert.equal(times[0], 0);
    assert.ok(times[1] > 0 && times[2] > times[1]);
    // From 40 left, 20 more at about √0.4..√0.6 × 0.06 a second: some 400 s.
    assert.ok(times[1] > 300 && times[1] < 600, `second cast at ${times[1]}`);
    assert.deepEqual(castTimes({ mana: 0, maxMana: 100, cost: 60, count: 3, window: 60 }), [], 'nothing inside the window');
});

test("only an income spike or the run's end makes a loan worth looking at, as the shared classifier reads the buffs", () => {
    const buff = (type) => buffFromFixture(BUFF_FIXTURES.find((row) => row.type === type));
    const loans = [loan1, loan2];
    // A long boost multiplies CpS for hours or days (Sugar frenzy, a loan the player took, a
    // golden lump's blessing); reading it raw as a combo ran the whole valuation every second
    // for as long as it lasted (autopilot spec, section 2 rule 3).
    for (const type of ['sugar frenzy', 'loan 1', 'loan 3', 'sugar blessing']) {
        assert.equal(loanOccasion({ buffs: { x: buff(type) }, loans }), null, `${type} alone is no combo`);
    }
    assert.equal(loanOccasion({ buffs: { x: buff('clot') }, loans }), null, 'a debuff is no combo');
    assert.equal(loanOccasion({ buffs: {}, loans }), null);
    assert.equal(loanOccasion({ buffs: { a: buff('sugar frenzy'), b: buff('frenzy') }, loans }), 'combo');
    assert.equal(loanOccasion({ buffs: { x: buff('click frenzy') }, loans }), 'combo');
    // With no spike, only a run forecast to end inside the longest boost it could take.
    assert.equal(loanOccasion({ buffs: {}, loans, secondsLeft: 7000 }), 'run end');
    assert.equal(loanOccasion({ buffs: {}, loans, secondsLeft: 7300 }), null);
    assert.equal(loanOccasion({ buffs: {}, loans: [loan2], secondsLeft: 7000 }), null);
});
