// Reads the game's wrinklers into the plain arguments src/core/wrinklers.js decides from, and
// gives the income model the wrinkler state the popping policy leads to.
import { popMultiplier, suckRate, spawnChance, expectedAttached, CRAWL_SECONDS } from '../core/wrinklers.js';

/**
 * What the wrinkler system reports about its own popping, for the income model: the rate of its
 * purchase pops (per second, smoothed over about an hour) and whether a season hunt is popping
 * every wrinkler. Written only by src/systems/wrinklers.js.
 */
export const telemetry = { popRate: 0, hunting: false };

/** The income model looks this far ahead when wrinklers are still refilling their slots. */
export const MODEL_HORIZON_SECONDS = 3600;

const god = (game, name) => (game.hasGod ? game.hasGod(name) || 0 : 0);

/** Pop multiplier of an ordinary wrinkler, or a shiny one (main.js:14467-14479). */
export function popMultOf(game, shiny = false) {
    return popMultiplier({
        sacrilegious: game.Has('Sacrilegious corruption'),
        wrinklerspawn: game.Has('Wrinklerspawn'),
        dragonGuts: game.auraMult('Dragon Guts'),
        scorn: god(game, 'scorn'),
        shiny,
    });
}

/** Cookies a wrinkler would pay if it popped now. */
export function payoutOf(game, w) {
    return (w.sucked || 0) * popMultOf(game, w.type == 1);
}

/** Cookies every wrinkler still in play would pay, a popped one whose payout has not landed included. */
export function heldValue(game) {
    let total = 0;
    for (const w of game.wrinklers) if (w.phase > 0) total += payoutOf(game, w);
    return total;
}

/** Spawn chance of an empty slot, per second (main.js:14361-14373). */
export function spawnPerSecond(game) {
    return (
        spawnChance({
            elderWrath: game.elderWrath,
            wrinklerSpawn: game.eff('wrinklerSpawn'),
            unholyBait: game.Has('Unholy bait'),
            scorn: god(game, 'scorn'),
            doormat: game.Has('Wrinkler doormat'),
        }) * game.fps
    );
}

/** Everything the popping decision needs from the game. */
export function wrinklerParams(game) {
    const max = game.getWrinklersMax();
    const popMult = popMultOf(game);
    const suck = suckRate({ wrinklerEat: game.eff('wrinklerEat'), dragonGuts: game.auraMult('Dragon Guts') });
    // Attached is phase 2: only those feed (main.js:14391-14394, 5119). A wrinkler already set to
    // pop (hp at or below 0.5) pays on the next logic frame and is not a candidate again.
    const attached = game.wrinklers.filter((w) => w.phase == 2);
    const candidates = attached.filter((w) => w.hp > 0.5).map((w) => ({ id: w.id, payout: payoutOf(game, w), shiny: w.type == 1 }));
    const shinies = attached.filter((w) => w.type == 1).length;
    return {
        max,
        popMult,
        suck,
        spawnPerSecond: spawnPerSecond(game),
        crawl: CRAWL_SECONDS,
        attached: attached.length,
        inPlay: game.wrinklers.filter((w) => w.phase > 0).length,
        shinies,
        payoutSum: (attached.length - shinies) * popMult + shinies * popMultOf(game, true),
        candidates,
    };
}

/**
 * The wrinkler state for src/core/income.js, following what the popping policy does.
 *
 * - Popping on (autoWrinkler 1): the count the policy keeps attached on average (its measured pop
 *   rate and the spawn gap, with the refill still to come when slots are empty), and the pop
 *   multiplier, since everything stored reaches the bank when it is popped.
 * - During a season hunt every wrinkler is popped as it arrives: none are counted. `hunting`
 *   asks for the state without the hunt (a permanent drop is valued on the income the run keeps).
 * - Popping off: slots fill and stay full, and what they store is not spendable until an
 *   ascension collects it, so they only wither.
 */
export function wrinklerModel(game, settings, { hunting = telemetry.hunting } = {}) {
    const p = wrinklerParams(game);
    const popping = Number(settings.autoWrinkler) > 0;
    if (popping && hunting) return { count: 0, returnMult: 0, suckRate: p.suck };
    const count = expectedAttached({
        max: p.max,
        now: p.inPlay,
        popRate: popping ? telemetry.popRate : 0,
        spawnPerSecond: p.spawnPerSecond,
        crawl: p.crawl,
        horizon: MODEL_HORIZON_SECONDS,
    });
    // A kept shiny pays three times; it counts at its share of the attached ones.
    const returnMult = popping ? (p.attached > 0 ? p.payoutSum / p.attached : p.popMult) : 0;
    return { count, returnMult, suckRate: p.suck };
}
