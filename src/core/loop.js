/**
 * Frame-driven scheduler. Each system is isolated by the guard set it is given, so one that
 * throws cannot stop the others.
 */
export function createLoop(guards) {
    const systems = [];

    /** `first`: run before every system added so far (the shimmer system, see src/systems/shimmers.js). */
    function add(name, tick, { everyFrames = 1, enabled = () => true, first = false } = {}) {
        if (systems.some((s) => s.name === name)) throw new Error(`duplicate system: ${name}`);
        if (!Number.isInteger(everyFrames) || everyFrames < 1) {
            throw new Error(`everyFrames must be a positive integer, got ${everyFrames}`);
        }
        const step = guards.guard(name, (frame) => {
            if (enabled()) tick(frame);
        });
        const entry = { name, everyFrames, step };
        if (first) systems.unshift(entry);
        else systems.push(entry);
    }

    function run(frame) {
        // A copy: a system added by a tick, at either end, starts on the next run.
        const list = systems.slice();
        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            if (frame % s.everyFrames === 0) s.step(frame);
        }
    }

    return { add, run };
}
