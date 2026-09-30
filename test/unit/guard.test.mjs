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
    assert.deepEqual(status().boom, { runs: 0, failures: 1, streak: 1, disabled: false, lastError: 'nope', retries: 0, retryAt: null });
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

/** A frame clock the test moves by hand, as the loop's frame for the guard. */
function frames() {
    let now = 0;
    return { clock: () => now, to: (frame) => (now = frame) };
}

test('a system switched off is tried again after each back-off, then left off once they are used up', () => {
    // A fault lasting a few ticks (half a second for the buyer) used to switch a system off until
    // the page was reloaded: days of unattended play with nothing bought.
    const time = frames();
    let calls = 0;
    const { guard, status } = createGuard({ maxFailures: 2, retryFrames: [10, 50], clock: time.clock });
    const boom = guard('boom', () => {
        calls++;
        throw new Error('x');
    });
    boom();
    time.to(1);
    boom();
    assert.equal(status().boom.disabled, true);
    assert.equal(status().boom.retryAt, 11);
    time.to(10);
    boom();
    assert.equal(calls, 2, 'nothing runs before its back-off is over');
    time.to(11);
    boom();
    assert.equal(calls, 3, 'one try when it is');
    assert.equal(status().boom.disabled, true, 'a failed try switches it straight back off');
    assert.equal(status().boom.retryAt, 61, 'with the next, longer back-off');
    time.to(61);
    boom();
    assert.equal(calls, 4);
    assert.equal(status().boom.retryAt, null, 'the tries are used up');
    for (let frame = 62; frame < 100000; frame += 1000) {
        time.to(frame);
        boom();
    }
    assert.equal(calls, 4, 'a persistent fault is left off');
});

test('a try that succeeds switches the system back on', () => {
    const time = frames();
    let fail = true;
    const { guard, status } = createGuard({ maxFailures: 2, retryFrames: [10], clock: time.clock });
    const flaky = guard('flaky', () => {
        if (fail) throw new Error('x');
        return 'ok';
    });
    flaky();
    flaky();
    fail = false;
    time.to(9);
    assert.equal(flaky(), undefined);
    time.to(10);
    assert.equal(flaky(), 'ok');
    assert.equal(status().flaky.disabled, false);
    assert.equal(flaky(), 'ok');
});

test('a system that stays up long enough after a try gets its tries back', () => {
    const time = frames();
    let fail = true;
    const { guard, status } = createGuard({ maxFailures: 1, retryFrames: [10], forgiveFrames: 100, clock: time.clock });
    const f = guard('f', () => {
        if (fail) throw new Error('x');
        return 1;
    });
    f();
    fail = false;
    time.to(10);
    f();
    time.to(50);
    f();
    assert.equal(status().f.retries, 1, 'not yet: up for 40 frames');
    time.to(110);
    f();
    assert.equal(status().f.retries, 0, 'up for 100 frames: forgiven');
    fail = true;
    f();
    assert.equal(status().f.retryAt, 120, 'a new fault starts over at the first back-off');
});

test('being switched off is announced once for each name, however often it recurs', () => {
    const time = frames();
    const notices = [];
    const { guard } = createGuard({
        maxFailures: 1,
        retryFrames: [10, 20],
        clock: time.clock,
        onSwitchedOff: (name, error, retryFrames) => notices.push([name, error.message, retryFrames]),
    });
    const boom = guard('boom', () => {
        throw new Error('broken');
    });
    for (let frame = 0; frame < 1000; frame++) {
        time.to(frame);
        boom();
    }
    assert.deepEqual(notices, [['boom', 'broken', [10, 20]]], 'with the back-offs to come, so the notice can say what happens next');
    guard('other', () => {
        throw new Error('also broken');
    })();
    assert.equal(notices.length, 2, 'another system gets its own notice');
});

test('a notice that throws does not escape', () => {
    const { guard } = createGuard({
        maxFailures: 1,
        onSwitchedOff: () => {
            throw new Error('notice broke');
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
