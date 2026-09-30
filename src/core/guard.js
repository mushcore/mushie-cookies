/**
 * Error isolation. A guarded function never throws; after `maxFailures` consecutive failures
 * everything sharing its name is switched off until revived.
 */
export function createGuard({ maxFailures = 5, onError = () => {} } = {}) {
    const states = new Map();
    const stateOf = (name) => {
        if (!states.has(name)) {
            states.set(name, { runs: 0, failures: 0, streak: 0, disabled: false, lastError: null });
        }
        return states.get(name);
    };

    function guard(name, fn) {
        const s = stateOf(name);
        return function guarded(...args) {
            if (s.disabled) return undefined;
            try {
                const result = fn.apply(this, args);
                s.runs++;
                s.streak = 0;
                return result;
            } catch (thrown) {
                const error = thrown instanceof Error ? thrown : new Error(String(thrown));
                s.failures++;
                s.streak++;
                s.lastError = error.message;
                if (s.streak >= maxFailures) s.disabled = true;
                try {
                    onError(name, error, s.disabled);
                } catch (reporterError) {
                    // A broken reporter must not defeat the isolation it reports on.
                }
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
    }

    return { guard, status, revive };
}
