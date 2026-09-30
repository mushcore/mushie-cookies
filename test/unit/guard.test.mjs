import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuard } from '../../src/core/guard.js';

test('passes arguments, this and the return value through', () => {
    const { guard } = createGuard();
    const obj = {
        base: 10,
        add: guard('add', function (a, b) {
            return this.base + a + b;
        }),
    };
    assert.equal(obj.add(1, 2), 13);
});

test('a throwing function returns undefined and is counted', () => {
    const seen = [];
    const { guard, status } = createGuard({
        onError: (name, error, disabled) => seen.push([name, error.message, disabled]),
    });
    const boom = guard('boom', () => {
        throw new Error('nope');
    });
    assert.equal(boom(), undefined);
    assert.deepEqual(seen, [['boom', 'nope', false]]);
    assert.deepEqual(status().boom, { runs: 0, failures: 1, streak: 1, disabled: false, lastError: 'nope' });
});

test('disables after maxFailures consecutive failures and stops calling', () => {
    let calls = 0;
    const { guard, status } = createGuard({ maxFailures: 3 });
    const boom = guard('boom', () => {
        calls++;
        throw new Error('x');
    });
    for (let i = 0; i < 10; i++) boom();
    assert.equal(calls, 3);
    assert.equal(status().boom.disabled, true);
});

test('a success resets the streak', () => {
    let fail = true;
    const { guard, status } = createGuard({ maxFailures: 3 });
    const flaky = guard('flaky', () => {
        if (fail) throw new Error('x');
        return 'ok';
    });
    flaky();
    flaky();
    fail = false;
    assert.equal(flaky(), 'ok');
    fail = true;
    flaky();
    flaky();
    assert.equal(status().flaky.disabled, false);
    assert.equal(status().flaky.failures, 4);
});

test('revive re-enables a disabled name', () => {
    let fail = true;
    const { guard, status, revive } = createGuard({ maxFailures: 1 });
    const f = guard('f', () => {
        if (fail) throw new Error('x');
        return 1;
    });
    f();
    assert.equal(status().f.disabled, true);
    fail = false;
    revive('f');
    assert.equal(f(), 1);
});

test('two functions under one name share a breaker', () => {
    const { guard, status } = createGuard({ maxFailures: 2 });
    const a = guard('shared', () => {
        throw new Error('a');
    });
    const b = guard('shared', () => {
        throw new Error('b');
    });
    a();
    b();
    assert.equal(status().shared.disabled, true);
});

test('a non-Error throw is reported as a string', () => {
    const { guard, status } = createGuard();
    guard('s', () => {
        throw 'plain';
    })();
    assert.equal(status().s.lastError, 'plain');
});

test('an onError that throws does not escape', () => {
    const { guard } = createGuard({
        onError: () => {
            throw new Error('reporter broke');
        },
    });
    assert.doesNotThrow(
        guard('x', () => {
            throw new Error('x');
        })
    );
});

test('status is a copy: changing it does not change the breaker', () => {
    const { guard, status } = createGuard({ maxFailures: 1 });
    const f = guard('f', () => 1);
    status().f.disabled = true;
    assert.equal(f(), 1);
});
