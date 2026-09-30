/**
 * Pantheon and dragon aura decisions. Pure; src/systems/gods.js measures the moves against the
 * live game and makes the one chosen here.
 */

/** A switch must add at least this share of income, net of the building it sacrifices. */
export const AURA_GAIN = 0.02;

const on = (value) => Number(value) > 0; // a setting missing from an old save is off

// Inherited options that run combos around the gods and auras they set: the 100% consistency
// combo switches the inherited pantheon and aura options off mid-combo, then sets Radiant
// Appetite and Dragon's Fortune and swaps Godzamok and Mokalsium itself (fc_spells.js:1334-1347,
// 1400-1424, 1518, 1542). Double Cast FTHOF is forecast casting's now and reads no god or aura.
const combo = (s) => on(s.auto100ConsistencyCombo);

/** Inherited options that slot gods themselves or need the gods they slotted left in place. */
export function inheritedGodsOn(s) {
    return (
        on(s.autoWorshipToggle) ||
        on(s.autoCyclius) || // 1: ruby and jade, 2: every slot
        Number(s.autoSL) === 2 || // Auto Rigidel swaps Rigidel in before a lump ripens (fc_gods.js:446-501)
        on(s.autoGodzamok) || // sells buildings for Godzamok's buff, which needs him slotted (fc_main.js:1111-1115)
        combo(s)
    );
}

/** Inherited options that pick auras themselves or need the auras they picked left in place. */
export function inheritedAurasOn(s) {
    return (
        on(s.autoDragonToggle) ||
        on(s.dragonsCurve) || // swaps Dragon's Curve in at each lump harvest (fc_gods.js:503-560)
        on(s.autoDragonOrbs) || // sells a You for a wish; needs Dragon Orbs (fc_gods.js:697-725)
        combo(s)
    );
}

// Gods whose worth the income model cannot see, or that would work against the mod:
// Holobore unslots itself (and empties the swaps) when a golden cookie is clicked; Godzamok pays
// only when buildings are sold; Cyclius follows the clock, which would have the mod chase it;
// Rigidel affects only sugar lump timing. These are the keys of the Pantheon's `gods` table; the
// gods themselves carry no key (minigamePantheon.js:12, 123).
export const SKIP_GODS = new Set(['asceticism', 'ruin', 'ages', 'order']);
export const HOLOBORE = 'asceticism';

/**
 * Golden cookies are clicked as they appear: by golden cookie clicking, which clicks every one
 * on screen (fc_main.js:1311-1315), natural ones (which spawn only while the Golden switch is
 * off, main.js:5673-5676) and those Force the Hand of Fate makes, which every inherited casting
 * mode casts for a free lump (fc_spells.js:313-330); or by forecast casting (on with Forecast
 * Casting or Double Cast FTHOF), which clicks the ones it casts (src/systems/grimoire.js castFate)
 * and stands aside for those modes and the 100% combo.
 * @param {object} s  the mod's settings
 * @param {boolean} naturalSpawns  golden cookies spawn on their own (the Golden switch is off)
 */
export function goldenCookiesClicked(s, naturalSpawns) {
    if (on(s.autoGC) && (naturalSpawns || on(s.autoCasting))) return true;
    return (on(s.autoFate) || on(s.autoFTHOFCombo)) && !on(s.autoCasting) && !combo(s);
}

/**
 * The slots the Pantheon system must leave alone: those holding a god it never slots, which the
 * player put there. The model gives such a god no worth it can see, so taking it out would look
 * free. Except Holobore while golden cookies are clicked: the next click unslots him and spends
 * every swap left (main.js:5419-5422), so he is better taken out first.
 * @param {Array<string | null>} keys  the key of the god in each slot, null for an empty slot
 * @param {boolean} goldenClicked  see goldenCookiesClicked
 * @returns {boolean[]}  per slot
 */
export function pinnedSlots(keys, goldenClicked) {
    return keys.map((key) => key !== null && SKIP_GODS.has(key) && !(key === HOLOBORE && goldenClicked));
}

/** The shortest horizon an aura switch is judged over, however young the run. */
export const MIN_AURA_HORIZON = 60 * 60;

/** How long after a switch the aura it left is not taken back, by default. */
export const RETURN_BLOCK_SECONDS = 60 * 60;

/**
 * How long a new aura is expected to stay: until the next ascension, which resets the dragon
 * (main.js:3537-3539). With nothing better to go on, a run that has lasted s seconds is expected
 * to last about s more (the Lindy estimate), and never less than MIN_AURA_HORIZON.
 * @param {number} runSeconds  seconds since the run began
 */
export function lindyHorizon(runSeconds) {
    return Math.max(MIN_AURA_HORIZON, runSeconds);
}

/**
 * The horizon option's value now.
 * @param {number | ((runSeconds: number) => number)} option  seconds, or a function of the run's age
 * @param {number} runSeconds
 */
export function auraHorizon(option, runSeconds) {
    return typeof option === 'function' ? option(runSeconds) : option;
}

/**
 * The aura switch to make, or null.
 *
 * A switch sacrifices the highest building (main.js:14909), so it is made only when:
 *  - it adds more than AURA_GAIN of income with that building gone. This is also the dead band
 *    that keeps two auras within noise of each other from alternating: from either one, the
 *    other has to be better by more than the band;
 *  - the income it adds with the building rebought repays the building's price within
 *    `horizonSeconds`, how long the new aura is expected to stay (see lindyHorizon). An endless
 *    horizon takes any switch that adds income once the building is rebought; a zero horizon
 *    only switches that sacrifice nothing;
 *  - it does not go back to the aura the last switch in that slot left within
 *    `returnBlockSeconds` of that switch: coming back sooner means the first switch never
 *    earned out its building, whatever the measurements said. Zero never blocks; Infinity
 *    never goes back.
 *
 * @param {object} args
 * @param {number} args.now  income now
 * @param {Array<{slot: number, id: number, name: string, gross: number, net: number, rebuy: number}>} args.moves
 *   gross: income after the switch with every building; net: with the highest building
 *   sacrificed as well; rebuy: that building's price after the switch (0 if none is owned)
 * @param {number} args.horizonSeconds
 * @param {number} [args.returnBlockSeconds]
 * @param {number} args.t  game time now, in seconds
 * @param {Object<number, {left: number, at: number}>} [args.recent]  per slot: the aura the
 *   last switch left, and when
 * @returns {object | null}  the chosen move, with `gain` (net, as a share of income now)
 */
export function chooseAura({ now, moves, horizonSeconds, returnBlockSeconds = RETURN_BLOCK_SECONDS, t, recent = {} }) {
    let best = null;
    for (const move of moves) {
        const gain = (move.net - now) / now;
        if (!(gain > AURA_GAIN)) continue;
        if (move.rebuy > 0) {
            // Compared as a payback time, never as added × horizon: 0 × Infinity is NaN.
            const added = move.gross - now;
            if (!(added > 0 && move.rebuy / added <= horizonSeconds)) continue;
        }
        const last = recent[move.slot];
        if (last && last.left === move.id && t - last.at < returnBlockSeconds) continue;
        if (!best || gain > best.gain) best = { ...move, gain };
    }
    return best;
}
