/**
 * Frame-driven scheduler. Each system is isolated by the guard set it is given, so one that
 * throws cannot stop the others.
 */
export function createLoop(guards) {
    const systems = [];

    function add(name, tick, { everyFrames = 1, enabled = () => true } = {}) {
        if (systems.some((s) => s.name === name)) throw new Error(`duplicate system: ${name}`);
        if (!Number.isInteger(everyFrames) || everyFrames < 1) {
            throw new Error(`everyFrames must be a positive integer, got ${everyFrames}`);
        }
        const step = guards.guard(name, (frame) => {
            if (enabled()) tick(frame);
        });
        systems.push({ name, everyFrames, step });
    }

    function run(frame) {
        // Fixed length: a system added by a tick starts on the next run.
        const count = systems.length;
        for (let i = 0; i < count; i++) {
            const s = systems[i];
            if (frame % s.everyFrames === 0) s.step(frame);
        }
    }

    return { add, run };
}
