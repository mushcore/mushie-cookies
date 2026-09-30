// Compares the dragon system's training rule with the inherited one (train whatever is affordable)
// from the same start: a run just after an ascension at the given prestige, with the heavenly
// upgrades that make prestige count and the one that brings the dragon. Golden cookies are off,
// so each run is deterministic and one run per rule and seed is a fair comparison; seeds differ
// through the grimoire's forecast casts. Games run one at a time.
//
// Usage: node tools/dev/dragon.mjs <gameHours> <seed,seed,...> [--prestige=N] [--grimoire] [--rules=measured,eager]
//   --grimoire  the grimoire is unlocked and the mod casts, so the Wizard tower levels meet mana
// Prints one JSON line per run to stdout, then a summary table to stderr.
import { launchWithMod } from '../../test/harness/game.mjs';

const hours = Number(process.argv[2] || 3);
const seeds = (process.argv[3] || 'dragon').split(',');
const arg = (name, fallback) => {
    const a = process.argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split('=')[1] : fallback;
};
const prestige = Number(arg('prestige', 1e4));
const grimoire = process.argv.includes('--grimoire');
const rules = arg('rules', 'measured,eager').split(',');
const POLL = 60; // seconds between polls
const POINT_EVERY = 10; // polls between recorded points

async function run(seed, rule) {
    const game = await launchWithMod({ seed });
    if (!game) throw new Error('game location not configured');
    try {
        // Test fixture only: the state an ascension at this prestige leaves, with golden cookies off.
        await game.eval((p) => {
            Game.shimmerTypes.golden.spawnConditions = () => false;
            Game.cookiesReset = Game.HowManyCookiesReset(p);
            Game.prestige = p;
            Game.heavenlyChips = 0;
            Game.resets = 1;
            const owned = [
                'Legacy', 'Heavenly cookies', 'How to bake your dragon', 'Box of brand biscuits', 'Heavenly luck',
                'Heavenly chip secret', 'Heavenly cookie stand', 'Heavenly bakery', 'Heavenly confectionery', 'Heavenly key',
            ];
            for (const name of owned) Game.Upgrades[name].earn();
            Game.CalculateGains();
        }, prestige);
        if (grimoire) {
            await game.eval(() => {
                Game.Objects['Wizard tower'].level = 1;
                Game.LoadMinigames();
            });
            await game.waitFor(() => !!(Game.Objects['Wizard tower'].minigame && Game.Objects['Wizard tower'].minigame.spells));
        }
        await game.eval(
            ({ r, g }) => {
                FrozenCookies.autoBuy = 1;
                FrozenCookies.autoClick = 1;
                FrozenCookies.cookieClickSpeed = 50;
                FrozenCookies.autoGods = 1;
                FrozenCookies.autoDragon = r === 'off' ? 0 : 1;
                FrozenCookies.autoFate = g ? 1 : 0;
                FCStart();
                MushieCookies.dragon.options.rule = r === 'off' ? 'measured' : r;
                window.__levels = [];
                window.__start = Date.now();
                MushieCookies.dragon.onLevelGained((level) => window.__levels.push({ t: Math.round((Date.now() - window.__start) / 1000), level }));
            },
            { r: rule, g: grimoire }
        );
        const points = [];
        let raEquippedAt = null;
        const started = Date.now();
        const polls = Math.round((hours * 3600) / POLL);
        for (let i = 1; i <= polls; i++) {
            await game.advanceSeconds(POLL);
            const p = await game.eval(() => {
                const M = Game.Objects['Wizard tower'].minigame;
                return {
                    t: Math.round((Date.now() - window.__start) / 1000),
                    level: Game.dragonLevel,
                    ra: Game.hasAura('Radiant Appetite'),
                    auras: [Game.dragonAura, Game.dragonAura2].map((a) => Game.dragonAuras[a].name),
                    earned: Game.cookiesEarned,
                    cps: Game.unbuffedCps,
                    buildings: Game.BuildingsOwned,
                    casts: M ? M.spellsCastTotal : 0,
                };
            });
            if (p.ra && raEquippedAt === null) raEquippedAt = p.t;
            if (i % POINT_EVERY === 0) points.push(p);
        }
        const end = await game.eval(() => ({
            levels: window.__levels,
            report: MushieCookies.dragon.report(),
            failures: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`),
        }));
        const last = points[points.length - 1];
        const learned = end.levels.find((l) => l.level >= 19);
        return {
            seed,
            rule,
            prestige,
            grimoire,
            hours,
            earned: last.earned,
            cps: last.cps,
            level: last.level,
            casts: last.casts,
            raLearnedAt: learned ? learned.t : null,
            raEquippedAt,
            levels: end.levels,
            decision: end.report.decision,
            failures: end.failures,
            errors: game.errors.slice(0, 5),
            wallSeconds: Math.round((Date.now() - started) / 1000),
            points,
        };
    } finally {
        await game.close();
    }
}

const results = [];
for (const seed of seeds) {
    for (const rule of rules) {
        const r = await run(seed, rule);
        results.push(r);
        console.log(JSON.stringify(r));
        process.stderr.write(
            `${seed} ${rule}: earned ${r.earned.toExponential(3)}, cps ${r.cps.toExponential(3)}, level ${r.level}, ` +
                `RA learned ${r.raLearnedAt === null ? '-' : r.raLearnedAt + ' s'}, equipped ${r.raEquippedAt === null ? '-' : r.raEquippedAt + ' s'}, ` +
                `casts ${r.casts}, wall ${r.wallSeconds} s${r.failures.length ? ' FAIL ' + r.failures.join('; ') : ''}\n`
        );
    }
}

// Summary: each rule against the first, seed by seed.
const [base, ...others] = rules;
for (const other of others) {
    const ratios = [];
    for (const seed of seeds) {
        const a = results.find((r) => r.seed === seed && r.rule === base);
        const b = results.find((r) => r.seed === seed && r.rule === other);
        ratios.push({ seed, earned: a.earned / b.earned, cps: a.cps / b.cps, ra: [a.raLearnedAt, b.raLearnedAt] });
    }
    const fmt = (xs) => `min ${Math.min(...xs).toFixed(3)}, max ${Math.max(...xs).toFixed(3)}, geomean ${Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length).toFixed(3)}`;
    process.stderr.write(`\n${base} / ${other} over ${hours} h at prestige ${prestige}${grimoire ? ', grimoire on' : ''}:\n`);
    for (const r of ratios) process.stderr.write(`  ${r.seed}: earned ${r.earned.toFixed(3)}x, final cps ${r.cps.toFixed(3)}x, RA learned at ${r.ra[0]} s vs ${r.ra[1]} s\n`);
    process.stderr.write(`  earned: ${fmt(ratios.map((r) => r.earned))}\n  final cps: ${fmt(ratios.map((r) => r.cps))}\n`);
}
