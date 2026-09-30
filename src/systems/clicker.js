// The clicker: clicks the big cookie as often as the game counts a click, and measures how often
// that really is for the income model.
//
// The game counts one click per 20 ms by Date.now() (main.js:4770) and frames are 33 ms apart, so
// clicking has to happen between frames: this is the one timer in the mod (design section 2,
// rule 4). It is a self-scheduling pump rather than an interval. An interval at 50 a second loses
// a whole slot whenever one call runs late, and a faster one wastes most of its calls on
// rejections; each call here is timed for the moment the game will count it (see delayAfterCall).
import { clickGap, delayAfterCall, clickBuffRunning, createRateMeter } from '../core/clicker.js';
import { useClickRate } from '../game/measure.js';

const SAMPLE_FRAMES = 30; // one rate reading a second
const RATE_TAU_SECONDS = 60;

// Looked up at call time, so a page that replaces the timers (the test harness) is followed.
const pageTimers = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id),
};

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings  autoClick and cookieClickSpeed (a cap); autoFrenzy and frenzyClickSpeed
 * @param {object} deps.loop
 * @param {(name: string, fn: Function) => Function} [deps.guard]  the mod's error isolation
 * @param {{set: Function, clear: Function}} [deps.timers]
 * @param {() => number} [deps.now]
 * @param {(what: string) => void} [deps.log]
 */
export function createClicker({ game, settings, loop, guard = null, timers = pageTimers, now = () => Date.now(), log = () => {} }) {
    const meter = createRateMeter({ tau: RATE_TAU_SECONDS });
    const state = { timer: null, calls: 0, accepted: 0, rejected: 0 };

    // Autofrenzy clicks during click buffs only, for a player who keeps Autoclick off (to keep a
    // Shimmering veil, say); it used to swap in an interval of its own.
    const frenzyOnly = () => !!settings.autoFrenzy && Number(settings.frenzyClickSpeed) > 0 && clickBuffRunning(game.buffs);
    const always = () => !!settings.autoClick && Number(settings.cookieClickSpeed) > 0;
    const wanted = () => always() || frenzyOnly();
    const cap = () => Math.max(always() ? Number(settings.cookieClickSpeed) : 0, frenzyOnly() ? Number(settings.frenzyClickSpeed) : 0);
    const ascending = () => !!(game.OnAscend || game.AscendTimer);

    /** One call to the game's click handler. Returns the delay to the next, or null to stop. */
    function click() {
        if (!wanted()) return null;
        const frameMs = 1000 / (game.fps || 30);
        if (ascending()) return frameMs;
        const counted = game.cookieClicks;
        // ClickCookie zeroes Game.Click on every call, counted or not (main.js:4798). A player's
        // click on the page sets it (main.js:4860) for the next frame, where wrinklers and the
        // dragon and Santa tabs read it (main.js:14421, 14721); between frames this call would
        // eat it. Put back, the player's click still lands.
        const human = game.Click;
        try {
            game.ClickCookie();
        } finally {
            game.Click = human;
        }
        state.calls++;
        const accepted = game.cookieClicks !== counted;
        if (accepted) state.accepted++;
        else state.rejected++;
        return delayAfterCall({ accepted, now: now(), lastClick: game.lastClick, gap: clickGap(cap()), frameMs });
    }

    // A guard of its own: the loop tick that re-arms the pump succeeds every frame, and a shared
    // guard would count that as the end of a failure streak. Once switched off, the tick's calls
    // to it do nothing until MushieCookies.revive('clicker:pump').
    const step = guard ? guard('clicker:pump', click) : click;

    function pump() {
        state.timer = null;
        const delay = step();
        // null: clicking was switched off. undefined: the call failed; the loop re-arms on its
        // next frame while the guard allows.
        if (delay === null || delay === undefined) return;
        state.timer = timers.set(pump, delay);
    }

    function tick(frame) {
        if (state.timer === null && wanted()) pump();
        if (frame % SAMPLE_FRAMES === 0) {
            if (always() && !ascending()) meter.sample(game.cookieClicks, now());
            else meter.pause();
        }
    }

    loop.add('clicker', tick);
    useClickRate(() => meter.rate());

    return {
        /** Accepted clicks a second, averaged over about a minute; null before the first reading. */
        rate: () => meter.rate(),
        report() {
            return { running: state.timer !== null, calls: state.calls, accepted: state.accepted, rejected: state.rejected, rate: meter.rate() };
        },
        /** Stops the pump until the next frame re-arms it; for tools that compare clickers. */
        stop() {
            if (state.timer !== null) timers.clear(state.timer);
            state.timer = null;
        },
    };
}
