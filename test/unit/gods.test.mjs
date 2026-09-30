import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    chooseAura,
    inheritedGodsOn,
    inheritedAurasOn,
    AURA_GAIN,
    lindyHorizon,
    auraHorizon,
    RETURN_BLOCK_SECONDS,
    SKIP_GODS,
    pinnedSlots,
    goldenCookiesClicked,
} from '../../src/core/gods.js';

test('a god the system never slots, put in a slot by the player, keeps it', () => {
    // Keys of the Pantheon's gods table (minigamePantheon.js:12-116).
    assert.deepEqual([...SKIP_GODS].sort(), ['ages', 'asceticism', 'order', 'ruin']);
    assert.deepEqual(pinnedSlots(['order', 'asceticism', null], false), [true, true, false]);
    assert.deepEqual(pinnedSlots(['ruin', 'ages', 'industry'], false), [true, true, false]);
    assert.deepEqual(pinnedSlots(['industry', 'mother', 'labor'], false), [false, false, false]);
    // Except Holobore while golden cookies are clicked: the next click unslots him and takes every
    // swap (main.js:5419-5422).
    assert.deepEqual(pinnedSlots(['order', 'asceticism', null], true), [true, false, false]);
    assert.deepEqual(pinnedSlots(['asceticism', 'ruin', 'ages'], true), [false, true, true]);
    assert.deepEqual(pinnedSlots([null, null, null], true), [false, false, false]);
});

test('golden cookies are clicked when an option clicks them and something makes them', () => {
    assert.equal(goldenCookiesClicked({}, true), false);
    assert.equal(goldenCookiesClicked({ autoGC: 1 }, true), true);
    assert.equal(goldenCookiesClicked({ autoFate: 1 }, true), true);
    // With the Golden switch on none spawns on its own...
    assert.equal(goldenCookiesClicked({ autoGC: 1 }, false), false);
    // ...but Force the Hand of Fate makes one: forecast casting clicks its own, and golden cookie
    // clicking clicks those the inherited casting modes cast.
    assert.equal(goldenCookiesClicked({ autoFate: 1 }, false), true);
    assert.equal(goldenCookiesClicked({ autoGC: 1, autoCasting: 3 }, false), true);
    assert.equal(goldenCookiesClicked({ autoGC: 0, autoCasting: 3 }, false), false, 'nothing clicks what the inherited modes cast');
    // Forecast casting stands aside for the inherited casting modes and the 100% combo.
    assert.equal(goldenCookiesClicked({ autoFate: 1, autoCasting: 2 }, false), false);
    assert.equal(goldenCookiesClicked({ autoFate: 1, auto100ConsistencyCombo: 1 }, false), false);
    // Double Cast FTHOF is forecast casting with double casts, on its own switch or beside it.
    assert.equal(goldenCookiesClicked({ autoFate: 1, autoFTHOFCombo: 1 }, false), true);
    assert.equal(goldenCookiesClicked({ autoFTHOFCombo: 1 }, false), true);
    // A setting missing from an old save is off.
    assert.equal(goldenCookiesClicked({ autoGC: undefined, autoFate: undefined }, true), false);
});

test('stands aside for every inherited option that slots gods or picks auras, and only for those', () => {
    const off = {};
    assert.equal(inheritedGodsOn(off), false);
    assert.equal(inheritedAurasOn(off), false);
    // [setting, value, pantheon left alone, auras left alone]
    const cases = [
        ['autoWorshipToggle', 1, true, false],
        ['autoCyclius', 1, true, false],
        ['autoCyclius', 2, true, false], // Cyclius in all three slots
        ['autoSL', 2, true, false], // Auto Rigidel
        ['autoSL', 1, false, false], // plain harvesting touches neither
        ['autoGodzamok', 1, true, false],
        ['autoDragonToggle', 1, false, true],
        ['dragonsCurve', 1, false, true],
        ['dragonsCurve', 2, false, true],
        ['autoDragonOrbs', 1, false, true],
        ['auto100ConsistencyCombo', 1, true, true],
        // The double cast is forecast casting's (src/systems/grimoire.js): it reads no god or aura.
        ['autoFTHOFCombo', 1, false, false],
    ];
    for (const [name, value, gods, auras] of cases) {
        const settings = { [name]: value };
        assert.equal(inheritedGodsOn(settings), gods, `${name}=${value}: pantheon`);
        assert.equal(inheritedAurasOn(settings), auras, `${name}=${value}: auras`);
    }
    // A setting missing from an old save is off, not "not zero".
    assert.equal(inheritedAurasOn({ dragonsCurve: undefined }), false);
});

// Income 100 now; each move: income with the aura and every building (gross), income once the
// highest building is sacrificed too (net), and that building's price to buy it back.
const move = (over) => ({ slot: 0, id: 1, name: 'A', gross: 110, net: 108, rebuy: 1000, ...over });
const HOUR = 3600;

test('an aura switch must add more than the band even before the sacrificed building is rebought', () => {
    assert.equal(chooseAura({ now: 100, moves: [move({ gross: 103, net: 101.5 })], horizonSeconds: HOUR, t: 0 }), null);
    const out = chooseAura({ now: 100, moves: [move({ gross: 103, net: 102.5 })], horizonSeconds: HOUR, t: 0 });
    assert.equal(out.id, 1);
    assert.ok(Math.abs(out.gain - 0.025) < 1e-12);
    assert.ok(AURA_GAIN > 0 && AURA_GAIN < 0.025);
});

test('an aura switch must earn back the sacrificed building within the horizon', () => {
    // +10 a second pays back 36,000 in exactly an hour.
    const pays = move({ gross: 110, net: 108, rebuy: 36000 });
    assert.equal(chooseAura({ now: 100, moves: [pays], horizonSeconds: HOUR, t: 0 }).id, 1);
    const slow = move({ gross: 110, net: 108, rebuy: 36001 });
    assert.equal(chooseAura({ now: 100, moves: [slow], horizonSeconds: HOUR, t: 0 }), null);
    assert.equal(chooseAura({ now: 100, moves: [slow], horizonSeconds: 2 * HOUR, t: 0 }).id, 1, 'the horizon is an option');
    assert.equal(chooseAura({ now: 100, moves: [move({ rebuy: 0 })], horizonSeconds: 0, t: 0 }).id, 1, 'with no building, a switch is free');
});

test('the horizon is the time the run is expected to last: as long as it has lasted, and at least an hour', () => {
    assert.equal(lindyHorizon(0), HOUR);
    assert.equal(lindyHorizon(20 * 60), HOUR);
    assert.equal(lindyHorizon(5 * HOUR), 5 * HOUR);
    // The option is a number of seconds, or a function of the run's age in seconds.
    assert.equal(auraHorizon(lindyHorizon, 5 * HOUR), 5 * HOUR);
    assert.equal(auraHorizon(lindyHorizon, 60), HOUR);
    assert.equal(auraHorizon(2 * HOUR, 5 * HOUR), 2 * HOUR);
    assert.equal(auraHorizon((age) => age / 2, 5 * HOUR), 2.5 * HOUR);
});

test('an endless horizon or a zero horizon is taken at its word', () => {
    // Endless: any switch that adds income once its building is rebought pays for it...
    assert.equal(chooseAura({ now: 100, moves: [move({ rebuy: 1e300 })], horizonSeconds: Infinity, t: 0 }).id, 1);
    // ...and one that adds nothing then never does. (0 × Infinity is NaN; a gross at or below
    // income now is not a state the game gives here, but the rule must not rest on NaN.)
    assert.equal(chooseAura({ now: 100, moves: [move({ gross: 100, net: 103 })], horizonSeconds: Infinity, t: 0 }), null);
    assert.equal(chooseAura({ now: 100, moves: [move({ gross: 99, net: 103 })], horizonSeconds: Infinity, t: 0 }), null);
    // Zero: only a switch that sacrifices nothing.
    assert.equal(chooseAura({ now: 100, moves: [move({ rebuy: 1e-9 })], horizonSeconds: 0, t: 0 }), null);
    assert.equal(chooseAura({ now: 100, moves: [move({ rebuy: 0 })], horizonSeconds: 0, t: 0 }).id, 1);
});

test('takes the qualifying switch that adds the most, in either slot', () => {
    const moves = [
        move({ id: 1, name: 'A', net: 105 }),
        move({ slot: 1, id: 2, name: 'B', gross: 115, net: 112 }),
        move({ id: 3, name: 'C', gross: 130, net: 125, rebuy: 1e9 }), // best, but never pays back
    ];
    const out = chooseAura({ now: 100, moves, horizonSeconds: HOUR, t: 0 });
    assert.deepEqual([out.slot, out.name], [1, 'B']);
});

test('two auras within noise of each other never alternate', () => {
    // The dead band: from A, B measured 1.9% better is left alone; after a switch to B, A measured
    // 1.9% better is left alone too.
    assert.equal(chooseAura({ now: 100, moves: [move({ id: 2, gross: 102, net: 101.9 })], horizonSeconds: HOUR, t: 0 }), null);
    assert.equal(chooseAura({ now: 101.9, moves: [move({ id: 1, gross: 104, net: 103.8 })], horizonSeconds: HOUR, t: 0 }), null);
    // Noise larger than the band: the switch from A to B was made at t=0. A measuring 3% better a
    // minute later is not taken back until the return block (an hour by default) has passed.
    const recent = { 0: { left: 1, at: 0 } };
    const back = move({ id: 1, gross: 104, net: 103 });
    assert.equal(RETURN_BLOCK_SECONDS, HOUR);
    assert.equal(chooseAura({ now: 100, moves: [back], horizonSeconds: 10 * HOUR, t: 60, recent }), null);
    assert.equal(chooseAura({ now: 100, moves: [back], horizonSeconds: 10 * HOUR, t: HOUR, recent }).id, 1);
    // Only the aura left, and only in that slot, waits.
    assert.equal(chooseAura({ now: 100, moves: [move({ id: 3, gross: 104, net: 103 })], horizonSeconds: 10 * HOUR, t: 60, recent }).id, 3);
    assert.equal(chooseAura({ now: 100, moves: [{ ...back, slot: 1 }], horizonSeconds: 10 * HOUR, t: 60, recent }).id, 1);
});

test('the block on going back is its own option, apart from the horizon', () => {
    const recent = { 0: { left: 1, at: 0 } };
    const back = move({ id: 1, gross: 104, net: 103, rebuy: 100 });
    const choose = (horizonSeconds, returnBlockSeconds, t) => chooseAura({ now: 100, moves: [back], horizonSeconds, returnBlockSeconds, t, recent });
    // An endless horizon does not block going back forever.
    assert.equal(choose(Infinity, HOUR, 60), null);
    assert.equal(choose(Infinity, HOUR, HOUR).id, 1);
    // A long block with a short horizon still blocks.
    assert.equal(choose(HOUR, 10 * HOUR, 2 * HOUR), null);
    assert.equal(choose(HOUR, 10 * HOUR, 10 * HOUR).id, 1);
    // No block: going back at once is allowed. An endless block: never.
    assert.equal(choose(HOUR, 0, 0).id, 1);
    assert.equal(choose(HOUR, Infinity, 1e12), null);
});
