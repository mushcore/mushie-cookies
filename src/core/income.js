/**
 * Income estimate: cookies per second from everything that earns them, from a plain state
 * object. Pure; the adapter in src/game/measure.js builds the state from the live game.
 *
 * Buffs are treated as independent renewal processes. An outcome with probability p and
 * duration d is active a fraction p·d/interval of the time, and overlapping buffs multiply,
 * which is what independence gives.
 */

// Base durations in seconds and multipliers (main.js:13862-13972, 5493-5602).
const CPS_BUFFS = {
    frenzy: { mult: 7, seconds: 77 },
    'dragon harvest': { mult: 15, seconds: 60 },
    'blood frenzy': { mult: 666, seconds: 6 },
    clot: { mult: 0.5, seconds: 66 },
};
const CLICK_BUFFS = {
    'click frenzy': { mult: 777, seconds: 13 },
    dragonflight: { mult: 1111, seconds: 10 },
};
const BUILDING_SPECIAL_SECONDS = 30;
const CURSED_FINGER_SECONDS = 10;

/** Fraction of time an outcome's buff is running. */
function share(probability, seconds, golden) {
    if (!probability || !Number.isFinite(golden.meanInterval) || golden.meanInterval <= 0) return 0;
    return Math.min(1, (probability * seconds * golden.durationMult) / golden.meanInterval);
}

/** Expected cookies per second from one-off payouts (lucky, ruin, chain, storm), sized from real CpS. */
function payoutsPerSecond(state, passive) {
    const { golden, bank } = state;
    const p = golden.probabilities;
    if (!Number.isFinite(golden.meanInterval) || golden.meanInterval <= 0) return { total: 0, byOutcome: {} };
    const byOutcome = {};
    // Lucky: min(15% of the bank, 15 minutes of CpS) + 13 (main.js:5536).
    byOutcome['multiply cookies'] = (p['multiply cookies'] || 0) * (Math.min(0.15 * bank, 900 * passive) * golden.gainMult + 13);
    // Ruin: -(min(5% of the bank, 10 minutes of CpS) + 13) (main.js:5542).
    byOutcome['ruin cookies'] = -(p['ruin cookies'] || 0) * (Math.min(0.05 * bank, 600 * passive) + 13);
    // Chain: capped at min(6 hours of CpS, half the bank); it usually ends near halfway. Approximate.
    byOutcome['chain cookie'] = (p['chain cookie'] || 0) * Math.min(6 * 3600 * passive, 0.5 * bank) * golden.gainMult * 0.5;
    // Storm: a drop on half the frames for 7 s × the duration multiplier, each paying 1 to 7
    // minutes of CpS (4 on average) × the gain multiplier (main.js:5257-5261, 5595-5599).
    // `stormReach` is the share of drops clicked before they fade in 2 to 5 s: all of them when
    // the shimmer system clicks on sight.
    const fps = golden.fps || 30;
    const reach = golden.stormReach === undefined ? 1 : golden.stormReach;
    byOutcome['cookie storm'] = (p['cookie storm'] || 0) * 7 * golden.durationMult * fps * 0.5 * 4 * 60 * passive * golden.gainMult * reach;
    let total = 0;
    for (const name of Object.keys(byOutcome)) {
        byOutcome[name] /= golden.meanInterval;
        total += byOutcome[name];
    }
    return { total, byOutcome };
}

export function estimateIncome(state) {
    const { cps, clickPower, clicksPerSecond, wrinklers, golden } = state;
    const p = golden.probabilities || {};

    // Wrinklers: each sucking wrinkler withers suckRate of CpS (5% base) and stores the whole
    // withered amount, so n of them hand back n × n·suckRate × CpS × returnMult when popped
    // (main.js:5116-5128, 14393, 14467-14479). returnMult is 0 when nothing pops them.
    const n = wrinklers ? wrinklers.count : 0;
    const returnMult = wrinklers ? wrinklers.returnMult : 1;
    const suck = wrinklers && wrinklers.suckRate !== undefined ? wrinklers.suckRate : 0.05;
    const withered = Math.min(1, n * suck);
    const wrinklerMultiplier = 1 - withered + n * withered * returnMult;
    const passive = cps * wrinklerMultiplier;
    const click = clicksPerSecond * clickPower;

    let cpsFactor = 1;
    for (const [name, buff] of Object.entries(CPS_BUFFS)) {
        cpsFactor *= 1 + (buff.mult - 1) * share(p[name], buff.seconds, golden);
    }
    if (golden.buildingSpecialMean > 0) {
        const mult = 1 + golden.buildingSpecialMean / 10;
        cpsFactor *= 1 + (mult - 1) * share(p['building special'], BUILDING_SPECIAL_SECONDS, golden);
        // 30% of a wrath cookie's building specials divide instead (main.js:5506-5508).
        cpsFactor *= 1 + (1 / mult - 1) * share(p['building debuff'], BUILDING_SPECIAL_SECONDS, golden);
    }

    let clickFactor = 1;
    for (const [name, buff] of Object.entries(CLICK_BUFFS)) {
        clickFactor *= 1 + (buff.mult - 1) * share(p[name], buff.seconds, golden);
    }
    // Cursed finger: CpS stops and each click pays the whole duration's CpS (main.js:5556).
    const cursed = share(p['cursed finger'], CURSED_FINGER_SECONDS, golden);
    const cursedClicks = cursed * clicksPerSecond * cps * CURSED_FINGER_SECONDS * golden.durationMult;

    const passiveTotal = passive * cpsFactor * (1 - cursed);
    const clickTotal = click * clickFactor * cpsFactor + cursedClicks;
    const payouts = payoutsPerSecond(state, cps);

    return {
        total: passiveTotal + clickTotal + payouts.total,
        passive: passiveTotal,
        click: clickTotal,
        golden: payouts.total,
        byOutcome: payouts.byOutcome,
        basket: state.basket || 0,
    };
}
