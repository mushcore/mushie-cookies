// Runs the garden from a fresh seed log and reports the unlock count each game hour.
// Usage: node tools/dev/garden.mjs <gameHours> [seed] > out.json
import { launchWithMod } from '../../test/harness/game.mjs';

const hours = Number(process.argv[2] || 12);
const seed = process.argv[3] || 'garden';
const game = await launchWithMod({ seed });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
try {
    // Test fixture: a bakery with a full 6×6 garden and farms enough for every soil.
    await game.eval(() => {
        Game.Earn(1e30);
        for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory']) Game.Objects[name].buy(name === 'Farm' ? 320 : 100);
        Game.cookies = 1e15;
        // The garden's seed budget is a share of cookies earned: at 1e30 no income would register.
        Game.cookiesEarned = Game.cookies;
        if (Game.Objects['Farm'].amount < 300) throw new Error('fixture: only ' + Game.Objects['Farm'].amount + ' farms');
        Game.Objects['Farm'].level = 9;
        Game.LoadMinigames();
    });
    await game.waitFor(() => !!(Game.Objects['Farm'].minigame && Game.Objects['Farm'].minigame.plants));
    await game.eval(() => {
        FrozenCookies.autoBuy = 1;
        FrozenCookies.autoGC = 1;
        FrozenCookies.autoClick = 1;
        FrozenCookies.cookieClickSpeed = 50;
        FrozenCookies.autoGarden = 1;
        FCStart();
    });
    const points = [];
    const started = Date.now();
    for (let h = 1; h <= hours; h++) {
        await game.advanceSeconds(3600);
        const p = await game.eval(() => {
            const r = MushieCookies.garden.report();
            const M = Game.Objects['Farm'].minigame;
            return {
                ...r,
                soil: M.soilsById[M.soil].key,
                unlockedNames: Object.values(M.plants).filter((p) => p.unlocked).map((p) => p.key),
                failures: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`),
            };
        });
        points.push({ hour: h, ...p });
        process.stderr.write(`${String(h).padStart(3)}h ${p.unlocked}/${p.of} target=${p.target} mode=${p.mode} soil=${p.soil} planted=${p.planted} harvested=${p.harvested} sacrifices=${p.sacrifices}${p.failures.length ? ' FAIL ' + p.failures.join('; ') : ''}\n`);
    }
    console.log(JSON.stringify({ seed, hours, wallSeconds: Math.round((Date.now() - started) / 1000), errors: game.errors.slice(0, 5), points }));
} finally {
    await game.close();
}
