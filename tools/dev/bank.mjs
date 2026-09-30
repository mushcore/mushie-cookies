// Measures the market's parts from the same mid-game bakery: trading with the cash allocator
// against the rule it replaces (spend everything above the reserve) and against no trading, then
// office upgrades, brokers and loans each added on. Golden cookies are off unless --golden is
// given, and the market's prices draw from a generator of their own (ownMarketLuck below), so
// every variant of a seed sees the same prices and a luck-free pair is a controlled comparison;
// the prices still differ from seed to seed, so use several. Each hour's trace carries every
// good's price, for checking that (test/game/bank-tool.test.mjs). Loans pay only on combos, so
// they are measured on combos: golden cookies and forecast casting on (where the first difference
// sends the golden cookies down another path, so a run compares nothing), or luck-free with the
// same combo forced on a schedule in every variant (--combo).
// Runs before ownMarketLuck (b4ad7bc, dab8410 and earlier) shared the market's draws with every
// other draw of the game, so their luck-free pairs were not controlled.
// Usage: node tools/dev/bank.mjs <gameHours> <seed> <variant> [--golden] [--office=N] [--combo=M] > out.json
//   variants: nomarket | reserve | market | office | broker | loan | loan3
//   --office=N starts the market at office level N (loans need 2, 4 and 5), with office buying off.
//   --early starts from an early bakery instead, where purchases repay in minutes.
//   --combo=M every M game minutes the fixture gives a Frenzy (x7, 77 s) and a Click frenzy
//   (x777, 13 s) at once, as a golden cookie pair would (main.js:5540-5563).
//   --prestige=P plays a whole run instead, luck-free, from just after an ascension at prestige P
//   until the ascension system ends it (or <gameHours>): loans on against off, with the office at
//   --office (default 2, where loan 1 shows). Before b4ad7bc removed the run-end occasion, it
//   measured debt evasion; with --frenzy=M (a plain Frenzy, x7 for 77 s, every M game minutes in
//   every variant) it checks that no loan is taken for the run's end on a spike either.
import { launchWithMod } from '../../test/harness/game.mjs';

const hours = Number(process.argv[2] || 12);
const seed = process.argv[3] || 'bank-a';
const variant = process.argv[4] || 'office';
const golden = process.argv.includes('--golden');
const officeArg = process.argv.find((a) => a.startsWith('--office='));
const startOffice = officeArg ? Number(officeArg.split('=')[1]) : null;
const early = process.argv.includes('--early');
const comboArg = process.argv.find((a) => a.startsWith('--combo='));
const comboSeconds = comboArg ? Number(comboArg.split('=')[1]) * 60 : 0;
const prestigeArg = process.argv.find((a) => a.startsWith('--prestige='));
const prestige = prestigeArg ? Number(prestigeArg.split('=')[1]) : null;
const frenzyArg = process.argv.find((a) => a.startsWith('--frenzy='));
const frenzySeconds = frenzyArg ? Number(frenzyArg.split('=')[1]) * 60 : 0;
const VARIANTS = ['nomarket', 'reserve', 'market', 'office', 'broker', 'loan', 'loan3'];
if (!VARIANTS.includes(variant)) {
    console.error(`variant must be one of ${VARIANTS.join(', ')}`);
    process.exit(1);
}

const game = await launchWithMod({ seed });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}

/**
 * Test fixture: the market's price ticks draw from a generator of their own, seeded by the seed,
 * so every variant of a seed sees the same prices. The game draws them from Math.random
 * (minigameMarket.js:806-871), which every building bought also draws from (its sound,
 * main.js:7854): without this, a variant that bought one thing differently sent the prices down
 * another path, and a comparison measured the market's luck along with the variant. The draws
 * are the game's own generator (Math.seedrandom, main.js:702), so the prices move as in play.
 * Called once the market is open and before the variants differ; the market's opening prices
 * (M.reset, :776-795) are drawn before it, alike in every variant.
 */
async function ownMarketLuck() {
    await game.eval((key) => {
        const shared = Math.random;
        Math.seedrandom(key);
        const own = Math.random;
        Math.random = shared;
        const M = Game.Objects['Bank'].minigame;
        const tick = M.tick;
        M.tick = function () {
            const outside = Math.random;
            Math.random = own;
            try {
                return tick.apply(this, arguments);
            } finally {
                Math.random = outside;
            }
        };
    }, `market/${seed}`);
}

/**
 * A whole run through the ascension system's own ascension. Test fixture: the lump tool's
 * post-ascension start (tools/dev/lumps.mjs run), with the stock market open at the office level
 * given. The ascension's own currency is log-prestige per second of run, plus its 300 s overhead.
 */
async function wholeRun() {
    await game.eval(([p, office, v]) => {
        Game.shimmerTypes.golden.spawnConditions = () => false;
        Game.cookiesReset = Game.HowManyCookiesReset(p);
        Game.prestige = p;
        Game.heavenlyChips = 0;
        Game.resets = 1;
        const owned = ['Legacy', 'Heavenly cookies', 'How to bake your dragon', 'Box of brand biscuits', 'Heavenly luck', 'Permanent upgrade slot I', 'Twin Gates of Transcendence', 'Belphegor'];
        for (const name of owned) Game.Upgrades[name].earn();
        for (const b of Game.ObjectsById) b.level = 10;
        Game.CalculateGains();
        Game.LoadMinigames();
        window.__run = { p0: p, start: Game.startDate, office };
        Object.assign(FrozenCookies, {
            autoBuy: 1,
            autoClick: 1,
            cookieClickSpeed: 50,
            autoAscendToggle: 1,
            autoMarket: 1,
            autoBank: 0,
            autoBroker: 0,
            autoLoan: v === 'loan' ? 1 : v === 'loan3' ? 2 : 0,
        });
        FCStart();
    }, [prestige, startOffice === null ? 2 : startOffice, variant]);
    await game.waitFor(() => !!(Game.Objects['Bank'].minigame && Game.Objects['Bank'].minigame.goodsById));
    await ownMarketLuck();
    await game.eval(() => {
        Game.Objects['Bank'].minigame.officeLevel = window.__run.office;
    });
    const started = Date.now();
    let row = null;
    let t = 0;
    let nextFrenzy = frenzySeconds || Infinity;
    const decisions = {}; // the loan decision a minute into each Frenzy, counted by reason
    for (let q = 1; q <= hours * 4 && !row; q++) {
        while (t < q * 900) {
            const until = Math.min(q * 900, nextFrenzy);
            await game.advanceSeconds(until - t);
            t = until;
            if (t === nextFrenzy) {
                // Test fixture: the same plain Frenzy at the same time in every variant.
                await game.eval(() => {
                    if (!Game.OnAscend && !Game.AscendTimer) Game.gainBuff('frenzy', 77, 7);
                });
                nextFrenzy += frenzySeconds;
                await game.advanceSeconds(60);
                t += 60;
                const loan = await game.eval(() => MushieCookies.market.report().loan);
                const reason = !loan ? 'none decided' : loan.taken ? `took loan ${loan.taken.id}` : loan.reason;
                decisions[reason] = (decisions[reason] || 0) + 1;
            }
        }
        row = await game.eval(() => {
            const asc = MushieCookies.ascension.report();
            if (Game.resets < 2 || !asc.last) return null;
            return {
                runSeconds: (asc.last.at - window.__run.start) / 1000,
                prestigeAfter: asc.last.prestige,
                debtEvasion: !!Game.Achievements['Debt evasion'].won,
            };
        });
    }
    const out = await game.eval(() => ({
        market: MushieCookies.market.report(),
        projected: MushieCookies.ascension.report().projected,
        status: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`),
    }));
    const u = (x) => Math.log(1 + x);
    console.log(
        JSON.stringify({
            seed,
            variant,
            prestige,
            frenzyMinutes: frenzySeconds / 60 || null,
            office: startOffice === null ? 2 : startOffice,
            hours,
            wallSeconds: Math.round((Date.now() - started) / 1000),
            ascended: !!row,
            runHours: row && row.runSeconds / 3600,
            prestigeGained: row ? row.prestigeAfter - prestige : Math.floor(out.projected) - prestige,
            yieldPerSecond: row ? (u(row.prestigeAfter) - u(prestige)) / (row.runSeconds + 300) : null,
            debtEvasion: row && row.debtEvasion,
            loans: out.market.loans,
            lastLoan: out.market.loan,
            frenzyDecisions: decisions,
            status: out.status,
            errors: game.errors.slice(0, 5),
        })
    );
}

try {
    if (prestige !== null) {
        await wholeRun();
    } else {
        if (!golden) await game.eval(() => { Game.shimmerTypes.golden.spawnConditions = () => false; });
        // Test fixture: the market audit's mid-game bakery, with the Grimoire open for the
        // loan runs and Cursor level 12, so every office can be bought if it is judged worth it.
        await game.eval((early) => {
            if (early) {
                // An hour or so into a first run: a few of each early building and the market open.
                Game.Earn(3e7);
                for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank']) Game.Objects[name].buy(15);
                Game.Objects['Bank'].level = 1;
            } else {
                Game.Earn(1e15);
                for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(50);
                Game.Objects['Bank'].level = 3;
                Game.Objects['Wizard tower'].level = 1;
            }
            Game.Objects['Cursor'].level = 12;
            Game.LoadMinigames();
        }, early);
        await game.waitFor((early) => !!(Game.Objects['Bank'].minigame && Game.Objects['Bank'].minigame.goodsById && (early || Game.Objects['Wizard tower'].minigame)), early);
        await ownMarketLuck();
        await game.eval(([v, golden, startOffice]) => {
            if (startOffice !== null) Game.Objects['Bank'].minigame.officeLevel = startOffice;
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            FrozenCookies.autoGC = golden ? 1 : 0;
            FrozenCookies.autoFate = golden ? 1 : 0;
            FrozenCookies.autoMarket = v === 'nomarket' ? 0 : 1;
            FrozenCookies.autoBank = startOffice === null && ['office', 'broker', 'loan', 'loan3'].includes(v) ? 1 : 0;
            FrozenCookies.autoBroker = v === 'broker' ? 1 : 0;
            FrozenCookies.autoLoan = v === 'loan' ? 1 : v === 'loan3' ? 2 : 0;
            MushieCookies.market.options.allocator = v === 'reserve' ? 'reserve' : 'committed';
            FCStart();
        }, [variant, golden, startOffice]);
        const t0 = await game.eval(() => ({ earned: Game.cookiesEarned, profit: Game.Objects['Bank'].minigame.profit }));
        const started = Date.now();
        const points = [];
        const trace = [];
        let t = 0;
        let nextCombo = comboSeconds || Infinity;
        for (let h = 1; h <= hours; h++) {
            while (t < h * 3600) {
                const until = Math.min(h * 3600, nextCombo);
                await game.advanceSeconds(until - t);
                t = until;
                if (t === nextCombo) {
                    // Test fixture: the same combo at the same time in every variant.
                    await game.eval(() => {
                        Game.gainBuff('frenzy', 77, 7);
                        Game.gainBuff('click frenzy', 13, 777);
                    });
                    nextCombo += comboSeconds;
                }
            }
            const p = await game.eval(() => {
                const M = Game.Objects['Bank'].minigame;
                let held$ = 0;
                for (const g of M.goodsById) held$ += g.stock * g.val;
                const prices = M.goodsById.map((g) => g.val);
                return { earned: Game.cookiesEarned, cps: Game.unbuffedCps, bank: Game.cookies, held$, profit$: M.profit, office: M.officeLevel, brokers: M.brokers, prices };
            });
            points.push(p.earned);
            // Where the cookies are each hour: in buildings (CpS), in the bank, or held in stock; and
            // every good's price, which must be the same in every variant of a seed.
            trace.push({ h, cps: +p.cps.toExponential(3), bank: +p.bank.toExponential(3), held$: Math.round(p.held$), profit$: Math.round(p.profit$ - t0.profit), office: p.office, brokers: p.brokers, prices: p.prices });
        }
        const out = await game.eval(() => {
            const M = Game.Objects['Bank'].minigame;
            let held$ = 0;
            for (const g of M.goodsById) held$ += g.stock * g.val;
            return {
                earned: Game.cookiesEarned,
                cps: Game.unbuffedCps,
                rawHighest: Game.cookiesPsRawHighest,
                bank: Game.cookies,
                profit$: M.profit,
                held$,
                office: M.officeLevel,
                brokers: M.brokers,
                cursors: Game.Objects['Cursor'].amount,
                market: MushieCookies.market.report(),
                status: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`),
            };
        });
        console.log(
            JSON.stringify({
                seed,
                variant,
                golden,
                early,
                comboMinutes: comboSeconds / 60 || null,
                startOffice,
                hours,
                wallSeconds: Math.round((Date.now() - started) / 1000),
                earnedGain: out.earned - t0.earned,
                hourly: points.map((e) => +(e - t0.earned).toExponential(4)),
                trace,
                marketProfit$: Math.round(out.profit$ - t0.profit),
                errors: game.errors.slice(0, 5),
                ...out,
            })
        );
    }
} finally {
    await game.close();
}
