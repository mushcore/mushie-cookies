// Measures the market's parts from the same mid-game bakery: trading with the cash allocator
// against the rule it replaces (spend everything above the reserve) and against no trading, then
// office upgrades, brokers and loans each added on. Golden cookies are off unless --golden is
// given: trading, offices and brokers do not depend on them, so luck-free runs compare fairly
// (the market's own prices still vary by seed; use several). Loans pay only on combos, so they
// are measured on combos: golden cookies and forecast casting on (where the first difference
// sends the golden cookies down another path, so a run compares nothing), or luck-free with the
// same combo forced on a schedule in every variant (--combo).
// Usage: node tools/dev/bank.mjs <gameHours> <seed> <variant> [--golden] [--office=N] [--combo=M] > out.json
//   variants: nomarket | reserve | market | office | broker | loan | loan3
//   --office=N starts the market at office level N (loans need 2, 4 and 5), with office buying off.
//   --early starts from an early bakery instead, where purchases repay in minutes.
//   --combo=M every M game minutes the fixture gives a Frenzy (x7, 77 s) and a Click frenzy
//   (x777, 13 s) at once, as a golden cookie pair would (main.js:5540-5563).
//   --prestige=P plays a whole run instead, luck-free, from just after an ascension at prestige P
//   until the ascension system ends it (or <gameHours>): loans at the run's end (debt evasion)
//   against none, with the office at --office (default 2, where loan 1 shows).
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
    await game.eval(() => {
        Game.Objects['Bank'].minigame.officeLevel = window.__run.office;
    });
    const started = Date.now();
    let row = null;
    for (let q = 1; q <= hours * 4 && !row; q++) {
        await game.advanceSeconds(900);
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
                return { earned: Game.cookiesEarned, cps: Game.unbuffedCps, bank: Game.cookies, held$, profit$: M.profit, office: M.officeLevel, brokers: M.brokers };
            });
            points.push(p.earned);
            // Where the cookies are each hour: in buildings (CpS), in the bank, or held in stock.
            trace.push({ h, cps: +p.cps.toExponential(3), bank: +p.bank.toExponential(3), held$: Math.round(p.held$), profit$: Math.round(p.profit$ - t0.profit), office: p.office, brokers: p.brokers });
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
