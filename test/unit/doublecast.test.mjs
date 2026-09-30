import { test } from 'node:test';
import assert from 'node:assert/strict';
import { magicMax, spellCost, regenSeconds, planSale, fateOdds, decideDouble } from '../../src/core/doublecast.js';
import { outcomeValue, afterOutcome } from '../../src/core/grimoire.js';

// Force the Hand of Fate's price: 10 magic plus 60% of max magic (minigameGrimoire.js:42-43).
const FATE = { costMin: 10, costPercent: 0.6 };
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} is not ${b}`);

test('max magic follows the game formula for any tower count and level', () => {
    // minigameGrimoire.js:263-267: floor(4 + towers^0.6 + 15 ln((towers + 10 (level - 1)) / 15 + 1)).
    assert.equal(magicMax(307, 1), 81);
    assert.equal(magicMax(306, 1), 80);
    assert.equal(magicMax(400, 1), 90);
    assert.equal(magicMax(300, 10), 84);
    assert.equal(magicMax(21, 1), 23);
    // Both count as at least one.
    assert.equal(magicMax(0, 0), magicMax(1, 1));
});

test('a spell costs its base plus a share of max magic, less a tenth with Supreme Intellect', () => {
    // minigameGrimoire.js:339-345.
    assert.equal(spellCost(FATE, 81), 58);
    assert.equal(spellCost(FATE, 90), 64);
    assert.equal(spellCost(FATE, 90, 1), 57); // floor(64 * 0.9)
    assert.equal(spellCost({ costMin: 10, costPercent: 0.1 }, 90), 19);
});

test('the sale keeps the most towers that still leave the second cast affordable', () => {
    // 307 towers at level 1: max 81, the first cast costs 58 and leaves 23. At 22 towers max magic
    // is 23 and the spell costs 23; the old combo's table sold down to 21 (fc_spells.js:852).
    assert.deepEqual(planSale({ towers: 307, level: 1, left: 23, spell: FATE }), { keep: 22, sell: 285, maxMagic: 23, cost: 23 });
    // One tower fewer and no count works: 22 left, and 23 is the cheapest max magic the spell fits in.
    assert.equal(planSale({ towers: 306, level: 1, left: 22, spell: FATE }), null);
    // More mana left means fewer towers sold.
    assert.deepEqual(planSale({ towers: 400, level: 1, left: 26, spell: FATE }), { keep: 31, sell: 369, maxMagic: 28, cost: 26 });
    // Supreme Intellect makes both casts cheaper, so more towers stay.
    assert.deepEqual(planSale({ towers: 400, level: 1, left: 33, spell: FATE, intellect: 1 }), { keep: 85, sell: 315, maxMagic: 46, cost: 33 });
    // Nothing is sold when the mana left already pays.
    assert.deepEqual(planSale({ towers: 400, level: 1, left: 64, spell: FATE }), { keep: 400, sell: 0, maxMagic: 90, cost: 64 });
});

test('regeneration time matches the game frame by frame', () => {
    // minigameGrimoire.js:486-488, 30 frames a second.
    const frames = (from, to, max) => {
        let m = from;
        let n = 0;
        while (m < to) {
            m += Math.max(0.002, Math.pow(m / Math.max(max, 100), 0.5)) * 0.002;
            n++;
        }
        return n / 30;
    };
    for (const [from, to, max] of [[26, 90, 90], [0, 90, 90], [70, 200, 200], [1e-5, 30, 150]]) {
        near(regenSeconds(from, to, max), frames(from, to, max), 0.005);
    }
    assert.equal(regenSeconds(50, 40, 90), 0);
});

test('fate odds cover every outcome the spell can make and add up to one', () => {
    for (const at of [{ failChance: 0.15 }, { failChance: 0.3, dragonflight: true }, { failChance: 0.15, buildingsOwned: 5 }, { failChance: 1 }]) {
        const odds = fateOdds(at);
        near(Object.values(odds).reduce((a, b) => a + b, 0), 1);
    }
    // minigameGrimoire.js:57-58: a 15% roll replaces the list with a storm drop; the sugar lump roll
    // can then add a lump beside it.
    near(fateOdds({ failChance: 0 })['cookie storm drop'], 0.15 * (0.9999 + 0.0001 / 2));
    // :73: a backfire is blab one time in ten.
    near(fateOdds({ failChance: 1 }).blab, 0.1);
    assert.equal(fateOdds({ failChance: 0.15, dragonflight: true })['click frenzy'] || 0, 0);
    assert.equal(fateOdds({ failChance: 0.15, buildingsOwned: 9 })['building special'] || 0, 0);
    assert.ok(fateOdds({ failChance: 0.15, buildingsOwned: 10 })['building special'] > 0);
});

// Context for the what-ifs, as in test/unit/grimoire.test.mjs.
const ctx = {
    passive: 1000, click: 500, clicksPerSecond: 50, bank: 1e6, durationMult: 1,
    buildingSpecials: [{ name: 'High-five', mult: 11 }],
    buffs: [],
};
const buff = (name, multCpS, secondsLeft, extra = {}) => ({ name, multCpS, multClick: 1, secondsLeft, ...extra });

test('an outcome leaves its buff running for what comes next, or lengthens its own', () => {
    const [{ weight, ctx: after }] = afterOutcome('frenzy', ctx);
    assert.equal(weight, 1);
    assert.deepEqual(after.buffs.map((b) => [b.name, b.multCpS, b.secondsLeft]), [['Frenzy', 7, 77]]);
    // The running Frenzy keeps its own multiplier and gains the time (main.js:13765-13771).
    const running = afterOutcome('frenzy', { ...ctx, buffs: [buff('Frenzy', 5, 20)] })[0].ctx;
    assert.deepEqual(running.buffs.map((b) => [b.name, b.multCpS, b.secondsLeft]), [['Frenzy', 5, 97]]);
    // Rounded up to whole seconds, as the game grants them (main.js:5561).
    const click = afterOutcome('click frenzy', { ...ctx, durationMult: 1.1 })[0].ctx.buffs[0];
    assert.deepEqual([click.name, click.multClick, click.secondsLeft], ['Click frenzy', 777, 15]);
    // A building special could leave any of its picks.
    const two = afterOutcome('building special', { ...ctx, buildingSpecials: [{ name: 'High-five', mult: 11 }, { name: 'Manabloom', mult: 41 }] });
    assert.deepEqual(two.map((p) => [p.weight, p.ctx.buffs[0].name, p.ctx.buffs[0].multCpS, p.ctx.buffs[0].secondsLeft]), [[0.5, 'High-five', 11, 30], [0.5, 'Manabloom', 41, 30]]);
    // A Lucky leaves its payout in the bank (main.js:5536).
    near(afterOutcome('multiply cookies', ctx)[0].ctx.bank, 1e6 + Math.min(0.15e6, 900 * 1000) + 13);
});

test('a CpS buff also multiplies clicks under a running click frenzy, and a running storm\'s drops', () => {
    // Plastic mouse and its kind add a share of buffed CpS to each click (main.js:4692-4708), and
    // a storm drop pays minutes of buffed CpS (main.js:5599).
    const alone = outcomeValue('frenzy', ctx);
    near(outcomeValue('frenzy', { ...ctx, buffs: [{ name: 'Click frenzy', multCpS: 1, multClick: 777, secondsLeft: 13 }] }) - alone, 500 * 776 * 6 * 13);
    near(outcomeValue('frenzy', { ...ctx, buffs: [{ name: 'Cookie storm', multCpS: 1, multClick: 1, secondsLeft: 7 }] }) - alone, 1000 * 240 * 7.5 * 6 * 7);
});

// A Wizard tower bakery at level 1 with 400 towers: max magic 90, the first cast 64.
const mana = { now: 90, max: 90, costFirst: 64 };
const sale = planSale({ towers: 400, level: 1, left: 26, spell: FATE });
const odds = fateOdds({ failChance: 0.15 });
const good = (outcome) => ({ success: true, outcome });
const double = (first, second, over = {}) =>
    decideDouble({ first: good(first), second: typeof second === 'string' ? good(second) : second, ctx, odds, mana, sale, rebuyLoss: 0, spendable: Infinity, ...over });

test('a click frenzy right after a frenzy is double-cast when the towers are cheap to buy back', () => {
    const out = double('frenzy', 'click frenzy');
    assert.equal(out.action, 'double', out.reason);
    // The click frenzy lands on ×7 instead of on nothing.
    near(out.stacked - out.later, 6 * outcomeValue('click frenzy', ctx));
    near(out.gain, out.stacked - out.later - out.penalty);
});

test('no double cast when buying the towers back costs more than the pair adds', () => {
    const extra = 6 * outcomeValue('click frenzy', ctx);
    assert.equal(double('frenzy', 'click frenzy', { rebuyLoss: extra * 2 }).action, 'single');
    assert.equal(double('frenzy', 'click frenzy', { rebuyLoss: extra * 0.5 }).action, 'double');
});

test('no double cast when the buyer is holding the cookies the towers would be bought back with', () => {
    const out = double('frenzy', 'click frenzy', { rebuyLoss: 1000, spendable: 999 });
    assert.equal(out.action, 'single');
    assert.match(out.reason, /reserve/);
});

test('no double cast without a tower count that leaves the second cast affordable', () => {
    assert.equal(double('frenzy', 'click frenzy', { sale: null }).action, 'single');
});

test('no double cast onto a bad second outcome', () => {
    for (const second of [{ success: false, outcome: 'clot' }, { success: false, outcome: 'ruin cookies' }, good('blab')]) {
        assert.equal(double('frenzy', second).action, 'single', second.outcome);
    }
});

test('a Lucky gains from a frenzy cast before it, not from one cast after it', () => {
    // The Lucky pays at once, on the CpS of that moment (main.js:5536).
    const rich = { ...ctx, bank: 1e12 };
    assert.equal(double('frenzy', 'multiply cookies', { ctx: rich }).action, 'double');
    assert.equal(double('multiply cookies', 'frenzy', { ctx: rich }).action, 'single');
});

test('a sugar lump is cast on its own', () => {
    assert.equal(double('frenzy', 'free sugar lump').action, 'single');
    assert.equal(double('free sugar lump', 'click frenzy').action, 'single');
});

test('the mana a double cast takes from later casts counts against it', () => {
    const out = double('frenzy', 'cookie storm drop');
    assert.ok(out.penalty > 0, `penalty ${out.penalty}`);
    // Clicking worth a hundred times more makes every later cast, and so the delay, worth more,
    // while a storm drop on a frenzy stays worth the same.
    const clicky = { ...ctx, click: 50000 };
    const costly = double('frenzy', 'cookie storm drop', { ctx: clicky });
    assert.ok(costly.penalty > out.penalty * 10);
    assert.equal(costly.action, 'single', costly.reason);
});

test('the second cast\'s building special is valued with the towers the sale leaves', () => {
    // With only Wizard towers at 10 or more, the special after the sale picks ×4.1 instead of ×41.
    const towers = { ...ctx, buildingSpecials: [{ name: 'Manabloom', mult: 41 }] };
    const after = { ...towers, buildingSpecials: [{ name: 'Manabloom', mult: 4.1 }] };
    assert.equal(double('frenzy', 'building special', { ctx: towers, ctxSecond: after }).action, 'single');
    // Among many buildings, losing the towers' pick costs little.
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `B${i}`, mult: 41 }));
    const wide = { ...ctx, buildingSpecials: many.concat([{ name: 'Manabloom', mult: 41 }]) };
    const wideAfter = { ...wide, buildingSpecials: many.concat([{ name: 'Manabloom', mult: 4.1 }]) };
    assert.equal(double('frenzy', 'building special', { ctx: wide, ctxSecond: wideAfter }).action, 'double');
});

test('the first cast\'s building special picks among the buildings as they are before the sale', () => {
    const towers = { ...ctx, buildingSpecials: [{ name: 'Manabloom', mult: 41 }] };
    const after = { ...towers, buildingSpecials: [{ name: 'Manabloom', mult: 4.1 }] };
    const out = double('building special', 'click frenzy', { ctx: towers, ctxSecond: after });
    near(out.stacked, outcomeValue('click frenzy', { ...towers, buffs: [buff('Manabloom', 41, 30)] }));
});
