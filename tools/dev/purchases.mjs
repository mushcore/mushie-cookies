// Records every purchase a build makes, in order, with golden cookies off so runs are exact.
// Usage: node tools/dev/purchases.mjs <gameMinutes> <built mod file | current> > out.json
import { launchGame, BUILT_MOD } from '../../test/harness/game.mjs';

const minutes = Number(process.argv[2] || 120);
const modFile = !process.argv[3] || process.argv[3] === 'current' ? BUILT_MOD : process.argv[3];
const game = await launchGame({ seed: 'purchases', mods: [modFile] });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
try {
    await game.modStarted();
    await game.eval(() => {
        Game.shimmerTypes.golden.spawnConditions = () => false;
        window.__purchases = [];
        const record = (name, before) => {
            const spent = before - Game.cookies;
            if (spent > 0) window.__purchases.push({ t: Math.round(Game.T / 30), name, spent, cps: Game.unbuffedCps });
        };
        for (const b of Game.ObjectsById) {
            const buy = b.buy;
            b.buy = function (amount) {
                const before = Game.cookies;
                const owned = this.amount;
                const out = buy.apply(this, arguments);
                if (this.amount > owned) record(`${this.name} x${this.amount - owned}`, before);
                return out;
            };
        }
        for (const u of Object.values(Game.UpgradesById)) {
            const buy = u.buy;
            u.buy = function () {
                const before = Game.cookies;
                const out = buy.apply(this, arguments);
                record(this.name, before);
                return out;
            };
        }
        FrozenCookies.autoBuy = 1;
        FrozenCookies.autoGC = 1;
        FrozenCookies.autoClick = 1;
        FrozenCookies.cookieClickSpeed = 50;
        FCStart();
    });
    await game.advanceSeconds(minutes * 60);
    const out = await game.eval(() => ({ purchases: window.__purchases, earned: Game.cookiesEarned }));
    console.log(JSON.stringify(out));
} finally {
    await game.close();
}
