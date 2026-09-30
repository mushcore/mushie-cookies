// Measures Godzamok and the Golden switch from one late-game bakery.
//
//   node tools/dev/combos.mjs <mode> <seed> <variant> [hours] > out.json
//
// mode:
//   buffs    luck-free: no golden cookie spawns; a 26 s Click frenzy is started every 10 minutes,
//            every other one on a 154 s Frenzy (Get lucky lengths). Deterministic: one run per
//            variant is a fair comparison. The switch sees no golden cookies to lose here.
//   natural  golden cookies on, clicked as they appear; compare across seeds.
// variant: none | godzamok | gs | both | inherited (the Frozen Cookies code: run it from a build of
//          the commit before the combo system, where autoGodzamok and autoGS are that code) |
//          godzamok-buyer (each sale left to the buyer to buy back).
//
// Net earned = cookies earned less what the combos spent on nothing lasting: the cookies lost to
// selling and buying back, and the switch's toggles (neither lowers Game.cookiesEarned).
import { launchWithMod } from '../../test/harness/game.mjs';

const mode = process.argv[2] || 'buffs';
const seed = process.argv[3] || 'combos';
const variant = process.argv[4] || 'both';
const hours = Number(process.argv[5] || (mode === 'buffs' ? 2 : 6));

const game = await launchWithMod({ seed });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
try {
    // Fixture: 100 of each of the first twelve buildings, the Pantheon open with Godzamok in the
    // diamond slot, and the Golden switch and Get lucky heavenly upgrades. The buyer spends the
    // rest of the bank on upgrades (mice, fingers, tiers) in the first minutes.
    await game.eval(() => {
        Game.Earn(1e21);
        for (const b of Game.ObjectsById.slice(0, 12)) b.buy(100);
        Game.Objects['Temple'].level = 1;
        Game.LoadMinigames();
        for (const name of ['Golden switch', 'Get lucky']) Game.Upgrades[name].earn();
        Game.Unlock('Golden switch [off]');
    });
    await game.waitFor(() => !!(Game.Objects['Temple'].minigame && Game.Objects['Temple'].minigame.godsById && document.getElementById('templeSlot0')));
    const start = await game.eval(
        ({ mode, variant }) => {
            const M = Game.Objects['Temple'].minigame;
            M.dragGod(M.gods['ruin']);
            M.slotHovered = 0;
            M.dropGod();
            M.slotHovered = -1;
            if (mode === 'buffs') Game.shimmerTypes.golden.spawnConditions = () => false;

            const s = FrozenCookies;
            s.autoBuy = 1;
            s.autoClick = 1;
            s.cookieClickSpeed = 50;
            s.autoGC = 1;
            s.autoGods = 0; // the pantheon stays as set, in every variant
            s.autoFate = 0;
            s.autoWrinkler = 0;
            s.autoLumps = 0;
            s.autoAscendToggle = 0;
            const inherited = typeof MushieCookies.combos === 'undefined';
            if (variant === 'inherited' && !inherited) throw new Error('inherited needs a build without the combo system');
            s.autoGodzamok = variant.startsWith('godzamok') || variant === 'both' || variant === 'inherited' ? 1 : 0;
            // godzamok-buyer: each sale left to the buyer to buy back, one sale per window.
            if (variant === 'godzamok-buyer') MushieCookies.combos.options.rebuy = 'buyer';
            s.autoGS = variant === 'gs' || variant === 'both' || variant === 'inherited' ? 1 : 0;

            // What the inherited code spends: wrapped before FCStart binds the intervals.
            window.__legacy = { lost: 0, switch: 0, sales: 0 };
            if (inherited) {
                const godzamok = window.autoGodzamokAction;
                window.autoGodzamokAction = function () {
                    const c = Game.cookies;
                    const devastation = Game.hasBuff('Devastation');
                    godzamok();
                    if (!devastation && Game.hasBuff('Devastation')) window.__legacy.sales++;
                    window.__legacy.lost += c - Game.cookies;
                };
                const gs = window.autoGSBuy;
                window.autoGSBuy = function () {
                    const c = Game.cookies;
                    gs();
                    window.__legacy.switch += c - Game.cookies;
                };
            }
            FCStart();

            // Click buffs as they happen, and the cookies earned from the start of each to 10 s
            // after it (Devastation can outlast it).
            const log = (window.__clickBuffs = { n: 0, earned: 0, open: null });
            const clickBuff = () => Object.values(Game.buffs).some((b) => b.name !== 'Devastation' && b.multClick > 1);
            Game.registerHook('logic', () => {
                if (clickBuff()) {
                    if (!log.open) {
                        log.open = { from: Game.cookiesEarned, until: Infinity };
                        log.n++;
                    }
                    log.open.until = Infinity;
                } else if (log.open) {
                    if (log.open.until === Infinity) log.open.until = Game.T + 10 * Game.fps;
                    if (Game.T >= log.open.until) {
                        log.earned += Game.cookiesEarned - log.open.from;
                        log.open = null;
                    }
                }
            });
            return { earned: Game.cookiesEarned, t: Game.T };
        },
        { mode, variant }
    );

    const started = Date.now();
    const step = 10 * 60;
    for (let t = 0, i = 0; t < hours * 3600; t += step, i++) {
        if (mode === 'buffs') {
            await game.eval((frenzy) => {
                if (frenzy) Game.gainBuff('frenzy', 154, 7);
                Game.gainBuff('click frenzy', 26, 777);
            }, i % 2 === 1);
        }
        await game.advanceSeconds(Math.min(step, hours * 3600 - t));
    }
    const out = await game.eval((start) => {
        const inherited = typeof MushieCookies.combos === 'undefined';
        const r = inherited ? null : MushieCookies.combos.report();
        const lost = inherited ? window.__legacy.lost : r.lost;
        const spentOnSwitch = inherited ? window.__legacy.switch : r.spentOnSwitch;
        const earned = Game.cookiesEarned - start.earned;
        return {
            earned,
            lost,
            spentOnSwitch,
            net: earned - lost - spentOnSwitch,
            clickBuffs: window.__clickBuffs.n,
            earnedInClickBuffs: window.__clickBuffs.earned,
            cps: Game.unbuffedCps,
            buildings: Game.BuildingsOwned,
            golden: Game.goldenClicks,
            report: r || window.__legacy,
        };
    }, start);
    console.log(JSON.stringify({ mode, seed, variant, hours, wallSeconds: Math.round((Date.now() - started) / 1000), errors: game.errors.slice(0, 5), ...out }));
} finally {
    await game.close();
}
