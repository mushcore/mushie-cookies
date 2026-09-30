/**
 * Replaces the clock, the timers and the unseeded RNG with virtual ones, and loads mods at the
 * point where Steam loads them.
 *
 * Until takeover() the clock follows real time from a fixed epoch and timers are real, so the
 * game boots normally. After takeover() time moves only through advance().
 *
 * This function runs inside the page before any game script, so it must not reference
 * anything outside its own body.
 */
export function installVirtualTime({ epoch, modUrls }) {
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
    const vt = {
        active: false, now: epoch, start: epoch, frames: 0,
        timers: new Map(), nextId: 1e9, soonest: Infinity,
    };
    // Real timers created before takeover. Takeover moves them onto virtual time.
    const pending = new Map();
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

    const schedule = (id, fn, ms, args, every) => {
        const at = vt.now + Math.max(0, Number(ms) || 0);
        vt.timers.set(id, { run: callable(fn), args, at, every });
        if (at < vt.soonest) vt.soonest = at;
        return id;
    };
    window.setTimeout = (fn, ms, ...args) => {
        if (vt.active) return schedule(vt.nextId++, fn, ms, args, 0);
        const id = real.setTimeout(() => {
            pending.delete(id);
            callable(fn)(...args);
        }, ms);
        pending.set(id, { kind: 'timeout', fn, ms, args });
        return id;
    };
    window.setInterval = (fn, ms, ...args) => {
        if (vt.active) return schedule(vt.nextId++, fn, ms, args, Math.max(1, Number(ms) || 0));
        const id = real.setInterval(callable(fn), ms, ...args);
        pending.set(id, { kind: 'interval', fn, ms, args });
        return id;
    };
    window.clearTimeout = window.clearInterval = (id) => {
        if (vt.timers.delete(id)) return;
        pending.delete(id);
        real.clearTimeout(id);
        real.clearInterval(id);
    };
    window.requestAnimationFrame = (fn) =>
        vt.active ? schedule(vt.nextId++, () => fn(vt.now - epoch), 16, [], 0) : real.raf(fn);
    window.cancelAnimationFrame = (id) => {
        if (!vt.timers.delete(id)) real.cancelRaf(id);
    };

    const runDue = () => {
        if (vt.now < vt.soonest) return; // nothing is due; the common case on most frames
        // Each timer runs at the time it was due, as in a browser, not at the frame's time:
        // otherwise every timer inside one frame sees the same Date.now(), and code that spaces
        // its actions by the clock (the game counts one click per 20 ms) is held to one per frame.
        const frameTime = vt.now;
        let last = -Infinity; // the clock never runs backwards, even for a timer left overdue
        try {
            // A timer that re-arms itself with a zero delay could spin forever.
            // 1000 firings in one frame is far above anything real code does.
            for (let fired = 0; fired < 1000; fired++) {
                let next = null;
                let nextId = 0;
                for (const [id, t] of vt.timers) {
                    if (t.at <= frameTime && (next === null || t.at < next.at || (t.at === next.at && id < nextId))) {
                        next = t;
                        nextId = id;
                    }
                }
                if (next === null) {
                    vt.soonest = Infinity;
                    for (const t of vt.timers.values()) if (t.at < vt.soonest) vt.soonest = t.at;
                    return;
                }
                last = Math.max(last, next.at);
                vt.now = last;
                if (next.every) next.at += next.every;
                else vt.timers.delete(nextId);
                next.run(...next.args);
            }
        } finally {
            vt.now = frameTime;
        }
    };

    // Same order as Steam: mod files first, then the game launches.
    window.__harnessLoadMods = (launch) => {
        const loadNext = (i) => {
            if (i >= modUrls.length) {
                launch();
                // The game has now defined its frame loop and will start it when it finishes
                // initialising. Not one real frame may run: how many would depend on how fast
                // this machine is, and every run has to start from the same frame.
                window.Game.Loop = function () {};
                return;
            }
            window.Game.LoadMod(modUrls[i], () => loadNext(i + 1), () => {
                console.error('harness: failed to load mod file ' + modUrls[i]);
                loadNext(i + 1);
            });
        };
        loadNext(0);
    };

    vt.takeover = (seed, startAt) => {
        // Fixed, and later than any real boot; a run resumed from a checkpoint starts at the
        // moment the checkpoint was taken, so the save's own dates line up with the clock.
        vt.start = startAt || epoch + 10 * 60 * 1000;
        vt.now = vt.start;
        vt.frames = 0;
        vt.active = true;

        // Whatever was waiting on a real timer now waits on virtual time, under the same id,
        // so code that kept the id can still clear it.
        for (const [id, t] of pending) {
            real.clearTimeout(id);
            real.clearInterval(id);
            schedule(id, t.fn, t.ms, t.args, t.kind === 'interval' ? Math.max(1, Number(t.ms) || 0) : 0);
        }
        pending.clear();

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

    /**
     * The machine sleeps: the clock and every timer move on by `ms` and no frame runs. On waking
     * the real game would catch up at most 5 s (main.js:16788); the next advance() plays that part.
     */
    vt.sleep = (ms) => {
        vt.start += ms;
        vt.now += ms;
        for (const t of vt.timers.values()) t.at += ms;
        vt.soonest += ms;
    };

    window.__vt = vt;
}
