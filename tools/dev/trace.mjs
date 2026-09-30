// Plays a seed with buying on and prints the buyer's state at intervals: what it wants, what it
// holds back, what it earns. Usage: node tools/dev/trace.mjs [gameMinutes] [seed] [stepMinutes]
import { launchWithMod } from '../../test/harness/game.mjs';

const minutes = Number(process.argv[2] || 120);
const seed = process.argv[3] || 'baseline';
const step = Number(process.argv[4] || 5);
const game = await launchWithMod({ seed });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
const fmt = (n) => (Number.isFinite(n) ? n.toExponential(2) : String(n));
try {
    await game.eval(() => {
        FrozenCookies.autoBuy = 1;
        FrozenCookies.autoGC = 1;
        FrozenCookies.autoClick = 1;
        FrozenCookies.cookieClickSpeed = 50;
        FCStart();
    });
    for (let m = step; m <= minutes; m += step) {
        await game.advanceSeconds(step * 60);
        const s = await game.eval(() => {
            const r = MushieCookies.buyer.report();
            const next = r.next;
            return {
                cookies: Game.cookies,
                earned: Game.cookiesEarned,
                cps: Game.unbuffedCps,
                income: r.income ? r.income.total : 0,
                reserve: r.reserve,
                next: next ? `${next.name} @${next.price.toExponential(1)} pure=${Math.round(next.purePayback)}s pb=${Math.round(next.payback)}s` : 'nothing',
                buildings: Game.BuildingsOwned,
                upgrades: Game.UpgradesOwned,
                purchases: r.purchases,
                buffs: Object.keys(Game.buffs).join('+') || '-',
            };
        });
        console.log(
            `${String(m).padStart(4)}m earned=${fmt(s.earned)} bank=${fmt(s.cookies)} cps=${fmt(s.cps)} income=${fmt(s.income)} reserve=${fmt(s.reserve)} b=${s.buildings} u=${s.upgrades} bought=${s.purchases} buffs=${s.buffs} | next: ${s.next}`
        );
    }
} finally {
    await game.close();
}
