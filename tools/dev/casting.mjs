// Compares casting policies from the same mid-game bakery, with golden cookies on (casting is
// about golden cookie outcomes, so luck cannot be switched off here; use several seeds).
// Usage: node tools/dev/casting.mjs <gameHours> <seed> <none|inherited|forecast> > out.json
import { launchWithMod } from '../../test/harness/game.mjs';

const hours = Number(process.argv[2] || 3);
const seed = process.argv[3] || 'casting';
const variant = process.argv[4] || 'forecast';
const game = await launchWithMod({ seed });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
try {
    // Test fixture: a bakery a few hours in, with the Grimoire unlocked.
    await game.eval(() => {
        Game.Earn(1e13);
        for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(80);
        Game.Objects['Wizard tower'].level = 1;
        Game.LoadMinigames();
        Game.cookies = 0;
    });
    await game.waitFor(() => !!(Game.Objects['Wizard tower'].minigame && Game.Objects['Wizard tower'].minigame.spells));
    await game.eval((v) => {
        FrozenCookies.autoBuy = 1;
        FrozenCookies.autoGC = 1;
        FrozenCookies.autoClick = 1;
        FrozenCookies.cookieClickSpeed = 50;
        FrozenCookies.towerLimit = 1; // keep the tower count, and so the mana, the same across variants
        FrozenCookies.manaMax = Game.Objects['Wizard tower'].minigame.magicM;
        FrozenCookies.autoCasting = v === 'inherited' ? 3 : 0; // 3: the inherited "smart" Force the Hand of Fate
        FrozenCookies.autoFate = v === 'forecast' ? 1 : 0;
        FCStart();
    }, variant);
    const started = Date.now();
    await game.advanceSeconds(hours * 3600);
    const out = await game.eval(() => ({
        earned: Game.cookiesEarned,
        cps: Game.unbuffedCps,
        spells: Game.Objects['Wizard tower'].minigame.spellsCastTotal,
        lumps: Game.lumps,
        golden: Game.goldenClicks,
        forecast: MushieCookies.grimoire.report(),
    }));
    console.log(JSON.stringify({ seed, variant, hours, wallSeconds: Math.round((Date.now() - started) / 1000), errors: game.errors.slice(0, 5), ...out }));
} finally {
    await game.close();
}
