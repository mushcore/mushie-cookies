/**
 * Seasons: which one to be in, and when to switch. Pure; src/systems/seasons.js measures the
 * values against the live game and makes the switch chosen here.
 *
 * Every plan is valued in cookies over the rest of the run (the horizon): what the season pays
 * while it runs (reindeer in Christmas), what its drops are worth from the moment they are
 * expected to arrive, minus the switches the plan pays for. Drops reset every ascension, and so
 * does the switch count (main.js:3520-3522, 3560-3571), so the plan starts again each run.
 */

/** A switch costs this plus a minute of unbuffed CpS, times 1.5 per switch this run (main.js:12443). */
export const SWITCH_BASE = 1e9;
/** A plan must beat staying by this share of the switch it pays for: the values are estimates. */
export const SWITCH_MARGIN = 0.25;
/** A Valentine's visit that has not finished unlocking hearts by then is given up. */
export const MAX_VISIT_SECONDS = 600;
/** Seasons that can be rested in; Business Day and Valentine's pay nothing while they run. */
const REST = ['christmas', 'easter', 'halloween'];

/** The price of the next switch (main.js:12432-12444); `godMult` is Selebrak's (x2, 1.5, 1.25). */
export function switchPrice({ unbuffedCps, uses, godMult = 1 }) {
    return SWITCH_BASE + unbuffedCps * 60 * Math.pow(1.5, uses) * godMult;
}

/** Cookies sacrificed to take Santa from `level` to the next (main.js:14741); 14 is the last. */
export function santaPrice(level) {
    return level >= 14 ? Infinity : Math.pow(level + 1, level + 1);
}

/**
 * Expected seconds between one new drop and the next, for a pool of `total` drops chosen at
 * random, of which `missing` are still to find: each roll (`rate` a second) drops with `chance`
 * and is new only if it picks a missing one (reindeer, main.js:5809-5815; wrinklers, 14501-14508).
 */
export function uniformWaits({ missing, total, rate, chance }) {
    const waits = [];
    for (let left = missing; left > 0; left--) {
        const perSecond = rate * chance * (left / total);
        waits.push(perSecond > 0 ? 1 / perSecond : Infinity);
    }
    return waits;
}

/**
 * The same for eggs: a successful roll (`rate` a second) picks one of 8 rare eggs one time in ten
 * and one of 12 common eggs otherwise, and draws once more if it picked one already found
 * (main.js:10444-10456). Rare and common are used up in expectation.
 */
export function eggWaits({ rareMissing, commonMissing, rate }) {
    const waits = [];
    let rare = rareMissing;
    let common = commonMissing;
    for (let n = rareMissing + commonMissing; n > 0; n--) {
        const q = (0.1 * rare) / 8 + (0.9 * common) / 12;
        const perSecond = rate * (q + (1 - q) * q);
        waits.push(perSecond > 0 ? 1 / perSecond : Infinity);
        if (q <= 0) continue;
        const rareShare = (0.1 * rare) / 8 / q;
        rare = Math.max(0, rare - rareShare);
        common = Math.max(0, common - (1 - rareShare));
    }
    return waits;
}

/** Cookies the drops are worth by the end of the horizon, each adding `gain` a second once found. */
export function collectionValue({ waits, gain, horizon }) {
    let t = 0;
    let value = 0;
    for (const wait of waits) {
        t += wait;
        if (!(t < horizon)) break;
        value += gain * (horizon - t);
    }
    return value;
}

/** Seconds until the last of the drops `collectionValue` counts is expected in. */
export function collectionSeconds({ waits, horizon }) {
    let t = 0;
    let last = 0;
    for (const wait of waits) {
        t += wait;
        if (!(t < horizon)) break;
        last = t;
    }
    return last;
}

/**
 * What a Valentine's visit would collect now. Heart k unlocks, in Valentine's only, once cookies
 * earned reach its price/20 and heart k-1 is bought (main.js:9790-9798, 16335-16345); each is
 * then the buyer's to buy. The chain counts hearts from the first one not bought while each
 * unlocks now, repays itself within the horizon, and is within the bank plus five minutes of
 * income (a visit does not wait for savings).
 *
 * @param {Array<{price: number, basePrice: number, bought: boolean, unlocked: boolean}>} args.hearts  in order
 * @returns {{count: number, locked: number, value: number, seconds: number}}
 *          `locked`: how many of them still need the season to unlock; `value`: their net worth
 */
export function heartVisit({ hearts, earned, gain, horizon, budget, income }) {
    let count = 0;
    let locked = 0;
    let value = 0;
    let spent = 0;
    for (const heart of hearts) {
        if (heart.bought) continue;
        if (!heart.unlocked && earned < heart.basePrice / 20) break;
        const worth = gain * horizon - heart.price;
        if (!(worth > 0)) break;
        spent += heart.price;
        if (spent > budget + income * 300) break;
        count++;
        value += worth;
        if (!heart.unlocked) locked++;
    }
    // The game checks unlocks every 5 s (main.js:16314); the buyer buys each in between.
    return { count, locked, value, seconds: 10 * locked + 10 };
}

/**
 * The next move.
 *
 * @param {object} s
 * @param {string} s.season, s.baseSeason  now, and the calendar's season (free: switching back to
 *        it is a click on the active switch, which cancels it, main.js:12476-12490)
 * @param {boolean} s.canSwitch             Season switcher owned
 * @param {[number, number]} s.prices       the next switch and the one after it
 * @param {number} s.horizon                seconds left in the run
 * @param {object} s.values                 by season: {standing: cookies a second while it runs,
 *        collection: cookies its missing drops are worth within the horizon, nextDrop: seconds,
 *        seconds: until the last of those drops is expected in; given, the season is visited,
 *        quick: {value, seconds} what a visit that short collects for good (A festive hat, which
 *        opens Santa in every season), part of the collection}
 * @param {{value, locked, seconds}|null} s.visit  what a Valentine's visit would collect now
 * @param {string[]} [s.blocked]            seasons not to switch into
 * @param {number} s.secondsInSeason        how long the current season has run
 * @returns {{action: 'stay'|'switch'|'cancel', to?: string, rest?: string, price?: number, gain?: number, reason: string}}
 */
export function planSeason(s) {
    const H = s.horizon;
    const value = (season) => s.values[season] || { standing: 0, collection: 0, nextDrop: Infinity };
    const worth = (season, seconds = H) => value(season).standing * Math.max(0, seconds) + value(season).collection;
    const stay = (reason) => ({ action: 'stay', reason });
    if (!s.canSwitch) return stay('no Season switcher');

    const visit = s.visit && s.visit.locked > 0 ? s.visit : null;
    if (s.season === 'valentines' && visit && s.secondsInSeason < MAX_VISIT_SECONDS) return stay('hearts are still unlocking');
    // While the calendar's season has drops to give, no other season is rested in: a visit comes
    // back to it, and from anywhere else it is returned to (both for free, by cancelling). Hearts
    // are not such drops: they come on a visit (s.visit), and Valentine's pays nothing to rest in.
    const keep = !!s.baseSeason && s.baseSeason !== 'valentines' && value(s.baseSeason).nextDrop < H;
    // Kept, any other season is only visited: once what it was visited for is in, it is left.
    const visiting = keep && s.season !== s.baseSeason;

    const blocked = new Set(s.blocked || []);
    const free = (to) => !!s.baseSeason && to === s.baseSeason && s.season !== s.baseSeason;
    const [p0, p1] = s.prices;
    const plans = [];
    const targets = new Set(REST.concat(s.baseSeason ? [s.baseSeason] : []));
    // Where a visit may end: anywhere, unless the calendar's season has drops to give.
    const restAfter = (visited) => [...targets].filter((rest) => rest !== visited && !blocked.has(rest) && !(keep && rest !== s.baseSeason));

    // A season with drops to collect in `seconds` (less than the horizon) is visited: it runs until
    // they are expected in, then the run rests elsewhere. Rested in for the whole horizon instead,
    // it was set against a whole run of reindeer: after its first drop it no longer beat them, and
    // the planner switched out, and later back in at a higher price.
    const span = (season) => {
        const v = value(season);
        return v.collection > 0 && v.seconds > 0 && v.seconds < H ? v.seconds : null;
    };
    const visitWorth = (season, rest) => value(season).collection + value(season).standing * span(season) + worth(rest, H - span(season));
    // A short visit from a kept calendar season, for what it collects in seconds, then back for free.
    const quick = (season) => {
        const q = value(season).quick;
        return keep && q && q.value > 0 ? q : null;
    };
    const quickWorth = (season) => quick(season).value + value(season).standing * quick(season).seconds + worth(s.baseSeason, H - quick(season).seconds);
    // Visiting, staying is worth only finishing the visit; going back is the alternative.
    let now = visiting ? worth(s.baseSeason) : worth(s.season);
    let finishing = null;
    if (span(s.season) !== null) {
        for (const rest of restAfter(s.season)) {
            const net = visitWorth(s.season, rest) - (free(rest) ? 0 : p0);
            if (net > now) {
                now = net;
                finishing = rest;
            }
        }
    }
    if (visiting && quick(s.season) && quickWorth(s.season) > now) {
        now = quickWorth(s.season);
        finishing = s.baseSeason;
    }

    for (const to of targets) {
        if (to === s.season || blocked.has(to) || (keep && to !== s.baseSeason)) continue;
        const price = free(to) ? 0 : p0;
        plans.push({ to, price, net: worth(to) - price, reason: `rest in ${to}` });
        if (span(to) === null) continue;
        for (const rest of restAfter(to)) {
            const back = rest === s.baseSeason && s.baseSeason ? 0 : price > 0 ? p1 : p0;
            plans.push({ to, rest, price, net: visitWorth(to, rest) - price - back, reason: `visit ${to} for its drops, then ${rest}` });
        }
    }
    for (const to of Object.keys(s.values)) {
        if (to === s.season || to === s.baseSeason || blocked.has(to) || !quick(to)) continue;
        plans.push({ to, rest: s.baseSeason, price: p0, net: quickWorth(to) - p0, reason: `visit ${to} for ${quick(to).seconds} s, then ${s.baseSeason}` });
    }
    if (visit && s.season !== 'valentines' && !blocked.has('valentines')) {
        // Valentine's first, then the season to rest in: going there first saves a switch. When
        // Valentine's is the calendar's season the visit is a free cancel, which is not a use, so
        // the switch after it is priced as the next one, not the one after.
        const visitPrice = free('valentines') ? 0 : p0;
        for (const rest of new Set([...targets, s.season])) {
            if ((rest === 'valentines' && visitPrice > 0) || blocked.has(rest) || (keep && rest !== s.baseSeason)) continue;
            const back = rest === s.baseSeason && s.baseSeason ? 0 : visitPrice > 0 ? p1 : p0;
            const net = visit.value + worth(rest, H - visit.seconds) - visitPrice - back;
            plans.push({ to: 'valentines', rest, price: visitPrice, net, reason: `visit Valentine's for ${visit.locked} heart(s), then ${rest}` });
        }
    }

    let best = null;
    for (const plan of plans) if (!best || plan.net > best.net) best = plan;
    if (visiting && finishing === null) {
        // Nothing left to visit for: back to the calendar's season, unless going on to another
        // visit from here pays more.
        const on = best && best.to !== s.baseSeason && best.net - now > SWITCH_MARGIN * best.price ? best : null;
        if (!on) return { action: 'cancel', to: s.baseSeason, price: 0, gain: 0, reason: `back to ${s.baseSeason}, which still has drops to give` };
    }
    if (!best) return stay(keep ? 'the calendar season still has drops to give' : 'nowhere to go');
    const gain = best.net - now;
    if (!(gain > SWITCH_MARGIN * best.price) || !(gain > 0)) {
        return stay(finishing ? `${s.season}'s drops are still coming, then ${finishing}` : `${best.reason} would not pay`);
    }
    const out = { action: best.price === 0 && free(best.to) ? 'cancel' : 'switch', to: best.to, price: best.price, gain, reason: best.reason };
    if (best.rest) out.rest = best.rest;
    return out;
}
