import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuard } from '../../src/core/guard.js';
import { createLoop } from '../../src/core/loop.js';

test('runs systems on their own cadence', () => {
    const loop = createLoop(createGuard());
    const ran = { every: 0, third: 0 };
    loop.add('every', () => ran.every++);
    loop.add('third', () => ran.third++, { everyFrames: 3 });
    for (let frame = 1; frame <= 9; frame++) loop.run(frame);
    assert.deepEqual(ran, { every: 9, third: 3 });
});

test('passes the frame number to the tick', () => {
    const loop = createLoop(createGuard());
    const seen = [];
    loop.add('s', (frame) => seen.push(frame), { everyFrames: 2 });
    for (let frame = 1; frame <= 6; frame++) loop.run(frame);
    assert.deepEqual(seen, [2, 4, 6]);
});

test('a failing system does not stop the ones after it', () => {
    const guards = createGuard({ maxFailures: 5 });
    const loop = createLoop(guards);
    let after = 0;
    loop.add('bad', () => {
        throw new Error('bad');
    });
    loop.add('good', () => after++);
    for (let frame = 1; frame <= 20; frame++) loop.run(frame);
    assert.equal(after, 20);
    assert.equal(guards.status().bad.disabled, true);
    assert.equal(guards.status().bad.failures, 5);
});

test('a system switched off by its setting is skipped and not counted as a failure', () => {
    const guards = createGuard();
    const loop = createLoop(guards);
    let on = false;
    let ran = 0;
    loop.add('opt', () => ran++, { enabled: () => on });
    loop.run(1);
    on = true;
    loop.run(2);
    assert.equal(ran, 1);
    assert.equal(guards.status().opt.failures, 0);
});

test('a throwing enabled check is isolated like a throwing tick', () => {
    const guards = createGuard();
    const loop = createLoop(guards);
    let after = 0;
    loop.add('bad', () => {}, {
        enabled: () => {
            throw new Error('check broke');
        },
    });
    loop.add('good', () => after++);
    loop.run(1);
    assert.equal(after, 1);
    assert.equal(guards.status().bad.failures, 1);
});

test('rejects duplicate names and bad cadences', () => {
    const loop = createLoop(createGuard());
    loop.add('a', () => {});
    assert.throws(() => loop.add('a', () => {}), /duplicate/);
    assert.throws(() => loop.add('b', () => {}, { everyFrames: 0 }), /everyFrames/);
    assert.throws(() => loop.add('c', () => {}, { everyFrames: 1.5 }), /everyFrames/);
});

test('a system added during a run starts on the next run', () => {
    const loop = createLoop(createGuard());
    let late = 0;
    loop.add('adder', (frame) => {
        if (frame === 1) loop.add('late', () => late++);
    });
    loop.run(1);
    assert.equal(late, 0);
    loop.run(2);
    assert.equal(late, 1);
});
