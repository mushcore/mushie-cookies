import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeProbabilities } from '../../src/core/goldenPool.js';

const base = {
    wrath: 0, scorn: false, chainEligible: false, fools: false, dragonflightActive: false,
    buildingSpecial: false, lumps: false, reaper: 0, dragonflight: 0,
};
const sum = (p) => Object.values(p).reduce((a, b) => a + b, 0);
const close = (a, b) => Math.abs(a - b) < 1e-12;

test('a plain early-game golden cookie is frenzy or lucky, with a small click frenzy chance', () => {
    const p = outcomeProbabilities(base);
    assert.ok(close(sum(p), 1));
    // Blab is a 1 in 10,000 extra entry; everything else is 90%: [frenzy, lucky], 10%: [frenzy, lucky, click frenzy].
    const blab = 0.0001;
    const expectedFrenzy = (1 - blab) * (0.9 * 0.5 + 0.1 / 3) + blab * (0.9 / 3 + 0.1 / 4);
    assert.ok(close(p['frenzy'], expectedFrenzy), `${p['frenzy']} vs ${expectedFrenzy}`);
    assert.ok(close(p['frenzy'], p['multiply cookies']));
    assert.ok(p['click frenzy'] > 0.03 && p['click frenzy'] < 0.034);
    assert.ok(p['blab'] > 0 && p['blab'] < 0.0001);
});

test('building special appears only with ten buildings', () => {
    assert.equal(outcomeProbabilities(base)['building special'] || 0, 0);
    const p = outcomeProbabilities({ ...base, buildingSpecial: true });
    assert.ok(p['building special'] > 0.07 && p['building special'] < 0.09, String(p['building special']));
});

test('a wrath cookie has clots and ruin, and never plain frenzy', () => {
    const p = outcomeProbabilities({ ...base, wrath: 1, buildingSpecial: true });
    assert.equal(p['frenzy'] || 0, 0);
    for (const name of ['clot', 'ruin cookies', 'blood frenzy', 'cursed finger', 'chain cookie', 'cookie storm']) {
        assert.ok(p[name] > 0, `${name} missing`);
    }
    assert.ok(close(sum(p), 1));
});

test('Skruuia makes clots and ruin four times as likely as lucky', () => {
    const p = outcomeProbabilities({ ...base, wrath: 1, scorn: true });
    assert.ok(p['clot'] > 2.5 * p['multiply cookies']);
});

test('dragon outcomes need their auras', () => {
    assert.equal(outcomeProbabilities(base)['dragon harvest'] || 0, 0);
    assert.equal(outcomeProbabilities(base)['dragonflight'] || 0, 0);
    const p = outcomeProbabilities({ ...base, reaper: 1 });
    // The gate is (golden and 15%) or 5% = 19.25%; inside it the list has three entries, about a third each.
    assert.ok(p['dragon harvest'] > 0.06 && p['dragon harvest'] < 0.065, String(p['dragon harvest']));
    const both = outcomeProbabilities({ ...base, reaper: 1.1, dragonflight: 1.1 });
    // With both auras the two share the gated list, so Dragon Harvest's share falls to about 0.77 of its own.
    assert.ok(both['dragonflight'] > 0 && both['dragon harvest'] > p['dragon harvest'] * 0.7 && both['dragon harvest'] < p['dragon harvest']);
});

test('an active dragonflight makes click frenzy rarer', () => {
    const without = outcomeProbabilities(base)['click frenzy'];
    const during = outcomeProbabilities({ ...base, dragonflightActive: true })['click frenzy'];
    assert.ok(during < without / 10);
});

test('chain and storm need a hundred thousand cookies earned', () => {
    assert.equal(outcomeProbabilities(base)['chain cookie'] || 0, 0);
    const p = outcomeProbabilities({ ...base, chainEligible: true });
    assert.ok(p['chain cookie'] > 0 && close(p['chain cookie'], p['cookie storm']));
});

test('probabilities never depend on the order flags are given', () => {
    const a = outcomeProbabilities({ ...base, buildingSpecial: true, chainEligible: true, lumps: true });
    const b = outcomeProbabilities({ lumps: true, chainEligible: true, buildingSpecial: true, ...base, buildingSpecial: true, chainEligible: true, lumps: true });
    assert.deepEqual(a, b);
});

test('a wrath cookie still rolls for chain and storm when the 30% roll fails', () => {
    const eligible = outcomeProbabilities({ ...base, wrath: 1, chainEligible: true });
    const not = outcomeProbabilities({ ...base, wrath: 1, chainEligible: false });
    assert.ok(eligible['chain cookie'] > not['chain cookie']);
    assert.equal(eligible['blood frenzy'] > 0, true);
});
