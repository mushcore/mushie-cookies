// The wrinkler state the income model is given (src/game/wrinklers.js), on a stand-in game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrinklerModel, telemetry } from '../../src/game/wrinklers.js';

/** Grandmapocalypse, ten slots, `inPlay` of them attached; Unholy bait or not. */
function fakeGame({ unholy = false, inPlay = 10 } = {}) {
    const wrinklers = [];
    for (let i = 0; i < 10; i++) wrinklers.push({ id: i, phase: i < inPlay ? 2 : 0, hp: 3, sucked: 1e9, type: 0 });
    return {
        fps: 30,
        elderWrath: 3,
        wrinklers,
        getWrinklersMax: () => 10,
        Has: (name) => (name === 'Unholy bait' ? unholy : false),
        auraMult: () => 0,
        eff: () => 1,
        hasGod: () => 0,
    };
}

function withTelemetry(values, run) {
    const saved = { ...telemetry };
    Object.assign(telemetry, values);
    try {
        return run();
    } finally {
        for (const key of Object.keys(telemetry)) delete telemetry[key];
        Object.assign(telemetry, saved);
    }
}

test('during a hunt, the wrinklers kept without it are those the hunt emptied, not the empty slots', () => {
    const settings = { autoWrinkler: 1 };
    for (const unholy of [true, false]) {
        const outside = withTelemetry({ popRate: 0, hunting: false }, () => wrinklerModel(fakeGame({ unholy, inPlay: 10 }), settings));
        assert.equal(outside.count, 10);
        // The hunt began with all ten in play and has popped them all.
        const during = withTelemetry({ popRate: 0, hunting: true, kept: 10 }, () => ({
            kept: wrinklerModel(fakeGame({ unholy, inPlay: 0 }), settings, { kept: true }),
            now: wrinklerModel(fakeGame({ unholy, inPlay: 0 }), settings),
        }));
        assert.equal(during.kept.count, outside.count, `unholy bait ${unholy}: ${during.kept.count} kept during the hunt, ${outside.count} outside`);
        assert.equal(during.kept.returnMult, outside.returnMult);
        assert.equal(during.now.count, 0, 'the income of the moment still has none while the hunt pops them');
        // Paused (the hunt does not pay for a while) with two back in play: the same kept basis,
        // while the income of the moment counts the two and their refill.
        const paused = withTelemetry({ popRate: 0, hunting: false, kept: 10 }, () => ({
            kept: wrinklerModel(fakeGame({ unholy, inPlay: 2 }), settings, { kept: true }),
            now: wrinklerModel(fakeGame({ unholy, inPlay: 2 }), settings),
        }));
        assert.equal(paused.kept.count, outside.count);
        assert.ok(paused.now.count > 2 && paused.now.count < 10, `${paused.now.count}`);
    }
});

test('with popping off, a hunt\'s record is not used', () => {
    const out = withTelemetry({ popRate: 0, hunting: true, kept: 10 }, () => wrinklerModel(fakeGame({ inPlay: 3 }), { autoWrinkler: 0 }, { kept: true }));
    assert.equal(out.returnMult, 0);
    assert.ok(out.count < 10 && out.count > 3, `${out.count}: refilling from the 3 in play`);
});
