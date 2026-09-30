// Runs the built mod in the harness and reports where the time goes.
// Usage: node tools/dev/profile.mjs [gameMinutes]
import { launchWithMod } from '../../test/harness/game.mjs';

const minutes = Number(process.argv[2] || 30);
const game = await launchWithMod();
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
try {
    await game.eval(() => {
        const counts = {};
        const spent = {};
        const wrap = (owner, name, label) => {
            const real = owner[name];
            if (typeof real !== 'function') return;
            counts[label] = 0;
            spent[label] = 0;
            owner[name] = function (...args) {
                const t0 = performance.__real ? performance.__real() : 0;
                try {
                    return real.apply(this, args);
                } finally {
                    counts[label]++;
                    spent[label] += (performance.__real ? performance.__real() : 0) - t0;
                }
            };
        };
        // The harness replaces performance.now with virtual time; timing needs the real clock.
        const frame = document.createElement('iframe');
        document.body.appendChild(frame);
        const realNow = frame.contentWindow.performance.now.bind(frame.contentWindow.performance);
        performance.__real = realNow;
        for (const name of ['autoCookieBody', 'updateCaches', 'recommendationList', 'buildingStats', 'upgradeStats', 'updateTimers', 'fcClickCookie', 'effectiveCps', 'bestBank', 'cookieValue']) {
            wrap(window, name, name);
        }
        wrap(Game, 'CalculateGains', 'Game.CalculateGains');
        wrap(Game, 'Logic', 'Game.Logic');
        wrap(MushieCookies, 'simulate', 'simulate');
        window.__profile = { counts, spent };

        FrozenCookies.autoBuy = 1;
        FrozenCookies.autoGC = 1;
        FrozenCookies.autoClick = 1;
        FrozenCookies.cookieClickSpeed = 50;
        FCStart();
    });
    const t0 = Date.now();
    await game.advanceSeconds(minutes * 60);
    const wall = (Date.now() - t0) / 1000;
    const out = await game.eval(() => ({
        ...window.__profile,
        owned: Game.BuildingsOwned,
        upgrades: Game.UpgradesOwned,
        cps: Game.cookiesPs,
    }));
    console.log(`${minutes} game minutes in ${wall.toFixed(1)} s: ${((minutes * 60) / wall).toFixed(0)}x real time`);
    console.log(`buildings ${out.owned}, upgrades ${out.upgrades}, CpS ${Math.round(out.cps)}`);
    const rows = Object.keys(out.counts)
        .map((k) => ({ name: k, calls: out.counts[k], seconds: out.spent[k] / 1000 }))
        .sort((a, b) => b.seconds - a.seconds);
    for (const r of rows) {
        console.log(`${r.name.padEnd(22)} ${String(r.calls).padStart(9)} calls ${r.seconds.toFixed(2).padStart(8)} s (inclusive)`);
    }
} finally {
    await game.close();
}
