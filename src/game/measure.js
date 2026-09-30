// Reads the live game into the plain state that src/core/income.js estimates from.
import { outcomeProbabilities } from '../core/goldenPool.js';
import { simulateEach } from '../core/sim.js';
import { devastationState } from './combos.js';

/** The game rejects clicks less than 20 ms apart (main.js:4770), so 50 a second is the most that count. */
export const MAX_CLICKS_PER_SECOND = 50;

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

function goldenState(game) {
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
    };
}

/** Cookies per click with every click buff divided out. */
function unbuffedClickPower(game) {
    let mult = 1;
    for (const buff of Object.values(game.buffs)) if (buff.multClick) mult *= buff.multClick;
    return game.computedMouseCps / mult;
}

/** Payout multiplier per wrinkler (main.js:14467-14479). */
function wrinklerReturnMult(game) {
    let m = 1.1;
    if (game.Has('Sacrilegious corruption')) m *= 1.05;
    if (game.Has('Wrinklerspawn')) m *= 1.05;
    m *= 1 + game.auraMult('Dragon Guts') * 0.2;
    const scorn = god(game, 'scorn');
    if (scorn === 1) m *= 1.15;
    else if (scorn === 2) m *= 1.1;
    else if (scorn === 3) m *= 1.05;
    return m;
}

/**
 * Wrinklers attach only during the grandmapocalypse. What they give back depends on who pops
 * them: nothing if nobody does, and next to nothing if they are popped as soon as they arrive.
 */
function wrinklerState(game, settings) {
    const count = game.elderWrath > 0 ? game.getWrinklersMax() : 0;
    const suckRate = 0.05 * game.eff('wrinklerEat') * (1 + 0.2 * game.auraMult('Dragon Guts'));
    const popping = Number(settings.autoWrinkler) || 0; // 0 off, 1 when worth it, 2 at once
    if (popping === 2) return { count: 0, returnMult: 0, suckRate };
    return { count, returnMult: popping === 1 ? wrinklerReturnMult(game) : 0, suckRate };
}

/**
 * The income state of the game as it is now.
 * @param {object} settings  the mod's settings: autoClick, cookieClickSpeed, autoWrinkler, autoGodzamok
 */
export function readState(game, settings) {
    return {
        cps: game.unbuffedCps,
        clickPower: unbuffedClickPower(game),
        clicksPerSecond: settings.autoClick ? Math.min(Number(settings.cookieClickSpeed) || 0, MAX_CLICKS_PER_SECOND) : 0,
        bank: game.cookies,
        // What every building costs right now; a discount upgrade lowers it inside a what-if.
        basket: game.ObjectsById.reduce((sum, b) => sum + b.getPrice(), 0),
        wrinklers: wrinklerState(game, settings),
        golden: goldenState(game),
        devastation: devastationState(game, settings),
    };
}

/**
 * The income state after each candidate's `apply`, measured in one what-if session.
 * Returns an array aligned with `candidates`.
 */
export function measureCandidates(game, settings, candidates) {
    return simulateEach(game, candidates, () => readState(game, settings));
}
