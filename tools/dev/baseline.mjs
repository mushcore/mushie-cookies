// Plays a fresh save with buying and clicking on, and records progress at fixed points.
// Usage: node tools/dev/baseline.mjs [gameHours] [seed] > test/baselines/<name>.json
import { launchWithMod } from '../../test/harness/game.mjs';

const hours = Number(process.argv[2] || 2);
const seed = process.argv[3] || 'baseline';
const game = await launchWithMod({ seed });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
try {
    await game.eval(() => {
        FrozenCookies.autoBuy = 1;
        FrozenCookies.autoGC = 1;
        FrozenCookies.autoClick = 1;
        FrozenCookies.cookieClickSpeed = 50;
        FCStart();
    });
    const points = [];
    const started = Date.now();
    for (let minute = 10; minute <= hours * 60; minute += 10) {
        await game.advanceSeconds(10 * 60);
        points.push(
            await game.eval((m) => ({
                minute: m,
                earned: Game.cookiesEarned,
                cps: Game.cookiesPs,
                unbuffedCps: Game.unbuffedCps,
                buildings: Game.BuildingsOwned,
                upgrades: Game.UpgradesOwned,
                achievements: Game.AchievementsOwned,
            }), minute)
        );
        process.stderr.write(`${minute} min: ${points.at(-1).earned.toExponential(2)} earned\n`);
    }
    const out = {
        seed,
        settings: { autoBuy: 1, autoGC: 1, autoClick: 1, cookieClickSpeed: 50 },
        wallSeconds: Math.round((Date.now() - started) / 1000),
        points,
    };
    console.log(JSON.stringify(out, null, 2));
} finally {
    await game.close();
}
