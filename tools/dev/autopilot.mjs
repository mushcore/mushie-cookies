// Plays a fresh save with nothing but the Autopilot, the way a new player would install the mod
// and walk away, and reports every system each game hour.
// Usage: node tools/dev/autopilot.mjs <gameHours> [seed] [--no-golden] [--every=hours] [--first-target=prestige]
//          [--save-at=h1,h2,...] [--checkpoint-dir=dir] [--from=checkpoint.json] [--mod=built main.js] > out.json
// --save-at writes a checkpoint (the save and the virtual time) at those hours; --from resumes one,
// so A/B runs can branch from a shared state instead of replaying the hours before it.
import fs from 'node:fs';
import path from 'node:path';
import { launchWithMod, launchGame } from '../../test/harness/game.mjs';

const hours = Number(process.argv[2] || 24);
const seed = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'autopilot';
const noGolden = process.argv.includes('--no-golden');
const everyArg = process.argv.find((a) => a.startsWith('--every='));
const every = everyArg ? Number(everyArg.split('=')[1]) : 1;
const targetArg = process.argv.find((a) => a.startsWith('--first-target='));
const firstTarget = targetArg ? Number(targetArg.split('=')[1]) : null;

const arg = (name) => {
    const a = process.argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : null;
};
const saveAt = new Set((arg('save-at') || '').split(',').filter(Boolean).map(Number));
const checkpointDir = arg('checkpoint-dir') || '.';
const from = arg('from') ? JSON.parse(fs.readFileSync(arg('from'), 'utf8')) : null;
const startHour = from ? from.hour : 0;
if (from) process.stderr.write(`resuming ${from.seed} at hour ${from.hour}
`);

// --mod pins a built mod file, so a run queued for a game slot does not pick up a later build.
const modFile = arg('mod');
const game = modFile
    ? await launchGame({ seed, autopilot: true, checkpoint: from, mods: [path.resolve(modFile)] }).then(async (g) => {
          if (g) await g.modStarted();
          return g;
      })
    : await launchWithMod({ seed, autopilot: true, checkpoint: from });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}

function snapshot() {
    const G = Game.Objects;
    const minigame = (name) => G[name].minigame;
    const garden = minigame('Farm');
    const market = minigame('Bank');
    const temple = minigame('Temple');
    const grimoire = minigame('Wizard tower');
    const promptOpen = !!Game.promptOn;
    return {
        autopilot: FrozenCookies.autopilot,
        earnedAllTime: Game.cookiesEarned + Game.cookiesReset,
        bank: Game.cookies,
        cps: Game.unbuffedCps,
        prestige: Game.prestige,
        ascensions: Game.resets,
        phase: MushieCookies.ascension ? MushieCookies.ascension.report().phase : null,
        verdict: MushieCookies.ascension && MushieCookies.ascension.report().verdict ? MushieCookies.ascension.report().verdict.reason : null,
        heavenly: Game.PrestigeUpgrades.filter((u) => u.bought).length,
        buildings: Game.BuildingsOwned,
        upgrades: Game.UpgradesOwned,
        achievements: Game.AchievementsOwned,
        lumps: Game.lumps,
        levels: { farm: G.Farm.level, bank: G.Bank.level, temple: G.Temple.level, wizard: G['Wizard tower'].level, cursor: G.Cursor.level },
        minigames: [garden && 'garden', market && 'market', temple && 'pantheon', grimoire && 'grimoire'].filter(Boolean),
        garden: garden ? { seeds: garden.plantsUnlockedN, of: garden.plantsN, soil: garden.soilsById[garden.soil].name, plots: garden.plotLimits ? null : undefined } : null,
        market: market ? { profit: market.profit, brokers: market.brokers, office: market.officeLevel, held: market.goodsById.reduce((s, g) => s + g.stock, 0) } : null,
        gods: temple ? temple.slot.map((id) => (id === -1 ? '-' : temple.godsById[id].name)) : null,
        grimoire: grimoire ? { magic: Math.floor(grimoire.magic), max: Math.floor(grimoire.magicM), cast: grimoire.spellsCastTotal } : null,
        dragon: { level: Game.dragonLevel, auras: [Game.dragonAura, Game.dragonAura2].map((a) => Game.dragonAuras[a].name) },
        season: Game.season || '-',
        wrinklers: Game.wrinklers.filter((w) => w.phase === 2).length,
        buffs: Object.keys(Game.buffs),
        promptOpen,
        failures: Object.entries(MushieCookies.status())
            .filter(([, s]) => s.failures > 0)
            .map(([n, s]) => `${n}${s.disabled ? ' (off)' : ''}: ${s.lastError}`),
    };
}

const fmt = (n) => (Number.isFinite(n) ? n.toExponential(2) : String(n));
try {
    if (noGolden) await game.eval(() => { Game.shimmerTypes.golden.spawnConditions = () => false; });
    if (firstTarget) await game.eval((t) => { MushieCookies.ascension.options.firstTarget = t; }, firstTarget);
    const points = [];
    const started = Date.now();
    for (let h = startHour + every; h <= startHour + hours; h += every) {
        await game.advanceSeconds(every * 3600);
        const p = await game.eval(snapshot);
        points.push({ hour: h, ...p });
        if (saveAt.has(h)) {
            const file = path.join(checkpointDir, `${seed}-h${h}.json`);
            fs.mkdirSync(checkpointDir, { recursive: true });
            fs.writeFileSync(file, JSON.stringify({ seed, hour: h, ...(await game.takeCheckpoint()) }));
            process.stderr.write(`checkpoint written: ${file}
`);
        }
        process.stderr.write(
            `${String(h).padStart(4)}h earned=${fmt(p.earnedAllTime)} cps=${fmt(p.cps)} prestige=${p.prestige} asc=${p.ascensions} heavenly=${p.heavenly} ` +
                `b=${p.buildings} u=${p.upgrades} ach=${p.achievements} lumps=${p.lumps} lv=${Object.values(p.levels).join('/')} ` +
                `mg=${p.minigames.join('+') || '-'}${p.garden ? ` seeds=${p.garden.seeds}/${p.garden.of}` : ''}${p.market ? ` mkt=${fmt(p.market.profit)}` : ''}` +
                `${p.gods ? ` gods=${p.gods.join(',')}` : ''}${p.grimoire ? ` cast=${p.grimoire.cast}` : ''} dragon=${p.dragon.level}:${p.dragon.auras.join(',')}` +
                ` wr=${p.wrinklers}${p.promptOpen ? ' PROMPT' : ''} | ${p.phase}: ${p.verdict}${p.failures.length ? ' | FAIL ' + p.failures.join('; ') : ''}\n`
        );
    }
    console.log(JSON.stringify({ seed, firstTarget, goldenCookies: !noGolden, wallSeconds: Math.round((Date.now() - started) / 1000), errors: game.errors.slice(0, 20), points }, null, 1));
} finally {
    await game.close();
}
