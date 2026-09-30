// Measures the season planner against no season play (what the Autopilot had before: the
// inherited Easter and Halloween switches were off). Each run starts just after an ascension at
// the given prestige with Season switcher owned, buys with the buyer, clicks, and runs luck-free
// (golden cookies off), so a seed changes only Santa's and the reindeer's draws. One game at a time.
// Usage: node tools/dev/seasons.mjs <gameHours> <seed[,seed...]> [--start-prestige=N] [--only=on|off] > out.json
import { launchWithMod } from '../../test/harness/game.mjs';

const hours = Number(process.argv[2] || 3);
const seeds = (process.argv[3] || 'seasons1,seasons2,seasons3').split(',');
const startArg = process.argv.find((a) => a.startsWith('--start-prestige='));
const startPrestige = startArg ? Number(startArg.split('=')[1]) : 3000;
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const variants = onlyArg ? [onlyArg.split('=')[1]] : ['off', 'on'];

function sample() {
    const owned = (names) => names.filter((n) => Game.Has(n)).length;
    const drops = {
        santa: owned(Game.santaDrops),
        christmas: owned(Game.reindeerDrops),
        hearts: owned(Game.heartDrops),
        halloween: owned(Game.halloweenDrops),
        eggs: owned(Game.easterEggs),
        hat: Game.Has('A festive hat'),
        dominion: Game.Has("Santa's dominion"),
    };
    return {
        cps: Game.unbuffedCps,
        earned: Game.cookiesEarned,
        season: Game.season || '-',
        uses: Game.seasonUses,
        santaLevel: Game.santaLevel,
        drops,
        seasonal: Object.values(drops).reduce((s, n) => s + Number(n), 0),
        failures: Object.entries(MushieCookies.status())
            .filter(([, s]) => s.failures > 0)
            .map(([n, s]) => `${n}: ${s.lastError}`),
    };
}

async function run(seed, variant) {
    const game = await launchWithMod({ seed });
    if (!game) throw new Error('game location not configured');
    try {
        await game.eval(
            ({ p, on }) => {
                Game.shimmerTypes.golden.spawnConditions = () => false;
                // Test fixture only: the state an ascension at this prestige leaves behind, with the
                // heavenly upgrades a planner buys first and Season switcher.
                Game.cookiesReset = Game.HowManyCookiesReset(p);
                Game.prestige = p;
                Game.heavenlyChips = 0;
                Game.resets = 1;
                for (const name of ['Legacy', 'Heavenly cookies', 'How to bake your dragon', 'Box of brand biscuits', 'Season switcher']) {
                    Game.Upgrades[name].earn();
                }
                Game.CalculateGains();
                FrozenCookies.autoBuy = 1;
                FrozenCookies.autoClick = 1;
                FrozenCookies.cookieClickSpeed = 50;
                FrozenCookies.autoReindeer = 1;
                FrozenCookies.autoSeasons = on ? 1 : 0;
                FCStart();
            },
            { p: startPrestige, on: variant === 'on' }
        );
        const points = [];
        const started = Date.now();
        for (let h = 1; h <= hours; h++) {
            await game.advanceSeconds(3600);
            const p = await game.eval(sample);
            points.push({ hour: h, ...p });
            process.stderr.write(
                `${seed} ${variant} ${h}h cps=${p.cps.toExponential(2)} earned=${p.earned.toExponential(2)} season=${p.season} uses=${p.uses} ` +
                    `santa=${p.santaLevel} seasonal=${p.seasonal} ${JSON.stringify(p.drops)}${p.failures.length ? ' FAIL ' + p.failures.join('; ') : ''}\n`
            );
        }
        const report = variant === 'on' ? await game.eval(() => MushieCookies.seasons.report()) : null;
        return { seed, variant, wallSeconds: Math.round((Date.now() - started) / 1000), errors: game.errors.slice(0, 5), points, last: report && report.last };
    } finally {
        await game.close();
    }
}

const runs = [];
for (const seed of seeds) for (const variant of variants) runs.push(await run(seed, variant));

// Per seed: the planner's end-of-run CpS and cookies against no season play.
const end = (r) => r.points[r.points.length - 1];
const summary = [];
for (const seed of seeds) {
    const off = runs.find((r) => r.seed === seed && r.variant === 'off');
    const on = runs.find((r) => r.seed === seed && r.variant === 'on');
    if (!off || !on) continue;
    summary.push({
        seed,
        cpsRatio: end(on).cps / end(off).cps,
        earnedRatio: end(on).earned / end(off).earned,
        seasonalOn: end(on).seasonal,
        seasonalOff: end(off).seasonal,
        switches: end(on).uses,
        santaLevel: end(on).santaLevel,
    });
}
const spread = (key) => {
    const xs = summary.map((s) => s[key]);
    return xs.length ? { min: Math.min(...xs), max: Math.max(...xs), geomean: Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) } : null;
};
for (const s of summary) {
    process.stderr.write(
        `${s.seed}: CpS x${s.cpsRatio.toFixed(2)}, cookies x${s.earnedRatio.toFixed(2)}, seasonal upgrades ${s.seasonalOn} vs ${s.seasonalOff}, ${s.switches} switches, Santa ${s.santaLevel}\n`
    );
}
console.log(JSON.stringify({ hours, startPrestige, goldenCookies: false, summary, cps: spread('cpsRatio'), earned: spread('earnedRatio'), runs }, null, 1));
