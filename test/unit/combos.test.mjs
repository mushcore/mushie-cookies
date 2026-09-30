import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEVASTATION_SECONDS,
    devastationPerBuilding,
    priceSum,
    saleLoss,
    saleOptions,
    planSale,
    comboOverBuff,
    godzamokOn,
    inheritedCombosOn,
    buffProduct,
    devastationGainPerUnit,
    switchPlan,
    offPlan,
    keepStanding,
    turnOnStanding,
} from '../../src/core/combos.js';

const close = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

// A building priced the way the game prices one (main.js:7791-7796): the base price grown 1.15×
// per unit owned beyond the free ones, times the discounts, rounded up.
function gameBuilding({ basePrice, amount, free = 0, mod = 1 }) {
    const b = { basePrice, amount, free };
    b.getPrice = () => Math.ceil(basePrice * Math.pow(1.15, Math.max(0, b.amount - b.free)) * mod);
    return b;
}

// Selling k, then buying k back, exactly as the game's loops do (main.js:7857-7884 and 7826-7853):
// each unit sold refunds a share of the price the next one would cost, rounded down.
function sellThenRebuy(b, k, giveBack) {
    let cookies = 0;
    for (let i = 0; i < k; i++) {
        const price = Math.floor(b.getPrice() * giveBack);
        if (b.amount > 0) {
            cookies += price;
            b.amount--;
        }
    }
    for (let i = 0; i < k; i++) {
        cookies -= b.getPrice();
        b.amount++;
    }
    return -cookies;
}

const plain = (over = {}) => ({ id: 0, amount: 100, free: 0, unitPrice: 1000, inc: 1.15, sellMult: 0.25, keep: 1, ...over });

test('Devastation adds 1%, 0.5% or 0.25% click power per building sold, by Godzamok\'s slot, for 10 seconds', () => {
    // main.js:7887-7900 and the buff, 14077-14088.
    assert.equal(devastationPerBuilding(1), 0.01);
    assert.equal(devastationPerBuilding(2), 0.005);
    assert.equal(devastationPerBuilding(3), 0.0025);
    assert.equal(devastationPerBuilding(0), 0);
    assert.equal(devastationPerBuilding(false), 0, 'Game.hasGod returns false when he is not slotted');
    assert.equal(DEVASTATION_SECONDS, 10);
});

test('what selling and buying back costs matches the game\'s own loops', () => {
    for (const [over, k, giveBack] of [
        [{ basePrice: 15, amount: 200 }, 199, 0.25],
        [{ basePrice: 1100, amount: 50 }, 10, 0.25],
        [{ basePrice: 130000, amount: 300, mod: 0.93 * 0.99 }, 299, 0.25],
        [{ basePrice: 12000, amount: 120, free: 10 }, 119, 0.25], // units below `free` cost the base price
        [{ basePrice: 12000, amount: 120 }, 119, 0.5], // Earth Shatterer doubles the refund (main.js:7822)
    ]) {
        const b = gameBuilding(over);
        const spec = plain({ amount: over.amount, free: over.free || 0, unitPrice: over.basePrice * (over.mod || 1), sellMult: giveBack });
        const expected = sellThenRebuy(b, k, giveBack);
        assert.equal(b.amount, over.amount, 'the building count is back where it was');
        // The game rounds each unit's price; the closed form does not.
        assert.ok(Math.abs(saleLoss(spec, k) - expected) <= 2 * k, `${JSON.stringify(over)}: ${saleLoss(spec, k)} vs ${expected}`);
    }
    // Selling a whole stack of 1.15× units and buying it back loses about 4.75 times the next
    // unit's price: 0.75 of the rebuy, less the one-unit shift in what each sale refunds.
    const deep = plain({ amount: 400 });
    const next = deep.unitPrice * Math.pow(1.15, 400);
    assert.ok(close(saleLoss(deep, 399) / next, (1 - 0.25 * 1.15) / 0.15, 1e-6));
    assert.equal(saleLoss(deep, 0), 0);
});

test('price sums follow the game\'s growth and the free units', () => {
    const b = plain({ unitPrice: 10, free: 3 });
    let direct = 0;
    for (let n = 1; n < 9; n++) direct += 10 * Math.pow(1.15, Math.max(0, n - 3));
    assert.ok(close(priceSum(b, 1, 9), direct));
    assert.equal(priceSum(b, 5, 5), 0);
});

test('sale options leave one of each building and put the cheapest Devastation first', () => {
    const options = saleOptions([
        plain({ id: 1, amount: 50, unitPrice: 1e6 }),
        plain({ id: 2, amount: 1, unitPrice: 1 }), // only the one kept
        plain({ id: 3, amount: 50, unitPrice: 10 }),
        plain({ id: 4, amount: 400, unitPrice: 10 }), // many more, but the top ones cost far more each
    ]);
    assert.deepEqual(options.map((o) => o.id), [3, 1, 4]);
    assert.deepEqual(options.map((o) => o.sellable), [49, 49, 399]);
    for (const o of options) assert.ok(close(o.perUnit, o.loss / o.sellable));
    assert.ok(options[0].perUnit < options[1].perUnit && options[1].perUnit < options[2].perUnit);
});

test('a sale takes whole buildings whose Devastation is worth more than they cost to buy back', () => {
    const options = saleOptions([plain({ id: 1, amount: 50, unitPrice: 10 }), plain({ id: 2, amount: 50, unitPrice: 1e4 })]);
    const [cheap, dear] = options;
    assert.deepEqual(planSale({ options, gainPerUnit: cheap.perUnit * 0.99, budget: Infinity }).units, 0, 'nothing pays');
    const one = planSale({ options, gainPerUnit: cheap.perUnit * 1.01, budget: Infinity });
    assert.deepEqual(one.sales.map((s) => [s.id, s.units]), [[1, 49]]);
    assert.ok(close(one.loss, cheap.loss));
    assert.ok(close(one.gain, 49 * cheap.perUnit * 1.01));
    const both = planSale({ options, gainPerUnit: dear.perUnit * 1.01, budget: Infinity });
    assert.deepEqual(both.sales.map((s) => [s.id, s.units]), [[1, 49], [2, 49]]);
    assert.equal(both.units, 98);
    assert.equal(planSale({ options: [], gainPerUnit: 1e300, budget: Infinity }).units, 0);
});

test('a sale spends only the budget; a building that does not fit is sold in part, top units first, if that still pays', () => {
    const options = saleOptions([plain({ id: 1, amount: 50, unitPrice: 10 }), plain({ id: 2, amount: 80, unitPrice: 100 })]);
    const [cheap, dear] = options;
    const g = dear.perUnit * 50; // every unit of both pays, even the dearest
    assert.equal(planSale({ options, gainPerUnit: g, budget: 0 }).units, 0);
    const budget = cheap.loss + dear.loss / 2;
    const plan = planSale({ options, gainPerUnit: g, budget });
    assert.ok(plan.loss <= budget, `${plan.loss} > ${budget}`);
    assert.equal(plan.sales[0].units, 49);
    const part = plan.sales[1];
    assert.equal(part.id, 2);
    assert.ok(part.units > 0 && part.units < 79);
    // The largest part that fits: one more unit would not.
    const b = dear.building;
    assert.ok(close(part.loss, saleLoss(b, part.units)));
    assert.ok(cheap.loss + saleLoss(b, part.units + 1) > budget);
    // A part that fits but costs more than it gives is not sold: the top units are the dearest.
    const thin = planSale({ options, gainPerUnit: dear.perUnit * 1.01, budget });
    assert.deepEqual(thin.sales.map((s) => s.id), [1]);
});

test('over a click buff, sales stack inside a Devastation window and a new window starts when one ends', () => {
    // One cheap building: every cycle pays. 49 units sold per cycle, each worth 1% of clicking.
    const options = saleOptions([plain({ id: 1, amount: 50, unitPrice: 1 })]);
    const args = { options, perBuilding: 0.01, clickRate: 1e9, budget: Infinity, accrue: false };
    const units = 49;
    // Cycles every 5 s over a 10 s buff: sold at 0 s (10 s left) and 5 s (5 s left) in one window.
    const two = comboOverBuff({ ...args, seconds: 10, cycleSeconds: 5 });
    assert.equal(two.cycles, 2);
    assert.ok(close(two.gain, 0.01 * units * 1e9 * (10 + 5)));
    assert.ok(close(two.loss, 2 * options[0].loss));
    // A 26 s buff with a cycle every 13 s: the first window covers 0-10 s, the second 13-23 s.
    const renewed = comboOverBuff({ ...args, seconds: 26, cycleSeconds: 13 });
    assert.equal(renewed.cycles, 2);
    assert.ok(close(renewed.gain, 0.01 * units * 1e9 * (10 + 10)));
    // Only the part of a window inside the buff counts: sold at 20 s of a 26 s buff, 6 s are left.
    const tail = comboOverBuff({ ...args, seconds: 26, cycleSeconds: 20 });
    assert.ok(close(tail.gain, 0.01 * units * 1e9 * (10 + 6)));
    // Nothing without Godzamok.
    assert.equal(comboOverBuff({ ...args, perBuilding: 0, seconds: 26, cycleSeconds: 0.5 }).gain, 0);
});

test('over a click buff, sales are paid for from the budget and what the clicking earns', () => {
    const options = saleOptions([plain({ id: 1, amount: 50, unitPrice: 1000 })]);
    const loss = options[0].loss;
    // Clicking earns half a sale's loss each second: with nothing in the bank, the first cycle
    // cannot pay, the one two seconds later can.
    const out = comboOverBuff({ options, perBuilding: 0.01, clickRate: loss / 2, budget: 0, seconds: 10, cycleSeconds: 1, accrue: true });
    assert.ok(out.cycles >= 1);
    assert.ok(out.firstAt >= 2, `first sale at ${out.firstAt} s`);
    assert.ok(out.loss <= (loss / 2) * 10 * 50, 'never spends more than it had');
    assert.ok(out.gain > out.loss);
});

test('Godzamok is played only while clicking, and never beside an inherited combo', () => {
    assert.equal(godzamokOn({ autoGodzamok: 1, autoClick: 1 }), true);
    assert.equal(godzamokOn({ autoGodzamok: 1, autoClick: 0 }), false, 'Devastation multiplies clicks');
    assert.equal(godzamokOn({ autoGodzamok: 0, autoClick: 1 }), false);
    assert.equal(godzamokOn({ autoGodzamok: 1, autoClick: 1, auto100ConsistencyCombo: 1 }), false);
    assert.equal(godzamokOn({ autoGodzamok: 1, autoClick: 1, autoFTHOFCombo: 1 }), false);
    assert.equal(inheritedCombosOn({ auto100ConsistencyCombo: 1 }), true);
    assert.equal(inheritedCombosOn({}), false);
});

// Buffs as the switch plan sees them: multipliers and seconds left.
const frenzy = (secondsLeft) => ({ multCpS: 7, multClick: 1, secondsLeft });
const clickFrenzy = (secondsLeft) => ({ multCpS: 1, multClick: 777, secondsLeft });

test('the product of the buffs still running at a time', () => {
    const buffs = [frenzy(154), clickFrenzy(26)];
    assert.equal(buffProduct(buffs, 0, 'multCpS'), 7);
    assert.equal(buffProduct(buffs, 0, 'multClick'), 777);
    assert.equal(buffProduct(buffs, 26, 'multClick'), 1, 'a buff with 26 s left has ended at 26 s');
    assert.equal(buffProduct(buffs, 154, 'multCpS'), 1);
    assert.equal(buffProduct([{ multCpS: 0, secondsLeft: 10 }], 5, 'multCpS'), 0, 'a Cursed finger stops CpS (main.js:13932)');
});

test('a unit sold now is worth its share of clicking for what is left of the window, as the click buffs run out', () => {
    // Clicking earns 1,000 a second under a Click frenzy with 4 s left; a fresh window is 10 s.
    // After the frenzy, clicks earn 1/777 of that for the 6 s left.
    const gain = devastationGainPerUnit({ perBuilding: 0.01, clickIncome: 1000, buffs: [clickFrenzy(4)], windowSeconds: 10 });
    assert.ok(close(gain, 0.01 * 1000 * (4 + 6 / 777)));
    // With no click buff, the whole window at the rate now.
    assert.ok(close(devastationGainPerUnit({ perBuilding: 0.005, clickIncome: 10, buffs: [], windowSeconds: 3 }), 0.005 * 10 * 3));
    assert.equal(devastationGainPerUnit({ perBuilding: 0, clickIncome: 10, buffs: [], windowSeconds: 3 }), 0);
});

// Per unit of unbuffed CpS: the switch adds half of it, the toggle is an hour of CpS (main.js:10679,
// 10694, 5133-5141), and with ten mouse upgrades each click adds 10% of CpS, 5% more with the switch.
// Golden cookies, clicked as they appear, earn about twice what buildings and clicking do.
const base = { deltaCps: 0.5, deltaClick: 0.05, clicksPerSecond: 40, priceOffBase: 1.5 * 3600, goldenRate: 10 };

test('the switch is turned on for a click buff only when what it adds beats both toggles and the golden cookies missed', () => {
    const quiet = switchPlan({ ...base, priceOn: 3600, buffs: [] });
    assert.ok(quiet.value < 0, 'with no buff it never pays');

    // A Click frenzy on a Frenzy: on costs 7 hours of CpS; off waits for the Frenzy to end.
    const buffs = [frenzy(154), clickFrenzy(26)];
    const plan = switchPlan({ ...base, priceOn: 7 * 3600, buffs });
    assert.equal(plan.offAt, 154, 'turned off once the Frenzy is over: during it, it costs 7 times more');
    const clicks = 0.05 * 40 * 777 * 7 * 26 + 0.05 * 40 * 7 * (154 - 26);
    const passive = 0.5 * 7 * 154;
    const expected = clicks + passive - 7 * 3600 - 1.5 * 3600 - 10 * 154;
    assert.ok(close(plan.value, expected), `${plan.value} vs ${expected}`);
    assert.ok(plan.value > 0);
    assert.ok(close(plan.cost, 7 * 3600 + 1.5 * 3600 + 10 * 154));

    // One mouse upgrade: a click adds 0.5% of CpS with the switch; the same buff does not pay.
    assert.ok(switchPlan({ ...base, deltaClick: 0.005, priceOn: 7 * 3600, buffs }).value < 0);
});

test('the switch is turned off at the moment that costs least: after a short CpS buff, not after a long one', () => {
    // Waiting out a Frenzy saves 6 hours of CpS on the price for 100 s of golden cookies.
    assert.equal(offPlan({ ...base, buffs: [frenzy(100)] }).offAt, 100);
    // A modest loan runs x1.5 for two hours (minigameMarket.js:350): waiting saves 45 minutes of
    // CpS on the price, and costs two hours of golden cookies.
    const loan = { multCpS: 1.5, multClick: 1, secondsLeft: 7200 };
    assert.equal(offPlan({ ...base, buffs: [loan] }).offAt, 0);
    // With nothing running, off at once.
    assert.equal(offPlan({ ...base, buffs: [] }).offAt, 0);
    // A Cursed finger stops CpS, so the price is nothing while it runs (main.js:10694, 13932).
    assert.equal(offPlan({ ...base, buffs: [{ multCpS: 0, multClick: 1, secondsLeft: 10 }, frenzy(60)] }).offAt, 0);
});

test('the switch stays on for good only while that out-earns golden cookies, and is turned on for good only when it repays both toggles', () => {
    assert.equal(keepStanding({ incomeOn: 101, incomeOff: 100 }), true);
    assert.equal(keepStanding({ incomeOn: 99, incomeOff: 100 }), false);
    // +1 a second for an hour does not repay 5,000 of toggles; for two hours it does.
    const args = { incomeOn: 101, incomeOff: 100, priceOn: 2000, priceOff: 3000 };
    assert.equal(turnOnStanding({ ...args, horizonSeconds: 3600 }), false);
    assert.equal(turnOnStanding({ ...args, horizonSeconds: 7200 }), true);
    assert.equal(turnOnStanding({ ...args, incomeOn: 99, horizonSeconds: Infinity }), false);
});
