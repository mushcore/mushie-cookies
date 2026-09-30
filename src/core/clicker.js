/**
 * The clicker's decisions. Pure: when to call the game's click handler next, whether a click
 * buff is running, and how many clicks a second the income model should count on.
 */

/**
 * The game counts a click only when the last counted one is at least 20 ms old by Date.now(),
 * for a call with no event (main.js:4770: 1000/50).
 */
export const CLICK_GAP_MS = 20;

/** The most clicks a second the game counts. */
export const MAX_CLICKS_PER_SECOND = 1000 / CLICK_GAP_MS;

/** Milliseconds between clicks under a cap of `cap` clicks a second: never less than the game's gap. */
export function clickGap(cap) {
    const n = Number(cap);
    if (!(n > 0)) return Infinity;
    return Math.max(CLICK_GAP_MS, 1000 / n);
}

/**
 * How long to wait before the next call, after one that was counted (`accepted`) or not: until
 * one gap after the last counted click, measured from the click and not from the end of the call,
 * so the click's own sound and particles (main.js:4783-4791) do not stretch the gap. That also
 * covers a call not counted because the gap had not passed (a timer that woke early on the integer
 * clock, or a player's click in between). A call not counted for any other reason (ascending, the
 * game's first frames; main.js:4770) waits a frame rather than spinning.
 */
export function delayAfterCall({ accepted, now, lastClick, gap, frameMs }) {
    const left = lastClick + gap - now;
    if (left > 0) return left;
    return accepted ? 0 : frameMs;
}

/**
 * Whether a buff that makes clicks worth more than usual is running: any click multiplier above
 * one (Click frenzy, Dragonflight, Godzamok's Devastation; main.js:13936-13958, 14076), or Cursed
 * finger, which pays every click the CpS it stopped (main.js:4746, 5556).
 */
export function clickBuffRunning(buffs) {
    for (const buff of Object.values(buffs)) {
        if (buff.multClick > 1 || buff.name === 'Cursed finger') return true;
    }
    return false;
}

/**
 * Accepted clicks a second, as an exponential moving average over wall-clock time with time
 * constant `tau` seconds. Readings are taken from the game's click counter. A reading at the same
 * time as the last one adds nothing (frames catch up in bursts), and `pause` drops the open window
 * so time spent not clicking is not averaged in as zero.
 */
export function createRateMeter({ tau = 60 } = {}) {
    let last = null; // { clicks, at }
    let rate = null;
    return {
        sample(clicks, at) {
            if (last && at > last.at) {
                const seconds = (at - last.at) / 1000;
                const observed = Math.max(0, clicks - last.clicks) / seconds;
                rate = rate === null ? observed : rate + (observed - rate) * (1 - Math.exp(-seconds / tau));
            }
            if (!last || at >= last.at) last = { clicks, at };
        },
        pause() {
            last = null;
        },
        rate: () => rate,
    };
}

/**
 * Clicks a second for the income model: none without clicking; the measured rate once there is
 * one; until then the cap. Never more than the cap or than the game counts.
 */
export function modelClickRate({ autoClick, speed, measured }) {
    if (!autoClick) return 0;
    const cap = Math.min(Math.max(0, Number(speed) || 0), MAX_CLICKS_PER_SECOND);
    if (measured === null || measured === undefined) return cap;
    return Math.min(measured, cap);
}
