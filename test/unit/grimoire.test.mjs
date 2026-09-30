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
