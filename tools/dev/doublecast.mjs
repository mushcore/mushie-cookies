// Compares double-casting Force the Hand of Fate with casting it alone, from the same late-run
// bakery. Double casting needs about 300 Wizard towers, so the fixture is a late run: prestige
// stands in for the run's heavenly multipliers, and buildings and upgrades are bought greedily by
// CpS per cookie with free money until the Wizard towers reach the target, which leaves a bakery
// in balance the way the buyer keeps one. From there the buyer, clicking, golden cookie clicking
// and forecast casting run for the given game hours, with Double Cast off or on.
//
// Casting outcomes come from the game's seed and the spell count (minigameGrimoire.js:312), so
// with natural golden cookies off (--no-golden) both variants of a seed face the same outcomes:
// a luck-free, paired comparison. With them on, natural golden cookies and storm drops draw from
// generators of their own seeded by the seed (pairGoldenLuck), so both variants of a seed see the
// same natural cookies at the same moments until what the variants did changes an outcome (a
// Lucky's payout follows the bank, a chain the bank too); the seeds differ in their luck.
//
// Usage: node tools/dev/doublecast.mjs <gameHours> <seed> <single|double> [--no-golden]
//        [--prestige=N] [--towers=N] [--payback=seconds] [--calibrate] [--mod=built main.js] > out.json
import path from 'node:path';
import { launchWithMod, launchGame } from '../../test/harness/game.mjs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const option = (name, fallback) => {
    const found = args.find((a) => a.startsWith(`--${name}=`));
    return found ? Number(found.split('=')[1]) : fallback;
};
const hours = Number(positional[0] || 6);
const seed = positional[1] || 'doublecast';
const variant = positional[2] || 'double';
const golden = !args.includes('--no-golden');
const calibrate = args.includes('--calibrate');
const prestige = option('prestige', 1e15);
const towers = option('towers', 450);
const payback = option('payback', 3600);

// --mod pins a built mod file, so a run queued for a game slot does not pick up a later build.
const modArg = args.find((a) => a.startsWith('--mod='));
const game = modArg
    ? await launchGame({ seed, mods: [path.resolve(modArg.slice('--mod='.length))] }).then(async (g) => {
          if (g) await g.modStarted();
          return g;
      })
    : await launchWithMod({ seed });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
const doubles = [];
// --trace: every grimoire line to stderr, to see why two variants part.
const trace = args.includes('--trace');
game.page.on('console', (m) => {
    const text = m.text();
    if (text.includes('double cast')) doubles.push(text.replace('[Mushie Cookies] ', ''));
    if (trace && /Hand of Fate|double cast|Haggler/.test(text)) process.stderr.write(`${text}\n`);
});

/** Runs the variant for `hours` from the fixture and prints the result. */
async function measure(start, fixture, started) {
    const points = [];
    for (let h = 1; h <= hours; h++) {
        if (trace) {
            // Minute by minute: cookies earned, what the double cast keeps from the buyer (in
            // seconds of CpS), and the grimoire's last decisions.
            for (let m = 1; m <= 60; m++) {
                await game.advanceSeconds(60);
                const k = await game.eval(() => {
                    const r = MushieCookies.grimoire.report();
                    return {
                        earned: Game.cookiesEarned,
                        kept: MushieCookies.buyer.kept('grimoire') / Game.unbuffedCps,
                        towers: Game.Objects['Wizard tower'].amount,
                        decision: r.decision && `${r.decision.action} ${r.decision.next}: ${r.decision.reason}`,
                        double: r.double && `${r.double.action} ${r.double.second}: ${r.double.reason}`,
                        buyer: MushieCookies.buyer.activity(),
                        held: MushieCookies.buyer.held(),
                        next: (() => {
                            const n = MushieCookies.buyer.next();
                            return n ? `${n.name} ${(n.price / Game.unbuffedCps).toFixed(0)} s` : null;
                        })(),
                        buffs: Object.keys(Game.buffs).join('+'),
                    };
                });
                process.stderr.write(
                    `${h - 1}h${m}m earned ${(k.earned - start.earned).toExponential(4)} kept ${k.kept.toFixed(0)} s towers ${k.towers} ` +
                        `bought ${k.buyer.purchases} ranks ${k.buyer.ranks}${k.held ? ' HELD' : ''} next ${k.next} [${k.buffs}] | ${k.decision} | ${k.double}\n`
                );
            }
        } else await game.advanceSeconds(3600);
        const p = await game.eval(() => ({
            earned: Game.cookiesEarned,
            cps: Game.unbuffedCps,
            towers: Game.Objects['Wizard tower'].amount,
            report: MushieCookies.grimoire.report(),
        }));
        points.push(p);
        process.stderr.write(`${seed} ${variant} ${h}h earned ${(p.earned - start.earned).toExponential(3)} casts ${p.report.casts} doubles ${p.report.doubles}\n`);
    }
    const end = points[points.length - 1];
    const out = await game.eval(() => ({
        spells: Game.Objects['Wizard tower'].minigame.spellsCastTotal,
        failures: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`),
    }));
    console.log(
        JSON.stringify({
            seed,
            variant,
            hours,
            golden,
            prestige,
            fixture: { ...fixture, ...start },
            earnedBeyondFixture: end.earned - start.earned,
            earnedByHour: points.map((p) => p.earned - start.earned),
            cpsEnd: end.cps,
            towersEnd: end.towers,
            spells: out.spells - start.spells,
            report: end.report,
            doubles,
            failures: out.failures,
            errors: game.errors.slice(0, 5),
            wallSeconds: Math.round((Date.now() - started) / 1000),
        })
    );
}

try {
    const started = Date.now();
    // Test fixture only (it writes game state freely). Natural golden cookies stay off while the
    // bakery is built, so every variant of a seed starts from the same state.
    await game.eval((p) => {
        window.__spawn = Game.shimmerTypes.golden.spawnConditions;
        Game.shimmerTypes.golden.spawnConditions = () => false;
        Game.prestige = p;
        for (const name of ['Heavenly chip secret', 'Heavenly cookie stand', 'Heavenly bakery', 'Heavenly confectionery', 'Heavenly key']) Game.Upgrades[name].earn();
        // A late run has clicked enough for every mouse upgrade and golden cookie upgrade to unlock
        // (main.js:16426-16440, 5409-5411).
        Game.handmadeCookies = 1e100;
        Game.goldenClicks = 777;
        for (const name of ['Lucky day', 'Serendipity', 'Get lucky']) Game.Unlock(name);
    }, prestige);
    const fixture = { rounds: 0, upgrades: 0 };
    for (; fixture.rounds < 600; fixture.rounds++) {
        // Upgrades that cost under an hour of CpS, then buildings by CpS per cookie, with free money.
        const round = await game.eval(
            ({ towers, payback, never }) => {
                const skip = new Set(never);
                Game.CalculateGains();
                const budget = Game.cookiesPs * 3600;
                const cheap = Object.values(Game.UpgradesById).filter(
                    (u) => u.unlocked && !u.bought && (u.pool === '' || u.pool === 'cookie') && !skip.has(u.id) && u.getPrice() <= budget
                );
                for (const u of cheap) {
                    Game.Earn(u.getPrice());
                    u.buy(1);
                }
                const tower = Game.Objects['Wizard tower'];
                const bestBuilding = () => {
                    Game.CalculateGains();
                    let best = null;
                    for (const b of Game.ObjectsById) {
                        const seconds = b.getSumPrice(10) / (10 * b.storedCps * Game.globalCpsMult);
                        if (!best || seconds < best.payback) best = { b, payback: seconds };
                    }
                    return best;
                };
                let best = bestBuilding();
                // Until the Wizard towers reach the target and no building repays within `payback`
                // seconds, as in a bakery the buyer has kept up with.
                for (let i = 0; i < 25 && (tower.amount < towers || best.payback < payback); i++) {
                    Game.Earn(best.b.getSumPrice(10));
                    best.b.buy(10);
                    best = bestBuilding();
                }
                return { upgrades: cheap.length, done: tower.amount >= towers && best.payback >= payback && cheap.length === 0 };
            },
            { towers, payback, never: [74, 84, 85, 227, 331, 332, 333, 361, 414, 452, 563, 564, 806] }
        );
        fixture.upgrades += round.upgrades;
        // The game unlocks upgrades and awards achievements every five seconds (main.js:16315).
        await game.advance(151);
        if (round.done) break;
    }
    await game.eval(() => {
        Game.Objects['Wizard tower'].level = 1;
        Game.LoadMinigames();
        Game.shimmerTypes.golden.spawnConditions = window.__spawn;
    });
    await game.waitFor(() => !!(Game.Objects['Wizard tower'].minigame && Game.Objects['Wizard tower'].minigame.spells));
    const start = await game.eval(
        ({ variant, golden, seed }) => {
            /**
             * Test fixture: pairs the golden cookie luck of the two variants of a seed. Natural
             * golden cookies (the spawn roll, the cookie, its outcome, any chain it starts) and
             * storm drops draw from generators of their own, seeded by the seed, instead of
             * Math.random, which each purchase also draws from (its sound, main.js choose()) and so
             * parts as soon as the variants buy differently. Spawning is main.js:5249-5286 with
             * those generators; cookies a spell makes draw from Math.random as before.
             */
            function pairGoldenLuck(name) {
                const generator = (text) => {
                    let a = 2166136261;
                    for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 16777619);
                    return () => {
                        a = (a + 0x6d2b79f5) | 0;
                        let t = Math.imul(a ^ (a >>> 15), 1 | a);
                        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                    };
                };
                const natural = generator(`${name} natural golden`);
                const storm = generator(`${name} storm drops`);
                const using = (random, f) => {
                    const own = Math.random;
                    Math.random = random;
                    try {
                        return f();
                    } finally {
                        Math.random = own;
                    }
                };
                Game.updateShimmers = function () {
                    for (const i in Game.shimmers) Game.shimmers[i].update();
                    using(storm, () => {
                        if (Game.hasBuff('Cookie storm') && Math.random() < 0.5) {
                            const drop = new Game.shimmer('golden', { type: 'cookie storm drop' }, 1);
                            drop.dur = Math.ceil(Math.random() * 4 + 1);
                            drop.life = Math.ceil(Game.fps * drop.dur);
                            drop.sizeMult = Math.random() * 0.75 + 0.25;
                            drop.__luck = storm;
                        }
                    });
                    for (const i in Game.shimmerTypes) {
                        const me = Game.shimmerTypes[i];
                        if (!me.spawnsOnTimer || !me.spawnConditions() || me.spawned) continue;
                        me.time++;
                        using(i === 'golden' ? natural : Math.random, () => {
                            if (Math.random() < Math.pow(Math.max(0, (me.time - me.minTime) / (me.maxTime - me.minTime)), 5)) {
                                const lead = new Game.shimmer(i);
                                lead.spawnLead = 1;
                                lead.__luck = natural;
                                if (Game.Has('Distilled essence of redoubled luck') && Math.random() < 0.01) new Game.shimmer(i).__luck = natural;
                                me.spawned = 1;
                            }
                        });
                    }
                };
                const pop = Game.shimmerTypes.golden.popFunc;
                Game.shimmerTypes.golden.popFunc = function (me) {
                    if (!me.__luck) return pop.call(this, me);
                    const before = new Set(Game.shimmers);
                    const out = using(me.__luck, () => pop.call(this, me));
                    // A chain goes on with a cookie of its own, as lucky as the one before.
                    for (const s of Game.shimmers) if (!before.has(s)) s.__luck = me.__luck;
                    return out;
                };
            }
            const M = Game.Objects['Wizard tower'].minigame;
            M.computeMagicM();
            M.magic = M.magicM;
            Game.killBuffs();
            Game.CalculateGains();
            // An hour of CpS in the bank.
            Game.cookies = Game.cookiesPs * 3600;
            if (!golden) Game.shimmerTypes.golden.spawnConditions = () => false;
            else pairGoldenLuck(seed);
            Object.assign(FrozenCookies, {
                autoBuy: 1,
                autoGC: 1,
                autoClick: 1,
                cookieClickSpeed: 50,
                autoFate: 1,
                autoFTHOFCombo: variant === 'double' ? 1 : 0,
                autoCasting: 0,
                auto100ConsistencyCombo: 0,
            });
            FCStart();
            const tower = Game.Objects['Wizard tower'];
            return {
                earned: Game.cookiesEarned,
                cps: Game.unbuffedCps,
                towers: tower.amount,
                magicM: M.magicM,
                towerPriceInCps: tower.getPrice() / Game.unbuffedCps,
                buildings: Object.fromEntries(Game.ObjectsById.map((b) => [b.name, b.amount])),
                upgrades: Game.UpgradesOwned,
                clickShare: Game.computedMouseCps / Game.unbuffedCps,
                spells: M.spellsCastTotal,
            };
        },
        { variant, golden, seed }
    );
    if (calibrate) {
        await game.advanceSeconds(10);
        const next = await game.eval(() => {
            const r = MushieCookies.buyer.report();
            return { next: r.next && { name: r.next.name, payback: r.next.payback, priceInCps: r.next.price / Game.unbuffedCps }, reserve: r.reserve / Game.unbuffedCps };
        });
        console.log(JSON.stringify({ seed, prestige, fixture, start, next, wallSeconds: Math.round((Date.now() - started) / 1000) }, null, 1));
    }
    if (!calibrate) await measure(start, fixture, started);
} finally {
    await game.close();
}
