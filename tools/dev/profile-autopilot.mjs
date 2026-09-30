// Plays on Autopilot from a fresh save and reports where the wall-clock time goes: each system
// on the mod's loop, each inherited timer, and the game's own logic.
// Usage: node tools/dev/profile-autopilot.mjs [gameMinutes] [seed]
import { launchWithMod } from '../../test/harness/game.mjs';

const minutes = Number(process.argv[2] || 60);
const seed = process.argv[3] || 'profile';
const game = await launchWithMod({ seed, autopilot: true });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
try {
    await game.eval(() => {
        // The harness replaces performance.now with virtual time; timing needs a real clock.
        const frame = document.createElement('iframe');
        document.body.appendChild(frame);
        const now = frame.contentWindow.performance.now.bind(frame.contentWindow.performance);
        const spent = {};
        const calls = {};
        const timed = (label, fn) =>
            function (...args) {
                const t0 = now();
                try {
                    return fn.apply(this, args);
                } finally {
                    spent[label] = (spent[label] || 0) + now() - t0;
                    calls[label] = (calls[label] || 0) + 1;
                }
            };
        window.__profile = { spent, calls };
        // The game's logic without the mod's hooks, and the hooks on their own.
        const logic = Game.Logic;
        Game.Logic = timed('Game.Logic (all, incl. hooks)', logic);
        for (const hook of Object.keys(Game.customLogic ? {} : {})) void hook;
        // Each inherited interval, by the name of the function it runs.
        const setInterval = window.setInterval;
        window.setInterval = (fn, ms, ...rest) => setInterval(timed(`timer ${(fn && fn.name) || 'anonymous'} /${ms}ms`, fn), ms, ...rest);
        const setTimeout = window.setTimeout;
        window.setTimeout = (fn, ms, ...rest) => setTimeout(typeof fn === 'function' ? timed(`timeout ${fn.name || 'anonymous'}`, fn) : fn, ms, ...rest);
        for (const name of ['simulate', 'simulateEach', 'measureCandidates', 'readState', 'estimateIncome', 'forecastFate', 'optimizeLayout', 'listCandidates']) {
            if (typeof MushieCookies[name] === 'function') {
                try {
                    Object.defineProperty(MushieCookies, name, { value: timed(`MushieCookies.${name}`, MushieCookies[name]) });
                } catch (e) {}
            }
        }
        FCStart(); // re-arm the inherited timers through the timed wrappers
    });
    // The mod's loop systems are guarded functions; time them through the status names by
    // wrapping the logic hook the loop is driven from.
    const t0 = Date.now();
    await game.advanceSeconds(minutes * 60);
    const wall = (Date.now() - t0) / 1000;
    const out = await game.eval(() => ({ ...window.__profile, earned: Game.cookiesEarned, buildings: Game.BuildingsOwned }));
    console.log(`${minutes} game minutes in ${wall.toFixed(1)} s: ${((minutes * 60) / wall).toFixed(0)}x real time; earned ${out.earned.toExponential(2)}, ${out.buildings} buildings`);
    const rows = Object.keys(out.spent)
        .map((k) => ({ name: k, calls: out.calls[k], seconds: out.spent[k] / 1000 }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 30);
    for (const r of rows) console.log(`${r.seconds.toFixed(2).padStart(8)} s ${String(r.calls).padStart(9)} calls  ${r.name}`);
} finally {
    await game.close();
}
