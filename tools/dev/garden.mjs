// Runs the garden from a fresh seed log and reports the unlock count each game hour.
// Usage: node tools/dev/garden.mjs <gameHours> [seed] [--no-golden] [--click <per second>] [--mod <built main.js>] > out.json
//   --no-golden   no golden cookies, so a run is luck-free and one run per variant is a fair A/B
//   --click 0     no clicking: income is CpS alone (the default is 50 clicks a second)
//   --mod         another build of the mod, such as one kept from an earlier commit
import { launchGame, launchWithMod } from '../../test/harness/game.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--click', '--mod'].includes(args[i - 1])));
const hours = Number(positional[0] || 12);
const seed = positional[1] || 'garden';
const noGolden = flag('--no-golden');
const clicks = Number(option('--click', 50));
const mod = option('--mod', null);

async function launch() {
    if (!mod) return launchWithMod({ seed });
    const game = await launchGame({ seed, mods: [mod] });
    if (game) await game.modStarted();
    return game;
}

const game = await launch();
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
try {
    // Test fixture: a bakery with a full 6×6 garden and farms enough for every soil.
    await game.eval((noGolden) => {
        if (noGolden) Game.shimmerTypes.golden.spawnConditions = () => false;
        Game.Earn(1e30);
        for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory']) Game.Objects[name].buy(name === 'Farm' ? 320 : 100);
        Game.cookies = 1e15;
        // The garden's seed budget is a share of cookies earned: at 1e30 no income would register.
        Game.cookiesEarned = Game.cookies;
        if (Game.Objects['Farm'].amount < 300) throw new Error('fixture: only ' + Game.Objects['Farm'].amount + ' farms');
        Game.Objects['Farm'].level = 9;
        Game.LoadMinigames();
    }, noGolden);
    await game.waitFor(() => !!(Game.Objects['Farm'].minigame && Game.Objects['Farm'].minigame.plants));
    await game.eval((clicks) => {
        FrozenCookies.autoBuy = 1;
        FrozenCookies.autoGC = 1;
        FrozenCookies.autoClick = clicks > 0 ? 1 : 0;
        FrozenCookies.cookieClickSpeed = clicks;
        FrozenCookies.autoGarden = 1;
        window.gardenEarnedAt = Game.cookiesEarned;
        FCStart();
    }, clicks);
    const points = [];
    const started = Date.now();
    for (let h = 1; h <= hours; h++) {
        await game.advanceSeconds(3600);
        const p = await game.eval(() => {
            const r = MushieCookies.garden.report();
            const M = Game.Objects['Farm'].minigame;
            return {
                ...r,
                soil: M.soilsById[M.soil].key,
                cps: Game.cookiesPs,
                // What seeds took of everything earned since the start.
                seedShare: r.spent / Math.max(1, Game.cookiesEarned - window.gardenEarnedAt),
                unlockedNames: Object.values(M.plants).filter((p) => p.unlocked).map((p) => p.key),
                failures: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`),
            };
        });
        points.push({ hour: h, ...p });
        process.stderr.write(
            `${String(h).padStart(3)}h ${p.unlocked}/${p.of} target=${p.target} mode=${p.mode} soil=${p.soil} planted=${p.planted} harvested=${p.harvested} ` +
                `seeds=${(p.seedShare * 100).toFixed(2)}% of income cps=${p.cps.toExponential(2)} sacrifices=${p.sacrifices}${p.failures.length ? ' FAIL ' + p.failures.join('; ') : ''}\n`
        );
    }
    console.log(JSON.stringify({ seed, hours, noGolden, clicks, mod, wallSeconds: Math.round((Date.now() - started) / 1000), errors: game.errors.slice(0, 5), points }));
} finally {
    await game.close();
}
