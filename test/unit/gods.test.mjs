import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseAura, inheritedGodsOn, inheritedAurasOn, AURA_GAIN } from '../../src/core/gods.js';

test('stands aside for every inherited option that slots gods or picks auras, and only for those', () => {
    const off = {};
    assert.equal(inheritedGodsOn(off), false);
    assert.equal(inheritedAurasOn(off), false);
    // [setting, value, pantheon left alone, auras left alone]
    const cases = [
        ['autoWorshipToggle', 1, true, false],
        ['autoCyclius', 1, true, false],
        ['autoCyclius', 2, true, false], // Cyclius in all three slots
        ['autoSL', 1, false, false], // the lump system's harvest touches neither
        ['autoGodzamok', 1, true, false],
        ['autoDragonToggle', 1, false, true],
        ['autoDragonOrbs', 1, false, true],
        ['auto100ConsistencyCombo', 1, true, true],
        ['autoFTHOFCombo', 1, true, true],
    ];
    for (const [name, value, gods, auras] of cases) {
        const settings = { [name]: value };
        assert.equal(inheritedGodsOn(settings), gods, `${name}=${value}: pantheon`);
        assert.equal(inheritedAurasOn(settings), auras, `${name}=${value}: auras`);
    }
    // A setting missing from an old save is off, not "not zero".
    assert.equal(inheritedAurasOn({ autoDragonToggle: undefined }), false);
});

// Income 100 now; each move: income with the aura and every building (gross), income once the
// highest building is sacrificed too (net), and that building's price to buy it back.
const move = (over) => ({ slot: 0, id: 1, name: 'A', gross: 110, net: 108, rebuy: 1000, ...over });
const HOUR = 3600;

test('an aura switch must add more than the band even before the sacrificed building is rebought', () => {
    assert.equal(chooseAura({ now: 100, moves: [move({ gross: 103, net: 101.5 })], paybackSeconds: HOUR, t: 0 }), null);
    const out = chooseAura({ now: 100, moves: [move({ gross: 103, net: 102.5 })], paybackSeconds: HOUR, t: 0 });
    assert.equal(out.id, 1);
    assert.ok(Math.abs(out.gain - 0.025) < 1e-12);
    assert.ok(AURA_GAIN > 0 && AURA_GAIN < 0.025);
});

test('an aura switch must earn back the sacrificed building within the payback time', () => {
    // +10 a second pays back 36,000 in exactly an hour.
    const pays = move({ gross: 110, net: 108, rebuy: 36000 });
    assert.equal(chooseAura({ now: 100, moves: [pays], paybackSeconds: HOUR, t: 0 }).id, 1);
    const slow = move({ gross: 110, net: 108, rebuy: 36001 });
    assert.equal(chooseAura({ now: 100, moves: [slow], paybackSeconds: HOUR, t: 0 }), null);
    assert.equal(chooseAura({ now: 100, moves: [slow], paybackSeconds: 2 * HOUR, t: 0 }).id, 1, 'the payback time is an option');
    assert.equal(chooseAura({ now: 100, moves: [move({ rebuy: 0 })], paybackSeconds: 0, t: 0 }).id, 1, 'with no building, a switch is free');
});

test('takes the qualifying switch that adds the most, in either slot', () => {
    const moves = [
        move({ id: 1, name: 'A', net: 105 }),
        move({ slot: 1, id: 2, name: 'B', gross: 115, net: 112 }),
        move({ id: 3, name: 'C', gross: 130, net: 125, rebuy: 1e9 }), // best, but never pays back
    ];
    const out = chooseAura({ now: 100, moves, paybackSeconds: HOUR, t: 0 });
    assert.deepEqual([out.slot, out.name], [1, 'B']);
});

test('two auras within noise of each other never alternate', () => {
    // The dead band: from A, B measured 1.9% better is left alone; after a switch to B, A measured
    // 1.9% better is left alone too.
    assert.equal(chooseAura({ now: 100, moves: [move({ id: 2, gross: 102, net: 101.9 })], paybackSeconds: HOUR, t: 0 }), null);
    assert.equal(chooseAura({ now: 101.9, moves: [move({ id: 1, gross: 104, net: 103.8 })], paybackSeconds: HOUR, t: 0 }), null);
    // Noise larger than the band: the switch from A to B was made at t=0. A measuring 3% better a
    // minute later is not taken back until the switch has had its payback time to earn out.
    const recent = { 0: { left: 1, at: 0 } };
    const back = move({ id: 1, gross: 104, net: 103 });
    assert.equal(chooseAura({ now: 100, moves: [back], paybackSeconds: HOUR, t: 60, recent }), null);
    assert.equal(chooseAura({ now: 100, moves: [back], paybackSeconds: HOUR, t: HOUR, recent }).id, 1);
    // Only the aura left, and only in that slot, waits.
    assert.equal(chooseAura({ now: 100, moves: [move({ id: 3, gross: 104, net: 103 })], paybackSeconds: HOUR, t: 60, recent }).id, 3);
    assert.equal(chooseAura({ now: 100, moves: [{ ...back, slot: 1 }], paybackSeconds: HOUR, t: 60, recent }).id, 1);
});
