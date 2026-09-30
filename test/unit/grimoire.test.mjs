import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeValue, decideCast } from '../../src/core/grimoire.js';

// What each outcome is worth in cookies is measured against the game itself in
// test/game/fate.test.mjs ('outcome values match what the game grants'); these tests hold the
// logic around those numbers: signs, overlap, and buffs that only lengthen.
const ctx = {
    passive: 1000, click: 500, clicksPerSecond: 50, bank: 1e6, durationMult: 1,
    buildingSpecials: [{ name: 'High-five', mult: 11 }],
    buffs: [],
};
const buff = (name, multCpS, secondsLeft, extra = {}) => ({ name, multCpS, multClick: 1, secondsLeft, ...extra });
const mana = { mana: 100, maxMana: 100, fateCost: 70, skipCost: 20 };
const decide = (outcome, over = {}, m = {}) =>
    decideCast({ next: { success: true, outcome }, ...mana, ...m, ctx: { ...ctx, ...over } });
const value = (outcome, over = {}) => outcomeValue(outcome, { ...ctx, ...over });
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${a} is not ${b}`);

test('bad outcomes are worth less than nothing, a sugar lump more than anything', () => {
    assert.ok(value('clot') < 0);
    assert.ok(value('ruin cookies') < 0);
    assert.equal(value('blab'), 0);
    assert.equal(value('free sugar lump'), Infinity);
    for (const good of ['frenzy', 'click frenzy', 'blood frenzy', 'building special', 'multiply cookies', 'cookie storm', 'cookie storm drop']) {
        assert.ok(value(good) > 0, good);
    }
});

test('with autoclick, cursed finger is a gain; without, a loss', () => {
    assert.ok(value('cursed finger') > 0);
    assert.ok(value('cursed finger', { clicksPerSecond: 0 }) < 0);
});

test('a running frenzy multiplies what a click frenzy is worth', () => {
    const alone = value('click frenzy');
    const stacked = value('click frenzy', { buffs: [buff('Frenzy', 7, 60)] });
    near(stacked, alone * 7);
    const endingSoon = value('click frenzy', { buffs: [buff('Frenzy', 7, 6.5)] });
    assert.ok(endingSoon > alone && endingSoon < stacked, 'a buff about to end only partly overlaps');
});

test('an outcome whose buff is already running only adds time to it', () => {
    // Game.gainBuff keeps the running buff's multiplier and adds the new time (main.js:13765-13771).
    const running = buff('Frenzy', 7, 50);
    near(value('frenzy', { buffs: [running] }), value('frenzy'));
    near(value('blood frenzy', { buffs: [buff('Elder frenzy', 666, 3)] }), value('blood frenzy'));
    near(value('click frenzy', { buffs: [{ name: 'Click frenzy', multCpS: 1, multClick: 777, secondsLeft: 5 }] }), value('click frenzy'));
    near(value('clot', { buffs: [buff('Clot', 0.5, 20)] }), value('clot'));
    // The added time comes after the running buff ends: only what is still running then multiplies it.
    const endsFirst = buff('High-five', 11, 40);
    const outlasts = buff('High-five', 11, 100);
    near(value('frenzy', { buffs: [running, endsFirst] }), value('frenzy'));
    const later = value('frenzy', { buffs: [running, outlasts] });
    assert.ok(later > value('frenzy') && later < value('frenzy') * 11);
});

test('a running cursed finger keeps paying what it paid when it struck', () => {
    const struck = buff('Cursed finger', 0, 4, { power: 123456 });
    const more = value('cursed finger', { buffs: [struck] });
    // The CpS of the added seconds is lost either way; only the payout per click differs.
    const cheap = value('cursed finger', { buffs: [{ ...struck, power: 1 }] });
    near(more - cheap, ctx.clicksPerSecond * 10 * (123456 - 1));
});

test('a building special multiplies another building\'s buff but only lengthens its own', () => {
    const alone = value('building special');
    near(value('building special', { buffs: [buff('High-five', 11, 60)] }), alone);
    near(value('building special', { buffs: [buff('Congregation', 11, 60)] }), alone * 11);
    // Two buildings could be picked: one lengthens the running buff, the other stacks on it.
    const two = [{ name: 'High-five', mult: 11 }, { name: 'Congregation', mult: 11 }];
    near(value('building special', { buildingSpecials: two, buffs: [buff('High-five', 11, 60)] }), (alone + alone * 11) / 2);
});

test('a running building buff keeps its own multiplier, not the one its building would give now', () => {
    // High-five started at 100 cursors (×11); at 200 a new one would be ×21, but the game only adds
    // time to the running one (main.js:13765-13771), so the pick is worth ×11 for 30 s.
    near(
        value('building special', { buildingSpecials: [{ name: 'High-five', mult: 21 }], buffs: [buff('High-five', 11, 60)] }),
        value('building special', { buildingSpecials: [{ name: 'High-five', mult: 11 }] })
    );
});

test('durations are whole seconds, rounded up as the game rounds them', () => {
    // At ×1.1 the game grants a frenzy ceil(84.7) = 85 s and a click frenzy ceil(14.3) = 15 s
    // (main.js:5524, 5561), not 84.7 s and 14.3 s.
    near(value('frenzy', { durationMult: 1.1 }), (value('frenzy') * 85) / 77);
    near(value('click frenzy', { durationMult: 1.1 }), (value('click frenzy') * 15) / 13);
});

test('a building special with no building at 10 or more is a frenzy', () => {
    // The game falls back to a frenzy when no building qualifies (main.js:5501).
    near(value('building special', { buildingSpecials: [] }), value('frenzy'));
});

test('a good outcome is cast onto a running buff', () => {
    const out = decide('click frenzy', { buffs: [buff('Frenzy', 7, 40)] }, { mana: 80 });
    assert.equal(out.action, 'cast');
});

test('a good outcome is not cast onto its own running buff, which it would only lengthen', () => {
    assert.equal(decide('frenzy', { buffs: [buff('Frenzy', 7, 60)] }, { mana: 80 }).action, 'wait');
    assert.equal(decide('building special', { buffs: [buff('High-five', 11, 60)] }, { mana: 80 }).action, 'wait');
    // Another building's buff is something to land on.
    assert.equal(decide('building special', { buffs: [buff('Congregation', 11, 60)] }, { mana: 80 }).action, 'cast');
    // So is a buff that outlasts the running one.
    assert.equal(decide('frenzy', { buffs: [buff('Frenzy', 7, 10), buff('Congregation', 11, 200)] }, { mana: 80 }).action, 'cast');
});

test('a building special is cast onto a buff only if at least half the buildings it may pick land on one', () => {
    // A pick whose building buff is running would only lengthen it; every other pick stacks on it.
    const three = [{ name: 'High-five', mult: 11 }, { name: 'Congregation', mult: 11 }, { name: 'Luxuriant harvest', mult: 11 }];
    const special = (buildingSpecials, buffs) => decide('building special', { buildingSpecials, buffs }, { mana: 80 }).action;
    // Two of three picks land on the running High-five.
    assert.equal(special(three, [buff('High-five', 11, 100)]), 'cast');
    // One of two is half.
    assert.equal(special([three[0], three[2]], [buff('High-five', 11, 100)]), 'cast');
    // One of three is not: High-five and Congregation would each only lengthen their own.
    assert.equal(special(three, [buff('High-five', 11, 100), buff('Congregation', 11, 100)]), 'wait');
});

test('a good outcome is held for a buff while mana is still filling', () => {
    assert.equal(decide('click frenzy', {}, { mana: 80 }).action, 'wait');
});

test('with mana full, a good outcome is cast rather than wasting regeneration', () => {
    assert.equal(decide('click frenzy', {}, { mana: 100 }).action, 'cast');
});

test('a bad outcome is skipped with the cheap spell, once a cast would be possible', () => {
    const backfire = { success: false, outcome: 'ruin cookies' };
    assert.equal(decideCast({ next: backfire, ...mana, mana: 75, ctx }).action, 'skip');
    assert.equal(decideCast({ next: backfire, ...mana, mana: 50, ctx }).action, 'wait', 'not until a real cast could follow');
});

test('a free sugar lump is cast at once', () => {
    assert.equal(decide('free sugar lump', {}, { mana: 70 }).action, 'cast');
});

test('not enough mana means wait', () => {
    assert.equal(decide('frenzy', { buffs: [buff('Congregation', 11, 60)] }, { mana: 10 }).action, 'wait');
});

// A Cursed finger stops CpS (multCpS 0, main.js:13932, 5159) and pays each click its own power
// instead of the click's (4744), so under one a storm or storm drop pays nothing, a Lucky 13
// cookies (5536), and a click frenzy nothing once the finger outlasts its 13 s.
const finger = (secondsLeft) => buff('Cursed finger', 0, secondsLeft, { power: 1 });

test('a good outcome is held through a Cursed finger, never burnt, full mana or not', () => {
    for (const outcome of ['cookie storm', 'cookie storm drop', 'click frenzy', 'multiply cookies', 'frenzy', 'building special']) {
        for (const m of [80, 100]) {
            const out = decide(outcome, { buffs: [finger(14)] }, { mana: m });
            assert.equal(out.action, 'wait', `${outcome} at ${m} mana: ${out.action}, ${out.reason}`);
            assert.match(out.reason, /until Cursed finger ends/);
        }
    }
    // A backfire worth having is held the same way.
    const blood = decideCast({ next: { success: false, outcome: 'blood frenzy' }, ...mana, ctx: { ...ctx, buffs: [finger(14)] } });
    assert.equal(blood.action, 'wait');
});

test('once the debuff has ended, the held outcome is cast', () => {
    for (const outcome of ['cookie storm', 'cookie storm drop', 'click frenzy', 'multiply cookies']) {
        assert.equal(decide(outcome, {}, { mana: 100 }).action, 'cast', outcome);
    }
});

test('a good outcome is burnt only if it is worthless whenever it is cast', () => {
    // Nothing clicks, so a click frenzy is worth nothing with or without the finger; blab never is.
    assert.equal(decide('click frenzy', { click: 0, buffs: [finger(14)] }).action, 'skip');
    assert.equal(decide('blab', { buffs: [finger(14)] }).action, 'skip');
    // A bad outcome stays bad after the finger.
    const backfire = (outcome) => decideCast({ next: { success: false, outcome }, ...mana, ctx: { ...ctx, buffs: [finger(14)] } }).action;
    assert.equal(backfire('clot'), 'skip');
    assert.equal(backfire('ruin cookies'), 'skip');
});

test('a debuff beside a boost: the outcome waits for the debuff to end while the boost runs on', () => {
    // Now the click frenzy would land on ×7 halved for 10 of its 13 s; in 10 s, on ×7 throughout.
    const out = decide('click frenzy', { buffs: [buff('Frenzy', 7, 60), buff('Clot', 0.5, 10)] }, { mana: 80 });
    assert.equal(out.action, 'wait');
    // A boost that ends with the debuff leaves nothing better to wait for.
    assert.equal(decide('click frenzy', { buffs: [buff('Frenzy', 7, 10), buff('Clot', 0.5, 10)] }, { mana: 100 }).action, 'cast');
});

test('with mana full, a debuff is waited out only when it ends soon enough to be worth the lost regeneration', () => {
    // A clot halves a frenzy for 66 of its 77 s; 66 s of regeneration is a small part of a cast.
    assert.equal(decide('frenzy', { buffs: [buff('Clot', 0.5, 66)] }, { mana: 100 }).action, 'wait');
    // A modest loan's interest quarters CpS for 4 hours (minigameMarket.js:350): holding a full
    // grimoire through it would lose many casts' worth of regeneration.
    const interest = buff('Loan 1 (interest)', 0.25, 4 * 3600);
    assert.equal(decide('frenzy', { buffs: [interest] }, { mana: 100 }).action, 'cast');
    assert.equal(decide('multiply cookies', { buffs: [interest] }, { mana: 100 }).action, 'cast');
});

// With a Cursed finger beside a long debuff (loan interest, a 15-minute clot), the finger is
// still waited out: the end to wait for is the one worth most net of the wait, not the latest.
const interest = (secondsLeft, mult) => buff('Loan 1 (interest)', mult, secondsLeft);

test('beside a long debuff, a good outcome still waits out the Cursed finger at full mana', () => {
    for (const long of [interest(14400, 0.25), interest(2400, 0.1), buff('Clot', 0.5, 900)]) {
        for (const outcome of ['multiply cookies', 'building special', 'frenzy']) {
            const out = decide(outcome, { bank: 1e12, buffs: [finger(14), long] });
            assert.equal(out.action, 'wait', `${outcome} beside ${long.name}: ${out.reason}`);
            assert.match(out.reason, /until Cursed finger ends/, `${outcome} beside ${long.name}`);
        }
    }
});

test('an outcome worth nothing under the finger names the finger it waits for, not the longest debuff', () => {
    const out = decide('cookie storm drop', { buffs: [finger(14), interest(14400, 0.25)] });
    assert.equal(out.action, 'wait');
    assert.match(out.reason, /until Cursed finger ends/);
});

test('with only a long debuff running and mana full, the cast is not held for hours', () => {
    const out = decide('frenzy', { buffs: [interest(14400, 0.25)] });
    assert.equal(out.action, 'cast', out.reason);
});
