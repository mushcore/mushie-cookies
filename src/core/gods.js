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
// 1400-1424, 1518, 1542); the FTHOF combo reads the auras to time its casts (fc_spells.js:803).
const combo = (s) => on(s.auto100ConsistencyCombo) || on(s.autoFTHOFCombo);

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

/**
 * The aura switch to make, or null.
 *
 * A switch sacrifices the highest building (main.js:14909), so it is made only when:
 *  - it adds more than AURA_GAIN of income with that building gone. This is also the dead band
 *    that keeps two auras within noise of each other from alternating: from either one, the
 *    other has to be better by more than the band;
 *  - the income it adds with the building rebought repays the building's price within
 *    `paybackSeconds`;
 *  - it does not go back to the aura the last switch in that slot left, before that switch has
 *    had its payback time: coming back sooner means the first switch never earned out its
 *    building, whatever the measurements said.
 *
 * @param {object} args
 * @param {number} args.now  income now
 * @param {Array<{slot: number, id: number, name: string, gross: number, net: number, rebuy: number}>} args.moves
 *   gross: income after the switch with every building; net: with the highest building
 *   sacrificed as well; rebuy: that building's price after the switch (0 if none is owned)
 * @param {number} args.paybackSeconds
 * @param {number} args.t  game time now, in seconds
 * @param {Object<number, {left: number, at: number}>} [args.recent]  per slot: the aura the
 *   last switch left, and when
 * @returns {object | null}  the chosen move, with `gain` (net, as a share of income now)
 */
export function chooseAura({ now, moves, paybackSeconds, t, recent = {} }) {
    let best = null;
    for (const move of moves) {
        const gain = (move.net - now) / now;
        if (!(gain > AURA_GAIN)) continue;
        if (move.rebuy > 0 && !((move.gross - now) * paybackSeconds >= move.rebuy)) continue;
        const last = recent[move.slot];
        if (last && last.left === move.id && t - last.at < paybackSeconds) continue;
        if (!best || gain > best.gain) best = { ...move, gain };
    }
    return best;
}
