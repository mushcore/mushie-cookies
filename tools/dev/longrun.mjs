// Plays many game hours from nothing with buying and ascension on, and reports each hour.
// Usage: node tools/dev/longrun.mjs <gameHours> <seed> [rate|double] [--no-golden] [--start-prestige=N] > out.json
// --start-prestige begins just after a first ascension at prestige N, with the starter heavenly
// upgrades owned, so rules can be compared over later ascensions without days of first run.
import { launchWithMod } from '../../test/harness/game.mjs';

const hours = Number(process.argv[2] || 24);
const seed = process.argv[3] || 'longrun';
const rule = process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : 'rate';
const noGolden = process.argv.includes('--no-golden');
const startArg = process.argv.find((a) => a.startsWith('--start-prestige='));
const startPrestige = startArg ? Number(startArg.split('=')[1]) : 0;
const game = await launchWithMod({ seed });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
try {
    if (noGolden) await game.eval(() => { Game.shimmerTypes.golden.spawnConditions = () => false; });
    if (startPrestige > 0) {
        // Test fixture only: the state a first ascension at this prestige leaves behind.
        await game.eval((p) => {
            Game.cookiesReset = Game.HowManyCookiesReset(p);
            Game.prestige = p;
            Game.heavenlyChipsSpent = 0;
            Game.heavenlyChips = p;
            Game.resets = 1;
            const starter = ['Legacy', 'Heavenly cookies', 'How to bake your dragon', 'Box of brand biscuits', 'Heavenly luck', 'Permanent upgrade slot I', 'Twin Gates of Transcendence', 'Belphegor'];
            for (const name of starter) {
                const u = Game.Upgrades[name];
                Game.heavenlyChips -= u.getPrice();
                Game.heavenlyChipsSpent += u.getPrice();
                u.earn();
            }
            Game.CalculateGains();
        }, startPrestige);
    }
    await game.eval((r) => {
        FrozenCookies.autoBuy = 1;
        FrozenCookies.autoGC = 1;
        FrozenCookies.autoClick = 1;
        FrozenCookies.cookieClickSpeed = 50;
        FrozenCookies.autoAscendToggle = 1;
        FCStart();
        MushieCookies.ascension.options.rule = r;
    }, rule);
    const points = [];
    const started = Date.now();
    for (let h = 1; h <= hours; h++) {
        await game.advanceSeconds(3600);
        const p = await game.eval(() => {
            const r = MushieCookies.ascension.report();
            return {
                prestige: Game.prestige,
                projected: Math.floor(r.projected),
                ascensions: Game.resets,
                chips: Game.heavenlyChips,
                heavenly: Game.PrestigeUpgrades.filter((u) => u.bought).length,
                cps: Game.unbuffedCps,
                verdict: r.verdict && r.verdict.reason,
                failures: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`),
            };
        });
        points.push({ hour: h, ...p });
        process.stderr.write(
            `${String(h).padStart(3)}h prestige=${p.prestige} projected=${p.projected} ascensions=${p.ascensions} heavenly=${p.heavenly} chips=${p.chips} cps=${p.cps.toExponential(2)} | ${p.verdict}${p.failures.length ? ' | FAIL ' + p.failures.join('; ') : ''}\n`
        );
    }
    console.log(JSON.stringify({ seed, rule, goldenCookies: !noGolden, wallSeconds: Math.round((Date.now() - started) / 1000), errors: game.errors.slice(0, 10), points }, null, 1));
} finally {
    await game.close();
}
