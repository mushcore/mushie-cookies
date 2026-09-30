// Compares the wrinkler system with the inherited "efficient" popping over a grandmapocalypse:
// the same fixture and seed under the inherited build and this one, golden cookies off so each run
// is deterministic for its seed; the seeds differ in when wrinklers spawn.
//
// Usage: node tools/dev/wrinklers.mjs <hours> <seed,seed,...> --baseline=<inherited dist main.js> [--no-bait] [--hold]
//   --baseline  the mod built from the commit before the wrinkler system (npm run build there,
//               then point at dist/MushieCookies/main.js)
//   --no-bait   without Unholy bait (slots refill five times slower)
//   --hold      also run this build with popping off (everything held until an ascension)
import path from 'node:path';
import { launchGame, BUILT_MOD } from '../../test/harness/game.mjs';

const hours = Number(process.argv[2] || 6);
const seeds = (process.argv[3] || 'w1,w2').split(',');
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const baseline = arg('baseline');
const bait = !process.argv.includes('--no-bait');
const hold = process.argv.includes('--hold');
if (!baseline) {
    console.error('--baseline=<inherited build main.js> is required');
    process.exit(1);
}

const variants = [
    { name: 'inherited', mod: path.resolve(baseline), autoWrinkler: 1 },
    { name: 'measured', mod: BUILT_MOD, autoWrinkler: 1 },
    ...(hold ? [{ name: 'hold', mod: BUILT_MOD, autoWrinkler: 0 }] : []),
];

async function run(variant, seed) {
    const game = await launchGame({ seed, mods: [variant.mod] });
    if (!game) throw new Error('game location not configured');
    try {
        await game.modStarted();
        await game.eval(
            ({ autoWrinkler, bait }) => {
                Game.shimmerTypes.golden.spawnConditions = () => false; // luck-free: one run per seed is exact
                // Fixture: a small bakery (the buyer needs income to rank anything, and wrath needs
                // grandmas), a bank the buyer turns into a mid-game bakery in its first minutes, and
                // the grandmapocalypse at full wrath with every slot empty.
                Game.Earn(1e15);
                for (const b of Game.ObjectsById.slice(0, 8)) b.buy(50);
                for (const name of ['One mind', 'Communal brainsweep', 'Elder Pact']) Game.Upgrades[name].earn();
                if (bait) Game.Upgrades['Unholy bait'].earn();
                Game.elderWrath = 3;
                FrozenCookies.autoBuy = 1;
                FrozenCookies.autoWrinkler = autoWrinkler;
                FCStart();
                window.__w = { samples: 0, attached: 0 };
                Game.registerHook('logic', () => {
                    if (Game.T % 30) return;
                    window.__w.samples++;
                    window.__w.attached += Game.wrinklers.filter((w) => w.phase == 2).length;
                });
            },
            { autoWrinkler: variant.autoWrinkler, bait }
        );
        const snap = () =>
            game.eval(() => ({
                earned: Game.cookiesEarned,
                // What an ascension would collect: every wrinkler's store at the game's pop multiplier.
                held: Game.wrinklers.reduce((s, w) => {
                    if (!(w.phase > 0)) return s;
                    let m = 1.1;
                    if (Game.Has('Sacrilegious corruption')) m *= 1.05;
                    m *= 1 + Game.auraMult('Dragon Guts') * 0.2;
                    if (w.type == 1) m *= 3;
                    if (Game.Has('Wrinklerspawn')) m *= 1.05;
                    return s + w.sucked * m;
                }, 0),
                cps: Game.unbuffedCps,
                popped: Game.wrinklersPopped,
                attached: window.__w.samples ? window.__w.attached / window.__w.samples : 0,
                buildings: Game.BuildingsOwned,
                upgrades: Game.UpgradesOwned,
                wrath: Game.elderWrath,
            }));
        const start = await snap();
        const points = [];
        const began = Date.now();
        for (let h = 1; h <= hours; h++) {
            await game.advanceSeconds(3600);
            const p = await snap();
            points.push({ hour: h, total: p.earned - start.earned + p.held, ...p });
        }
        const failures = await game.eval(() =>
            Object.entries(MushieCookies.status())
                .filter(([, s]) => s.failures > 0)
                .map(([n, s]) => `${n}: ${s.lastError}`)
        );
        return { variant: variant.name, seed, wall: Math.round((Date.now() - began) / 1000), start, points, failures };
    } finally {
        await game.close();
    }
}

const results = [];
for (const seed of seeds) {
    for (const variant of variants) {
        const r = await run(variant, seed);
        results.push(r);
        const last = r.points[r.points.length - 1];
        process.stderr.write(
            `${seed} ${variant.name.padEnd(9)} ${hours}h: total ${last.total.toExponential(3)} (held ${last.held.toExponential(2)}), cps ${last.cps.toExponential(3)}, ` +
                `popped ${last.popped}, mean attached ${last.attached.toFixed(2)}, wall ${r.wall}s${r.failures.length ? ' FAIL ' + r.failures.join('; ') : ''}\n`
        );
    }
}

// Ratio of cookies made (earned plus what the wrinklers hold) and of final CpS, per seed.
const byKey = new Map(results.map((r) => [`${r.seed}/${r.variant}`, r]));
const summary = {};
for (const name of variants.slice(1).map((v) => v.name)) {
    const ratios = seeds.map((seed) => {
        const a = byKey.get(`${seed}/inherited`).points.slice(-1)[0];
        const b = byKey.get(`${seed}/${name}`).points.slice(-1)[0];
        return { seed, total: b.total / a.total, cps: b.cps / a.cps };
    });
    const geo = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
    summary[name] = {
        perSeed: ratios,
        totalGeoMean: geo(ratios.map((r) => r.total)),
        totalRange: [Math.min(...ratios.map((r) => r.total)), Math.max(...ratios.map((r) => r.total))],
        cpsGeoMean: geo(ratios.map((r) => r.cps)),
        cpsRange: [Math.min(...ratios.map((r) => r.cps)), Math.max(...ratios.map((r) => r.cps))],
    };
}
for (const [name, s] of Object.entries(summary)) {
    console.error(
        `${name} / inherited over ${hours}h, ${seeds.length} seeds${bait ? '' : ', no Unholy bait'}: cookies ${s.totalGeoMean.toFixed(3)}x ` +
            `(range ${s.totalRange.map((x) => x.toFixed(3)).join(' to ')}), final CpS ${s.cpsGeoMean.toFixed(3)}x (range ${s.cpsRange.map((x) => x.toFixed(3)).join(' to ')})`
    );
}
console.log(JSON.stringify({ hours, seeds, bait, summary, results }));
