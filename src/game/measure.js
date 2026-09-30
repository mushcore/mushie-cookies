// Reads the live game into the plain state that src/core/income.js estimates from.
import { outcomeProbabilities } from '../core/goldenPool.js';
import { simulateEach } from '../core/sim.js';
import { modelClickRate } from '../core/clicker.js';
import { unbuffedFactors } from '../core/buffs.js';
import { wrinklerModel } from './wrinklers.js';

/** The game rejects clicks less than 20 ms apart (main.js:4770), so 50 a second is the most that count. */
export const MAX_CLICKS_PER_SECOND = 50;

// Accepted clicks a second as the clicker measures them (src/systems/clicker.js), or null.
// The real rate is below the cap: in the game's own runtime about 44 a second with the window
// shown and about 30 (14 to 41) minimized (tools/dev/clicker.mjs, spec section 3); counting 50
// overstated every click term the buyer, the spell forecast, the aura choice and the heavenly
// planner weigh.
let clickRateSource = () => null;
/** Where the measured click rate comes from. */
export function useClickRate(source) {
    clickRateSource = source;
}

/** Clicks a second the income model counts on under these settings. */
export function clicksPerSecond(settings) {
    return modelClickRate({ autoClick: settings.autoClick, speed: settings.cookieClickSpeed, measured: clickRateSource() });
}

// Expected spawn frame of a golden cookie. Each frame past the shortest wait spawns with
// probability x^5, where x is the fraction of the way to the longest wait (main.js:5275).
// Exact per window size, cached by window size.
const spawnCache = new Map();
function expectedSpawnFrames(minFrames, maxFrames) {
    const key = `${minFrames}/${maxFrames}`;
    if (spawnCache.has(key)) return spawnCache.get(key);
    const span = Math.max(1, maxFrames - minFrames);
    let alive = 1;
    let expected = 0;
    for (let t = 0; t <= span; t++) {
        const p = Math.min(1, Math.pow(t / span, 5));
        expected += alive * p * (minFrames + t);
        alive *= 1 - p;
        if (alive < 1e-9) break;
    }
    const out = expected + alive * maxFrames;
    spawnCache.set(key, out);
    return out;
}

function god(game, name) {
    return game.hasGod ? game.hasGod(name) : 0;
}

/** effectDurMod for a natural golden (wrath = 0) or wrath cookie (main.js:5459-5477). */
function durationMult(game, wrath) {
    let m = 1;
    if (game.Has('Get lucky')) m *= 2;
    if (game.Has('Lasting fortune')) m *= 1.1;
    if (game.Has('Lucky digit')) m *= 1.01;
    if (game.Has('Lucky number')) m *= 1.01;
    if (game.Has('Green yeast digestives')) m *= 1.01;
    if (game.Has('Lucky payout')) m *= 1.01;
    m *= 1 + game.auraMult('Epoch Manipulator') * 0.05;
    m *= game.eff(wrath ? 'wrathCookieEffDur' : 'goldenCookieEffDur');
    const decadence = god(game, 'decadence');
    if (decadence === 1) m *= 1.07;
    else if (decadence === 2) m *= 1.05;
    else if (decadence === 3) m *= 1.02;
    return m;
}

/** Payout multiplier (main.js:5480-5488). */
function gainMult(game, wrath) {
    let m = 1;
    m *= 1 + game.auraMult(wrath ? 'Unholy Dominion' : 'Ancestral Metamorphosis') * 0.1;
    if (game.Has('Green yeast digestives')) m *= 1.01;
    if (game.Has('Dragon fang')) m *= 1.03;
    m *= game.eff(wrath ? 'wrathCookieGain' : 'goldenCookieGain');
    return m;
}

/** Chance that the next natural cookie is a wrath cookie (main.js:5325). */
function wrathChance(game) {
    if (god(game, 'scorn')) return 1;
    if (game.elderWrath >= 3) return 1;
    return game.elderWrath / 3;
}

function poolRules(game, wrath) {
    return {
        wrath,
        scorn: !!god(game, 'scorn'),
        chainEligible: game.cookiesEarned >= 100000,
        fools: game.season === 'fools',
        dragonflightActive: game.hasBuff('Dragonflight') ? true : false,
        buildingSpecial: game.BuildingsOwned >= 10,
        lumps: game.canLumps(),
        reaper: game.auraMult('Reaper of Fields'),
        dragonflight: game.auraMult('Dragonflight'),
    };
}

/** Mixes a golden and a wrath distribution by the wrath chance. */
function mixedProbabilities(game) {
    const w = wrathChance(game);
    const out = {};
    if (w < 1) for (const [k, v] of Object.entries(outcomeProbabilities(poolRules(game, 0)))) out[k] = (out[k] || 0) + v * (1 - w);
    if (w > 0) {
        for (const [k, v] of Object.entries(outcomeProbabilities(poolRules(game, 1)))) {
            if (k === 'building special') {
                // 30% of a wrath cookie's building specials are debuffs (main.js:5506-5508).
                out[k] = (out[k] || 0) + v * w * 0.7;
                out['building debuff'] = (out['building debuff'] || 0) + v * w * 0.3;
            } else out[k] = (out[k] || 0) + v * w;
        }
    }
    return out;
}

function goldenState(game, settings) {
    const type = game.shimmerTypes.golden;
    const minFrames = type.getMinTime(type);
    const maxFrames = type.getMaxTime(type);
    // No golden cookie spawns while the game's own spawn condition is false (the Golden switch).
    const spawning = typeof type.spawnConditions !== 'function' || type.spawnConditions();
    // With golden cookies clicked as they appear, the wait between them is the spawn timer alone.
    const meanInterval = spawning ? expectedSpawnFrames(minFrames, maxFrames) / game.fps : Infinity;
    const w = wrathChance(game);
    const eligible = game.ObjectsById.filter((b) => b.amount >= 10);
    return {
        meanInterval,
        durationMult: durationMult(game, 0) * (1 - w) + durationMult(game, 1) * w,
        gainMult: gainMult(game, 0) * (1 - w) + gainMult(game, 1) * w,
        probabilities: mixedProbabilities(game),
        buildingSpecialMean: eligible.length ? eligible.reduce((s, b) => s + b.amount, 0) / eligible.length : 0,
        // Storm drops are rolled each frame (main.js:5257).
        fps: game.fps,
        // Drops live 2 to 5 s (main.js:5260-5261); the shimmer system pops each in the frame it
        // appears. By hand, the inherited guess of half.
        stormReach: settings.autoGC == 1 ? 1 : 0.5,
    };
}

/**
 * Cookies per click as if no buff were running. Click buffs multiply a click (main.js:4732-4735)
 * and divide back out. CpS buffs do not: each mouse upgrade adds 1% of Game.cookiesPs, which
 * already carries every CpS buff (4692-4706, 5159-5167), and a Cursed finger replaces the whole
 * click (4744). So under either the click is recomputed by the game's own Game.mouseCps with
 * cookiesPs at Game.unbuffedCps and the finger unseen, both put back before returning; nothing
 * else runs in between. The comment on unbuffedFactors (src/core/buffs.js) says why.
 */
function unbuffedClickPower(game) {
    const { click, fixedClick } = unbuffedFactors(game.buffs);
    const buffedCps = game.cookiesPs;
    if (buffedCps === game.unbuffedCps && fixedClick === null) return game.computedMouseCps / click;
    const hasBuff = game.hasBuff;
    let power;
    try {
        game.cookiesPs = game.unbuffedCps;
        game.hasBuff = (what) => (what === 'Cursed finger' ? 0 : hasBuff(what));
        power = game.mouseCps();
    } finally {
        game.cookiesPs = buffedCps;
        game.hasBuff = hasBuff;
    }
    return power / click;
}

/**
 * Wrinklers attach only during the grandmapocalypse. How many are counted, and whether what they
 * store is spendable, follows the wrinkler system's policy (src/game/wrinklers.js).
 */
function wrinklerState(game, settings) {
    return wrinklerModel(game, settings);
}

/**
 * Reindeer run only in Christmas (main.js:5834-5837) and pay only when clicked, so they count
 * when autoReindeer clicks them. One spawns on the shimmer timer, 3 to 6 minutes, halved by
 * Reindeer baking grounds (main.js:5842-5866); Ho ho ho-flavored frosting doubles the payout
 * (main.js:5791). `season` asks what they would pay in another season.
 */
export function reindeerState(game, settings, { season = game.season } = {}) {
    const type = game.shimmerTypes.reindeer;
    if (season !== 'christmas' || !settings.autoReindeer || !type) return null;
    // Clicked on sight, a reindeer's time on screen adds nothing to the wait between them.
    const meanInterval = expectedSpawnFrames(type.getMinTime(type), type.getMaxTime(type)) / game.fps;
    const payoutMult = (game.Has('Ho ho ho-flavored frosting') ? 2 : 1) * game.eff('reindeerGain');
    return { meanInterval, payoutMult };
}

/**
 * The income state of the game as it is now.
 * @param {object} settings  the mod's settings: autoClick, cookieClickSpeed
 */
export function readState(game, settings) {
    return {
        cps: game.unbuffedCps,
        clickPower: unbuffedClickPower(game),
        clicksPerSecond: clicksPerSecond(settings),
        bank: game.cookies,
        // What every building costs right now; a discount upgrade lowers it inside a what-if.
        basket: game.ObjectsById.reduce((sum, b) => sum + b.getPrice(), 0),
        wrinklers: wrinklerState(game, settings),
        golden: goldenState(game, settings),
        reindeer: reindeerState(game, settings),
    };
}

/**
 * The income state after each candidate's `apply`, measured in one what-if session.
 * Returns an array aligned with `candidates`.
 */
export function measureCandidates(game, settings, candidates) {
    return simulateEach(game, candidates, () => readState(game, settings));
}
