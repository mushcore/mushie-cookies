// Compares heavenly planners over several ascensions: the same start, seed and hours under two
// builds of the mod, one game at a time, and prints prestige and heavenly upgrades owned.
//
// Usage:
//   node tools/dev/heavenly-ab.mjs --baseline=<built main.js> [--candidate=<built main.js>]
//        [--hours=8] [--starts=1e3,1e6,1e9] [--seeds=ab] [--no-golden] [--fixture=jump|longrun] > out.json
//
// The candidate defaults to this worktree's dist (npm run build). The baseline is another build,
// for instance of the commit before the planner changed:
//   git worktree add ../baseline 1ca4dc0 && (cd ../baseline && npm run build)
//   --baseline=../baseline/dist/MushieCookies/main.js
// Each run starts just after a first ascension at the start prestige, with the starter heavenly
// upgrades owned and the rest of the chips unspent (the fixture of tools/dev/longrun.mjs). With
// --fixture=jump (the default) the run has also baked what doubles its prestige, as a bank the
// buyer spends at once: the ascension system then ascends after its 30-minute minimum, and the
// planner under test spends about twice the start prestige in chips on a bakery it measured. With
// --fixture=longrun the run starts from nothing, which above a start of about 1e3 takes longer
// than a few game hours to reach its first ascension.
// Play is with buying, clicking, golden cookies (unless --no-golden) and ascension on. With golden
// cookies off a run is deterministic, so one seed per variant is a fair comparison; with them on,
// use several seeds and read the spread.
import path from 'node:path';
import { launchGame, BUILT_MOD } from '../../test/harness/game.mjs';

const arg = (name, fallback) => {
    const found = process.argv.find((a) => a.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : fallback;
};
const hours = Number(arg('hours', 8));
const jump = arg('fixture', 'jump') === 'jump';
const starts = arg('starts', '1e3,1e6,1e9').split(',').map(Number);
const seeds = arg('seeds', 'ab').split(',');
const noGolden = process.argv.includes('--no-golden');
const variants = { baseline: arg('baseline', null), candidate: arg('candidate', BUILT_MOD) };
if (!variants.baseline) {
    console.error('--baseline=<built main.js> is required');
    process.exit(1);
}

const STARTER = ['Legacy', 'Heavenly cookies', 'How to bake your dragon', 'Box of brand biscuits', 'Heavenly luck', 'Permanent upgrade slot I', 'Twin Gates of Transcendence', 'Belphegor'];

async function play(mod, start, seed) {
    const game = await launchGame({ seed, mods: [path.resolve(mod)] });
    if (!game) throw new Error('game location not configured');
    try {
        await game.modStarted();
        if (noGolden) await game.eval(() => { Game.shimmerTypes.golden.spawnConditions = () => false; });
        // Test fixture only: the state a first ascension at this prestige leaves behind.
        await game.eval(({ p, starter, jump }) => {
            Game.cookiesReset = Game.HowManyCookiesReset(p);
            Game.prestige = p;
            Game.heavenlyChipsSpent = 0;
            Game.heavenlyChips = p;
            Game.resets = 1;
            for (const name of starter) {
                const u = Game.Upgrades[name];
                if (u.getPrice() > Game.heavenlyChips) continue;
                Game.heavenlyChips -= u.getPrice();
                Game.heavenlyChipsSpent += u.getPrice();
                u.earn();
            }
            if (jump) Game.Earn(Game.HowManyCookiesReset(2 * p) - Game.cookiesReset);
            Game.CalculateGains();
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoGC = 1;
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            FrozenCookies.autoAscendToggle = 1;
            FCStart();
        }, { p: start, starter: STARTER, jump });
        const points = [];
        const started = Date.now();
        for (let h = 1; h <= hours; h++) {
            await game.advanceSeconds(3600);
            points.push(
                await game.eval(() => ({
                    prestige: Game.prestige,
                    projected: Math.floor(MushieCookies.ascension.report().projected),
                    ascensions: Game.resets,
                    heavenly: Game.PrestigeUpgrades.filter((u) => u.bought).length,
                    chips: Game.heavenlyChips,
                    cps: Game.unbuffedCps,
                }))
            );
            const p = points[points.length - 1];
            process.stderr.write(`  ${h}h prestige=${p.prestige} projected=${p.projected} ascensions=${p.ascensions} heavenly=${p.heavenly} cps=${p.cps.toExponential(2)}\n`);
        }
        const owned = await game.eval(() => Game.PrestigeUpgrades.filter((u) => u.bought).map((u) => u.name));
        const failures = await game.eval(() => Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`));
        return { points, owned, failures, errors: game.errors.slice(0, 5), wallSeconds: Math.round((Date.now() - started) / 1000) };
    } finally {
        await game.close();
    }
}

const runs = [];
for (const start of starts) {
    for (const seed of seeds) {
        for (const [variant, mod] of Object.entries(variants)) {
            process.stderr.write(`${variant} start=${start} seed=${seed}\n`);
            runs.push({ variant, start, seed, ...(await play(mod, start, seed)) });
        }
    }
}

// The prestige a run ends at, projected: what an ascension now would give, which counts the
// last run's progress as well as the ascensions already made.
const last = (r) => r.points[r.points.length - 1];
const summary = [];
for (const start of starts) {
    for (const seed of seeds) {
        const pick = (v) => runs.find((r) => r.start === start && r.seed === seed && r.variant === v);
        const a = pick('baseline');
        const b = pick('candidate');
        summary.push({
            start,
            seed,
            baseline: { projected: last(a).projected, ascensions: last(a).ascensions, heavenly: last(a).heavenly },
            candidate: { projected: last(b).projected, ascensions: last(b).ascensions, heavenly: last(b).heavenly },
            ratio: last(a).projected > 0 ? last(b).projected / last(a).projected : null,
        });
    }
}
for (const s of summary) {
    process.stderr.write(
        `start ${s.start} seed ${s.seed}: projected prestige ${s.baseline.projected} -> ${s.candidate.projected} (${s.ratio && s.ratio.toFixed(3)}x); ` +
            `heavenly ${s.baseline.heavenly} -> ${s.candidate.heavenly}; ascensions ${s.baseline.ascensions} -> ${s.candidate.ascensions}\n`
    );
}
console.log(JSON.stringify({ hours, fixture: jump ? 'jump' : 'longrun', goldenCookies: !noGolden, variants, summary, runs }, null, 1));
