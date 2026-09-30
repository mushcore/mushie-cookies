// Measures the market's parts from the same mid-game bakery: trading with the cash allocator
// against the rule it replaces (spend everything above the reserve) and against no trading, then
// office upgrades, brokers and loans each added on. Golden cookies are off unless --golden is
// given: trading, offices and brokers do not depend on them, so luck-free runs compare fairly
// (the market's own prices still vary by seed; use several). Loans pay only on combos, so they
// are measured with golden cookies and forecast casting on.
// Usage: node tools/dev/bank.mjs <gameHours> <seed> <variant> [--golden] [--office=N] > out.json
//   variants: nomarket | reserve | market | office | broker | loan | loan3
//   --office=N starts the market at office level N (loans need 2, 4 and 5), with office buying off.
import { launchWithMod } from '../../test/harness/game.mjs';

const hours = Number(process.argv[2] || 12);
const seed = process.argv[3] || 'bank-a';
const variant = process.argv[4] || 'office';
const golden = process.argv.includes('--golden');
const officeArg = process.argv.find((a) => a.startsWith('--office='));
const startOffice = officeArg ? Number(officeArg.split('=')[1]) : null;
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
try {
    if (!golden) await game.eval(() => { Game.shimmerTypes.golden.spawnConditions = () => false; });
    // Test fixture: the audit's bakery (scratchpad office.mjs), with the Grimoire open for the
    // loan runs and Cursor level 12, so every office can be bought if it is judged worth it.
    await game.eval(() => {
        Game.Earn(1e15);
        for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(50);
        Game.Objects['Bank'].level = 3;
        Game.Objects['Wizard tower'].level = 1;
        Game.Objects['Cursor'].level = 12;
        Game.LoadMinigames();
    });
    await game.waitFor(() => !!(Game.Objects['Bank'].minigame && Game.Objects['Bank'].minigame.goodsById && Game.Objects['Wizard tower'].minigame));
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
    for (let h = 1; h <= hours; h++) {
        await game.advanceSeconds(3600);
        points.push(await game.eval(() => Game.cookiesEarned));
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
            startOffice,
            hours,
            wallSeconds: Math.round((Date.now() - started) / 1000),
            earnedGain: out.earned - t0.earned,
            hourly: points.map((e) => +(e - t0.earned).toExponential(4)),
            marketProfit$: Math.round(out.profit$ - t0.profit),
            errors: game.errors.slice(0, 5),
            ...out,
        })
    );
} finally {
    await game.close();
}
