/**
 * Sugar lumps: when to harvest, what to spend on, and when to switch Sugar frenzy on. Pure.
 *
 * A building level costs (level + 1) lumps and adds 1% to that building's own CpS
 * (main.js:5058, 8104). The community order comes first because its value is not CpS: the four
 * minigames, a full 6×6 garden (Farm 9), and the Cursor levels the last stock market office
 * needs (Cursor 12). After that, Sugar baking pays +1% of all CpS per unspent lump up to 100,
 * which no single building level can match, so 100 are held and only the excess is spent.
 *
 * Values below are in seconds of unbuffed CpS, so a lump, a frenzy and a held bank compare
 * directly.
 */

const MINIGAMES = ['Wizard tower', 'Temple', 'Farm', 'Bank'];
const TARGETS = [
    ['Farm', 9], // 6×6 garden plot
    ['Cursor', 12], // the fifth bank office needs Cursor level 12
];
export const SUGAR_BAKING_HOLD = 100;

/** Game.lumpCurrentType of a golden lump (main.js:4531). */
export const GOLDEN = 2;
/** A golden lump yields choose([2..7]) lumps (main.js:4493). */
const GOLDEN_MEAN_LUMPS = 4.5;
/** The golden lump's cookies are capped at this many seconds of CpS, buffs included (main.js:4496). */
const GOLDEN_CAP_SECONDS = 86400;
/** A natural Frenzy multiplies CpS by 7: the buff a held golden lump most often lands on. */
const FRENZY_MULT = 7;
/** The latest a golden lump is harvested: a minute before it falls on its own (main.js:4605). */
export const HARVEST_SAFETY_MS = 60 * 1000;

/** Sugar frenzy triples CpS for an hour (main.js:11043, 14089-14099). */
const FRENZY_SECONDS = 3600;
const FRENZY_MULT_CPS = 3;
/**
 * How long a building level's gain is counted when a lump could go elsewhere. A level lasts for
 * good, but its gain is a sliver of CpS spread over every run to come, each restarting from
 * nothing; a month of play at today's CpS overstates it, which keeps the frenzy honest.
 */
export const LEVEL_HORIZON_SECONDS = 30 * 86400;
/**
 * The ascension ends a run when its growth rate falls under the run's average (core/ascension.js).
 * Sugar frenzy is switched on once the rate is within this margin of the average: close enough
 * that the hour lands where CpS is highest, early enough that the frenzy (which triples the rate
 * and so holds the run open while it lasts) starts before the rule fires.
 */
export const FRENZY_MARGIN = 0.1;
/** With a CpS buff running, the frenzy may start this far out, to stack on the buff. */
export const STACK_MARGIN = 0.25;
/** A buff counts as worth stacking on when it adds this share to the frenzy's value. */
export const STACK_GAIN = 0.1;

/**
 * The building level with the best CpS gain per lump, or null when nothing owned makes CpS.
 * `valuePerLump` is the fraction of all CpS one lump adds there: a level adds 1% of the building's
 * own CpS (main.js:5058) and costs level + 1 lumps (main.js:8104).
 *
 * @param {Array<{name: string, level: number, amount: number, share: number}>} buildings
 * @returns {{name: string, cost: number, valuePerLump: number, share: number} | null}
 */
export function bestLevel(buildings) {
    let best = null;
    for (const b of buildings) {
        if (!(b.amount > 0) || !(b.share > 0)) continue;
        const cost = b.level + 1;
        const valuePerLump = (b.share * 0.01) / cost;
        if (!best || valuePerLump > best.valuePerLump) best = { name: b.name, cost, valuePerLump, share: b.share };
    }
    return best;
}

/**
 * @param {object} args
 * @param {Array<{name: string, level: number, amount: number, share: number}>} args.buildings  share: fraction of CpS the building makes
 * @param {number} args.lumps
 * @param {boolean} args.sugarBaking  the Sugar baking heavenly upgrade is owned
 * @param {boolean} [args.guard]      the Sugar Baking Guard setting: hold a jar before it is owned
 * @returns {{name: string, cost: number, reason: string} | null}
 */
export function nextLevelUp({ buildings, lumps, sugarBaking, guard = false }) {
    const byName = new Map(buildings.map((b) => [b.name, b]));
    const levelUp = (b, reason, hold) => {
        const cost = b.level + 1;
        return cost <= lumps - hold ? { name: b.name, cost, reason } : null;
    };

    // A minigame costs one lump and opens a whole system, so it is never held back.
    for (const name of MINIGAMES) {
        const b = byName.get(name);
        if (b && b.amount > 0 && b.level === 0) return levelUp(b, 'unlocks its minigame', 0);
    }
    // Once Sugar baking is owned every other lump spent below 100 costs 1/(100 + L) of all CpS
    // until it grows back (main.js:5095), a day per lump, so the targets wait for the excess too.
    // Before that, the guard keeps a jar ready for the purchase but lets the targets go first:
    // their worth is not CpS, and the jar costs nothing until Sugar baking is bought.
    const targetHold = sugarBaking ? SUGAR_BAKING_HOLD : 0;
    for (const [name, target] of TARGETS) {
        const b = byName.get(name);
        if (b && b.amount > 0 && b.level < target) return levelUp(b, `towards level ${target}`, targetHold);
    }

    // The best level per lump is waited for, not traded for whatever is affordable now: spending
    // on cheap low-value levels leaves the lumps spread thin.
    const best = bestLevel(buildings);
    if (!best) return null;
    return levelUp(byName.get(best.name), `+1% of a ${(best.share * 100).toFixed(1)}% share of CpS`, sugarBaking || guard ? SUGAR_BAKING_HOLD : 0);
}

/**
 * What one lump is worth where it would otherwise go, in seconds of CpS: the best building level
 * over the horizon, plus, with Sugar baking owned and the jar at 100 or less, the jar standing
 * one lump short (1/(100 + L) of CpS, main.js:5095) until it would have reached 100.
 *
 * @param {object} args
 * @param {number} args.bestPerLump    fraction of CpS the best building level adds per lump (0: none)
 * @param {number} args.lumps
 * @param {boolean} args.sugarBaking
 * @param {number} args.secondsToLump  until the next lump is harvested
 * @param {number} args.lumpSeconds    between harvests
 */
export function lumpWorth({ bestPerLump, lumps, sugarBaking, secondsToLump, lumpSeconds }) {
    const level = (bestPerLump || 0) * LEVEL_HORIZON_SECONDS;
    if (!sugarBaking || lumps > SUGAR_BAKING_HOLD) return level;
    const share = 0.01 / (1 + 0.01 * Math.max(0, lumps));
    const short = Math.min(LEVEL_HORIZON_SECONDS, Math.max(0, secondsToLump) + (SUGAR_BAKING_HOLD - lumps) * lumpSeconds);
    return share * short + level;
}

// --- Harvest -------------------------------------------------------------------------------

/**
 * Whether to click the lump now, and how much bank the buyer should keep for it.
 *
 * A ripe click pays harvestLumps(1), exactly what the fall at overripe pays (main.js:4476-4483,
 * 4605-4613), so a ripe lump is harvested at once and the next one starts growing sooner. A mature
 * click pays nothing half the time (main.js:4471-4474), so it is never made, with one exception
 * below. The lump's type is fixed at the previous harvest (main.js:4477, 4524-4538), so reading it
 * is reading, not deciding.
 *
 * A golden lump also pays min(CpS × 86400, bank), with buffs in the CpS (main.js:4492-4496). Its
 * hour between ripe and falling is the one timing choice lumps offer: keep the bank growing (the
 * buyer holds its spending) when the cookies gained beat the purchases delayed, and with the bank
 * already at the cap, wait for a CpS buff that lifts the cap. Never past the last safe moment.
 *
 * @param {object} a
 * @param {number} a.age                ms since the lump began (Date.now() - Game.lumpT)
 * @param {number} a.matureAge
 * @param {number} a.ripeAge
 * @param {number} a.overripeAge        ms; Game.lumpMatureAge, lumpRipeAge, lumpOverripeAge
 * @param {number} a.type               Game.lumpCurrentType
 * @param {number} a.bank
 * @param {number} a.cps                CpS now, buffs included
 * @param {number} a.unbuffedCps
 * @param {number} a.payback            seconds the buyer's best purchase takes to repay (Infinity: nothing to buy)
 * @param {number} a.lumpWorth          seconds of CpS one lump is worth (lumpWorth)
 * @param {number} a.goldenWait         expected seconds until the next golden cookie (Infinity: none spawn)
 * @param {boolean} a.ascending         the ascension is collecting what it would otherwise lose
 * @returns {{harvest: boolean, hold: number, reason: string}}  hold: bank the buyer should keep, 0 for none
 */
export function decideHarvest(a) {
    const out = (harvest, hold, reason) => ({ harvest, hold, reason });
    const ripe = a.age >= a.ripeAge;
    if (a.type !== GOLDEN) return ripe ? out(true, 0, 'ripe') : out(false, 0, 'not ripe');

    const baseCap = a.unbuffedCps * GOLDEN_CAP_SECONDS;
    if (!(baseCap > 0)) return ripe ? out(true, 0, 'ripe') : out(false, 0, 'not ripe'); // no CpS: nothing to time
    const payoutNow = Math.min(a.cps * GOLDEN_CAP_SECONDS, a.bank);
    if (a.ascending) {
        // After the reset the bank is gone, and the payout with it.
        if (ripe) return out(true, 0, 'golden: collected before the ascension');
        if (a.age >= a.matureAge) {
            // A mature click still pays the cookies; the 2-7 lumps come half the time.
            const lumpsLost = 0.5 * GOLDEN_MEAN_LUMPS * a.lumpWorth * a.unbuffedCps;
            if (payoutNow > lumpsLost) return out(true, 0, 'golden: its cookies before the ascension beat half its lumps');
        }
        return out(false, 0, 'golden: kept for the next run');
    }

    const lastSafe = a.overripeAge - HARVEST_SAFETY_MS;
    const secondsLeft = Math.max(0, (lastSafe - a.age) / 1000);
    if (!ripe) {
        // Holding cookies for t seconds costs about t/(2 × payback) of them in delayed purchases,
        // so the hold that pays best starts one payback before the harvest, and never earlier
        // than it takes the income to fill the bank to the cap.
        const room = Math.max(0, baseCap - a.bank);
        const lead = Math.min(a.payback, a.cps > 0 ? room / a.cps : Infinity);
        return secondsLeft <= lead ? out(false, baseCap, 'golden: filling the bank before it ripens') : out(false, 0, 'golden: not ripe');
    }
    if (a.age >= lastSafe) return out(true, 0, 'golden: last safe moment before it falls');
    if (a.cps > a.unbuffedCps && a.bank > baseCap) return out(true, 0, 'golden: a CpS buff lifts the cap');

    // Bank-limited: hold to the last safe moment if the cookies gained beat what holding costs,
    // the purchases delayed and the next lump starting later.
    const held = secondsLeft * a.unbuffedCps;
    const gain = Math.min(baseCap, a.bank + held) - payoutNow;
    const cost = (held * secondsLeft) / (2 * a.payback) + (secondsLeft / (a.ripeAge / 1000)) * a.lumpWorth * a.unbuffedCps;
    if (gain > cost && a.bank < baseCap) return out(false, baseCap, 'golden: holding the bank for its payout');
    // At the cap only a CpS buff raises the payout, up to sevenfold for a Frenzy; the wait costs a
    // fraction of a lump.
    if (a.bank >= baseCap && a.goldenWait < secondsLeft) return out(false, FRENZY_MULT * baseCap, 'golden: waiting for a CpS buff');
    return out(true, 0, 'golden: holding would not pay');
}

// --- Sugar frenzy ----------------------------------------------------------------------------

/**
 * What Sugar frenzy adds if switched on now, in seconds of unbuffed CpS: two hours, plus the
 * extra it makes on top of every CpS buff running now for as long as both last.
 *
 * @param {Array<{multCpS?: number, secondsLeft: number}>} buffs
 */
export function frenzyValue(buffs) {
    let value = FRENZY_SECONDS;
    for (const b of buffs) {
        if (b.multCpS === undefined || b.multCpS === 1) continue;
        value += (b.multCpS - 1) * Math.min(Math.max(0, b.secondsLeft), FRENZY_SECONDS);
    }
    return (FRENZY_MULT_CPS - 1) * value;
}

/**
 * Whether to switch Sugar frenzy on now.
 *
 * It triples CpS for an hour for one lump, once per ascension (main.js:11036-11045). Late in a run
 * CpS is highest, so two hours of it are worth the most there; the ascension system ends the run
 * when its growth rate falls under the run's average, so the frenzy starts as the rate closes in
 * on the average. A running CpS buff multiplies with it, so it may start a little earlier to land
 * on one. It is skipped when the lump is worth more on a building level (lumpWorth).
 *
 * @param {object} a
 * @param {boolean} a.available   unlocked, unused this ascension, and a lump to pay with
 * @param {Array<{multCpS?: number, secondsLeft: number}>} a.buffs
 * @param {number} a.worth        seconds of CpS the lump is worth elsewhere
 * @param {{instantRate: number, averageRate: number} | null} a.run  the ascension's growth verdict; null when nothing ends runs
 * @param {boolean} a.ascending   the ascension has begun
 * @returns {{activate: boolean, reason: string, value: number}}
 */
export function decideFrenzy(a) {
    const value = frenzyValue(a.buffs);
    const out = (activate, reason) => ({ activate, reason, value });
    if (!a.available) return out(false, 'not available');
    if (a.ascending) return out(false, 'the ascension has begun');
    if (!(value > a.worth)) return out(false, 'the lump is worth more on a building level');
    const stacked = value >= (1 + STACK_GAIN) * (FRENZY_MULT_CPS - 1) * FRENZY_SECONDS;
    if (!a.run) return stacked ? out(true, 'stacked on a CpS buff') : out(false, 'waiting for a CpS buff to stack on');
    const ratio = a.run.instantRate / a.run.averageRate;
    if (!(a.run.averageRate > 0) || !Number.isFinite(ratio)) return out(false, 'the run\'s growth is not known yet');
    if (ratio <= 1 + FRENZY_MARGIN) return out(true, 'the run is near its end');
    if (stacked && ratio <= 1 + STACK_MARGIN) return out(true, 'the run is near its end, stacked on a CpS buff');
    return out(false, 'the run is still growing');
}
