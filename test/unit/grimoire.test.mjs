import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeValue, decideCast } from '../../src/core/grimoire.js';

const ctx = {
    passive: 1000, click: 500, clicksPerSecond: 50, bank: 1e6,
    durationMult: 1, buildingSpecialMean: 100, cpsMult: 1, buffSecondsLeft: 0,
};
const mana = { mana: 100, maxMana: 100, fateCost: 70, skipCost: 20 };
const decide = (outcome, over = {}, m = {}) =>
    decideCast({ next: { success: true, outcome }, ...mana, ...m, ctx: { ...ctx, ...over } });

test('outcome values follow the game\'s numbers', () => {
    assert.equal(outcomeValue('frenzy', ctx), 1500 * 6 * 77);
    assert.equal(outcomeValue('click frenzy', ctx), 500 * 776 * 13);
    assert.equal(outcomeValue('multiply cookies', ctx), Math.min(0.15 * 1e6, 900 * 1000) + 13);
    assert.ok(outcomeValue('clot', ctx) < 0);
    assert.ok(outcomeValue('ruin cookies', ctx) < 0);
    assert.equal(outcomeValue('blab', ctx), 0);
    assert.equal(outcomeValue('free sugar lump', ctx), Infinity);
});

test('with autoclick, cursed finger is a gain; without, a loss', () => {
    assert.ok(outcomeValue('cursed finger', ctx) > 0);
    assert.ok(outcomeValue('cursed finger', { ...ctx, clicksPerSecond: 0 }) < 0);
});

test('a running frenzy multiplies what a click frenzy is worth', () => {
    const alone = outcomeValue('click frenzy', ctx);
    const stacked = outcomeValue('click frenzy', { ...ctx, cpsMult: 7, buffSecondsLeft: 60 });
    assert.equal(stacked, alone * 7);
    const endingSoon = outcomeValue('click frenzy', { ...ctx, cpsMult: 7, buffSecondsLeft: 6.5 });
    assert.ok(endingSoon > alone && endingSoon < stacked, 'a buff about to end only partly overlaps');
});

test('a good outcome is cast onto a running buff', () => {
    const out = decide('click frenzy', { cpsMult: 7, buffSecondsLeft: 40 }, { mana: 80 });
    assert.equal(out.action, 'cast');
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
    assert.equal(decide('frenzy', { cpsMult: 7, buffSecondsLeft: 60 }, { mana: 10 }).action, 'wait');
});
