/**
 * Replaces the clock, the timers and the unseeded RNG with virtual ones.
 *
 * Until takeover() the clock follows real time from a fixed epoch and timers are real, so the
 * game boots normally. After takeover() time moves only through advance().
 *
 * This function runs inside the page before any game script, so it must not reference
 * anything outside its own body.
 */
export function installVirtualTime({ epoch }) {
    const RealDate = Date;
    const bootedAt = RealDate.now();
    const real = {
        setTimeout: window.setTimeout.bind(window),
        setInterval: window.setInterval.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
        clearInterval: window.clearInterval.bind(window),
        raf: window.requestAnimationFrame.bind(window),
        cancelRaf: window.cancelAnimationFrame.bind(window),
        perfNow: performance.now.bind(performance),
    };
    const vt = { active: false, now: epoch, start: epoch, timers: new Map(), nextId: 1e9, frames: 0, soonest: Infinity };
    // Real timers created before takeover, so that takeover can cancel whatever is still pending.
    const pending = { timeouts: new Set(), intervals: new Set(), frames: new Set() };
    const clock = () => (vt.active ? vt.now : epoch + (RealDate.now() - bootedAt));
    const callable = (fn) => (typeof fn === 'function' ? fn : new Function(String(fn)));

    class VirtualDate extends RealDate {
        constructor(...args) {
            if (args.length === 0) super(clock());
            else super(...args);
        }
        static now() {
            return clock();
        }
    }
    window.Date = VirtualDate;
    performance.now = () => (vt.active ? vt.now - epoch : real.perfNow());

    const schedule = (fn, ms, args, every) => {
        const id = vt.nextId++;
        const at = vt.now + Math.max(0, Number(ms) || 0);
        vt.timers.set(id, { run: callable(fn), args, at, every });
        if (at < vt.soonest) vt.soonest = at;
        return id;
    };
    window.setTimeout = (fn, ms, ...args) => {
        if (vt.active) return schedule(fn, ms, args, 0);
        const run = callable(fn);
        const id = real.setTimeout(() => {
            pending.timeouts.delete(id);
            run(...args);
        }, ms);
        pending.timeouts.add(id);
        return id;
    };
    window.setInterval = (fn, ms, ...args) => {
        if (vt.active) return schedule(fn, ms, args, Math.max(1, Number(ms) || 0));
        const id = real.setInterval(callable(fn), ms, ...args);
        pending.intervals.add(id);
        return id;
    };
    window.clearTimeout = window.clearInterval = (id) => {
        if (vt.timers.delete(id)) return;
        pending.timeouts.delete(id);
        pending.intervals.delete(id);
        real.clearTimeout(id);
        real.clearInterval(id);
    };
    window.requestAnimationFrame = (fn) => {
        if (vt.active) return schedule(() => fn(vt.now - epoch), 16, [], 0);
        const id = real.raf((t) => {
            pending.frames.delete(id);
            fn(t);
        });
        pending.frames.add(id);
        return id;
    };
    window.cancelAnimationFrame = (id) => {
        if (vt.timers.delete(id)) return;
        pending.frames.delete(id);
        real.cancelRaf(id);
    };

    const runDue = () => {
        if (vt.now < vt.soonest) return; // nothing is due; the common case on most frames
        // A timer that re-arms itself with a zero delay could spin forever.
        // 1000 firings in one frame is far above anything real code does.
        for (let fired = 0; fired < 1000; fired++) {
            let next = null;
            let nextId = 0;
            for (const [id, t] of vt.timers) {
                if (t.at <= vt.now && (next === null || t.at < next.at || (t.at === next.at && id < nextId))) {
                    next = t;
                    nextId = id;
                }
            }
            if (next === null) {
                vt.soonest = Infinity;
                for (const t of vt.timers.values()) if (t.at < vt.soonest) vt.soonest = t.at;
                return;
            }
            if (next.every) next.at += next.every;
            else vt.timers.delete(nextId);
            next.run(...next.args);
        }
    };

    vt.takeover = (seed) => {
        for (const id of pending.timeouts) real.clearTimeout(id);
        for (const id of pending.intervals) real.clearInterval(id);
        for (const id of pending.frames) real.cancelRaf(id);
        pending.timeouts.clear();
        pending.intervals.clear();
        pending.frames.clear();

        vt.start = epoch + 10 * 60 * 1000; // fixed, and later than any real boot
        vt.now = vt.start;
        vt.frames = 0;
        vt.active = true;
        window.Game.Loop = function () {}; // the real frame loop is replaced by advance()

        const seedrandom = Math.seedrandom;
        let reseeds = 0;
        Math.seedrandom = function (s) {
            return seedrandom.call(Math, s === undefined ? `vt/${seed}/${reseeds++}` : s);
        };
        Math.seedrandom();
    };

    vt.advance = (frames) => {
        const fps = window.Game.fps;
        for (let i = 0; i < frames; i++) {
            // Derived from the frame count, not accumulated, so 30 frames are exactly one second.
            vt.frames++;
            vt.now = vt.start + (vt.frames * 1000) / fps;
            runDue();
            window.Game.Logic();
        }
    };

    window.__vt = vt;
}
