// Compares the wrinkler system with the inherited "efficient" popping over a grandmapocalypse:
// the same fixture and seed under the inherited build and this one, golden cookies off so each run
// is deterministic for its seed; the seeds differ in when wrinklers spawn.
//
// Usage: node tools/dev/wrinklers.mjs <hours> <seed,seed,...> --baseline=<inherited dist main.js> [--no-bait] [--hold] > runs.jsonl
//        node tools/dev/wrinklers.mjs --summarize=<runs.jsonl,...>
//   --baseline   the mod built from the commit before the wrinkler system (npm run build there,
//                then point at dist/MushieCookies/main.js)
//   --no-bait    without Unholy bait (slots refill five times slower)
//   --hold       also run this build with popping off (everything held until an ascension)
//   --only       runs just the named variants (inherited, measured, hold)
//   --summarize  prints the comparison from runs saved by earlier invocations
// Each finished run is printed at once as one JSON line, so a long comparison can be split
// across invocations (one seed each) and summarized afterwards.
import fs from 'node:fs';
import path from 'node:path';
import { launchGame, BUILT_MOD } from '../../test/harness/game.mjs';

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');

/** Per seed, each variant's cookies made (earned plus what the wrinklers hold) and final CpS against the inherited rule's. */
function summarize(runs) {
    const geo = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
    const groups = new Map(); // "hours/bait" -> runs
    for (const r of runs) {
        const key = `${r.hours}h${r.bait ? '' : ', no Unholy bait'}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    const out = {};
    for (const [key, group] of groups) {
        const last = (r) => r.points[r.points.length - 1];
        const inherited = new Map(group.filter((r) => r.variant === 'inherited').map((r) => [r.seed, r]));
        for (const name of [...new Set(group.map((r) => r.variant))].filter((n) => n !== 'inherited')) {
            const perSeed = group
                .filter((r) => r.variant === name && inherited.has(r.seed))
                .map((r) => {
                    const a = last(inherited.get(r.seed));
                    const b = last(r);
                    return { seed: r.seed, total: b.total / a.total, cps: b.cps / a.cps, pops: [a.popped, b.popped], attached: [a.attached, b.attached] };
                });
            if (!perSeed.length) continue;
            const s = {
                perSeed,
                totalGeoMean: geo(perSeed.map((p) => p.total)),
                totalRange: [Math.min(...perSeed.map((p) => p.total)), Math.max(...perSeed.map((p) => p.total))],
                cpsGeoMean: geo(perSeed.map((p) => p.cps)),
                cpsRange: [Math.min(...perSeed.map((p) => p.cps)), Math.max(...perSeed.map((p) => p.cps))],
            };
            out[`${name} / inherited, ${key}`] = s;
            console.error(
                `${name} / inherited over ${key}, ${perSeed.length} seeds: cookies ${s.totalGeoMean.toFixed(3)}x ` +
                    `(range ${s.totalRange.map((x) => x.toFixed(3)).join(' to ')}), final CpS ${s.cpsGeoMean.toFixed(3)}x ` +
                    `(range ${s.cpsRange.map((x) => x.toFixed(3)).join(' to ')})`
            );
        }
    }
    return out;
}

const summarizeFrom = arg('summarize');
if (summarizeFrom) {
    const runs = summarizeFrom
        .split(',')
        .flatMap((file) => fs.readFileSync(file, 'utf8').split('\n'))
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line))
        .filter((o) => o.type === 'run');
    console.log(JSON.stringify({ type: 'summary', summary: summarize(runs) }));
    process.exit(0);
}

const hours = Number(process.argv[2] || 6);
const seeds = (process.argv[3] || 'w1,w2').split(',');
const baseline = arg('baseline');
const bait = !process.argv.includes('--no-bait');
const hold = process.argv.includes('--hold');
if (!baseline) {
    console.error('--baseline=<inherited build main.js> is required');
    process.exit(1);
}

const only = arg('only') ? arg('only').split(',') : null; // run just these variants, e.g. to finish a split comparison
const variants = [
    { name: 'inherited', mod: path.resolve(baseline), autoWrinkler: 1 },
    { name: 'measured', mod: BUILT_MOD, autoWrinkler: 1 },
    ...(hold ? [{ name: 'hold', mod: BUILT_MOD, autoWrinkler: 0 }] : []),
].filter((v) => !only || only.includes(v.name));

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
        return { type: 'run', variant: variant.name, seed, hours, bait, wall: Math.round((Date.now() - began) / 1000), start, points, failures };
    } finally {
        await game.close();
    }
}

const results = [];
for (const seed of seeds) {
    for (const variant of variants) {
        const r = await run(variant, seed);
        results.push(r);
        console.log(JSON.stringify(r));
        const last = r.points[r.points.length - 1];
        process.stderr.write(
            `${seed} ${variant.name.padEnd(9)} ${hours}h: total ${last.total.toExponential(3)} (held ${last.held.toExponential(2)}), cps ${last.cps.toExponential(3)}, ` +
                `popped ${last.popped}, mean attached ${last.attached.toFixed(2)}, wall ${r.wall}s${r.failures.length ? ' FAIL ' + r.failures.join('; ') : ''}\n`
        );
    }
}
console.log(JSON.stringify({ type: 'summary', summary: summarize(results) }));
