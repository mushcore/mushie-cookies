/**
 * Error isolation. A guarded function never throws; after `maxFailures` consecutive failures
 * everything sharing its name is switched off.
 *
 * A switched-off name is tried once more after each back-off in `retryFrames` in turn (a try that
 * fails switches it straight back off), and stays off once they are used up, so a lasting fault
 * neither runs nor reports again. A fault of a few ticks used to leave a system off until the page
 * was reloaded: days of unattended play with nothing bought. A name that has stayed up for
 * `forgiveFrames` since its last successful try gets its tries back.
 *
 * `clock` counts frames, not wall time: no timers, and a machine sleep is not a back-off.
 * `onSwitchedOff(name, error, retryFrames)` is called the first time a name is switched off, with
 * the back-offs to come, so one notice can say what will happen next.
 */
export function createGuard({
    maxFailures = 5,
    retryFrames = [],
    forgiveFrames = Infinity,
    clock = () => 0,
    onError = () => {},
    onSwitchedOff = () => {},
} = {}) {
    const states = new Map();
    const stateOf = (name) => {
        if (!states.has(name)) {
            states.set(name, { runs: 0, failures: 0, streak: 0, disabled: false, lastError: null, retries: 0, retryAt: null });
        }
        return states.get(name);
    };
    // Per name, outside the state status() copies: whether it is on trial, since when it has been up
    // after a try, and whether it was ever announced.
    const internals = new Map();
    const internalOf = (name) => {
        if (!internals.has(name)) internals.set(name, { trial: false, upSince: null, announced: false });
        return internals.get(name);
    };

    const quietly = (report) => {
        try {
            report();
        } catch (reporterError) {
            // A broken reporter must not defeat the isolation it reports on.
        }
    };

    function switchOff(name, s, inner, error) {
        s.disabled = true;
        inner.trial = false;
        inner.upSince = null;
        const toCome = retryFrames.slice(s.retries);
        if (toCome.length) {
            s.retryAt = clock() + toCome[0];
            s.retries++;
        } else s.retryAt = null;
        if (!inner.announced) {
            inner.announced = true;
            quietly(() => onSwitchedOff(name, error, toCome));
        }
    }

    function guard(name, fn) {
        const s = stateOf(name);
        const inner = internalOf(name);
        return function guarded(...args) {
            if (s.disabled) {
                if (s.retryAt === null || clock() < s.retryAt) return undefined;
                s.disabled = false;
                s.retryAt = null;
                s.streak = 0;
                inner.trial = true;
            }
            try {
                const result = fn.apply(this, args);
                s.runs++;
                s.streak = 0;
                if (inner.trial) {
                    inner.trial = false;
                    inner.upSince = clock();
                }
                if (inner.upSince !== null && clock() - inner.upSince >= forgiveFrames) {
                    s.retries = 0;
                    inner.upSince = null;
                }
                return result;
            } catch (thrown) {
                const error = thrown instanceof Error ? thrown : new Error(String(thrown));
                s.failures++;
                s.streak++;
                s.lastError = error.message;
                if (inner.trial || s.streak >= maxFailures) switchOff(name, s, inner, error);
                quietly(() => onError(name, error, s.disabled));
                return undefined;
            }
        };
    }

    function status() {
        const out = {};
        for (const [name, s] of states) out[name] = { ...s };
        return out;
    }

    function revive(name) {
        const s = stateOf(name);
        s.disabled = false;
        s.streak = 0;
        s.retries = 0;
        s.retryAt = null;
        internalOf(name).trial = false;
    }

    return { guard, status, revive };
}
