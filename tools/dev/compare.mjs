// Plays the same seed under two buyer settings and prints progress side by side.
// Usage: node tools/dev/compare.mjs <hours> <seed> '<js applied to A>' '<js applied to B>' [--no-golden]
import { launchWithMod } from '../../test/harness/game.mjs';

const hours = Number(process.argv[2] || 4);
const seed = process.argv[3] || 'compare';
const variants = { A: process.argv[4] || '', B: process.argv[5] || '' };
const noGolden = process.argv.includes('--no-golden');
const results = {};
for (const [name, code] of Object.entries(variants)) {
    const game = await launchWithMod({ seed });
    try {
        if (noGolden) await game.eval(() => { Game.shimmerTypes.golden.spawnConditions = () => false; });
        await game.eval((snippet) => {
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoGC = 1;
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            FCStart();
            new Function(snippet)();
        }, code);
        const points = [];
        const started = Date.now();
        for (let h = 1; h <= hours; h++) {
            await game.advanceSeconds(3600);
            points.push(await game.eval(() => ({ earned: Game.cookiesEarned, cps: Game.unbuffedCps, buildings: Game.BuildingsOwned, upgrades: Game.UpgradesOwned })));
        }
        results[name] = { points, wall: Math.round((Date.now() - started) / 1000) };
    } finally {
        await game.close();
    }
}
for (let h = 1; h <= hours; h++) {
    const a = results.A.points[h - 1], b = results.B.points[h - 1];
    console.log(`${h}h  A: ${a.earned.toExponential(2)} earned, cps ${a.cps.toExponential(2)}, ${a.buildings}b/${a.upgrades}u   B: ${b.earned.toExponential(2)}, cps ${b.cps.toExponential(2)}, ${b.buildings}b/${b.upgrades}u   B/A earned ${(b.earned / a.earned).toFixed(2)}x`);
}
console.log(`wall A ${results.A.wall}s, B ${results.B.wall}s`);
