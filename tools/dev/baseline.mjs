// Plays a fresh save with buying and clicking on, and records progress at ten-minute points.
// Usage: node tools/dev/baseline.mjs [gameHours] [seed] [built mod file] [--no-golden] > test/baselines/<name>.json
// --no-golden stops golden cookies spawning, which removes most of the luck between runs and
// leaves the buying logic as the difference being measured.
// The third argument lets an older build be measured (for example a milestone's dist built in a
// separate worktree), so later milestones can be compared against it on any seed.
import { launchGame, BUILT_MOD } from '../../test/harness/game.mjs';

const hours = Number(process.argv[2] || 2);
const seed = process.argv[3] || 'baseline';
const noGolden = process.argv.includes('--no-golden');
const modFile = process.argv.slice(4).find((a) => !a.startsWith('--')) || BUILT_MOD;
const game = await launchGame({ seed, mods: [modFile] });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
try {
    await game.modStarted();
    if (noGolden) await game.eval(() => { Game.shimmerTypes.golden.spawnConditions = () => false; });
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
        process.stderr.write(`${minute} min: ${points[points.length - 1].earned.toExponential(2)} earned\n`);
    }
    const out = {
        seed,
        mod: modFile === BUILT_MOD ? 'current build' : modFile,
        settings: { autoBuy: 1, autoGC: 1, autoClick: 1, cookieClickSpeed: 50 },
        goldenCookies: !noGolden,
        wallSeconds: Math.round((Date.now() - started) / 1000),
        points,
    };
    console.log(JSON.stringify(out, null, 2));
} finally {
    await game.close();
}
