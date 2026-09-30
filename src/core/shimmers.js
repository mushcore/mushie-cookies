/**
 * Which shimmers to click, and which news fortunes. Pure.
 *
 * Every golden and wrath cookie is worth clicking, storm drops included: by exact enumeration of
 * the outcome pool a wrath cookie is worth more than a golden one (Lucky always pays at least what
 * Ruin takes, and storms come three times as often), and a cookie left on screen only delays the
 * next one, whose timer restarts when the spawn lead dies (main.js:5234-5242). A reindeer is never
 * a loss (main.js:5787-5793). Golden cookies go first: a reindeer pays on the buffed CpS.
 */

/** The shimmers to pop, in order, as a new array: popping one splices the game's list (main.js:5244). */
export function toPop(shimmers, { golden = false, reindeer = false } = {}) {
    const out = [];
    if (golden) for (const s of shimmers) if (s.type === 'golden') out.push(s);
    if (reindeer) for (const s of shimmers) if (s.type === 'reindeer') out.push(s);
    return out;
}

/**
 * Whether to click the news ticker's fortune (main.js:7625-7657).
 *
 * A fortune upgrade is unlocked for the buyer to judge, and the fortune golden cookie cannot be
 * wrath and is not a spawn lead (main.js:7640): both are taken on sight. The hour of CpS pays
 * min(an hour of the current, buffed CpS, the bank) and is then gone until the next ascension
 * (main.js:7645-7646, 3542), while one left alone returns to the fortune pool (main.js:7575). So
 * it is taken when it pays at least an hour of unbuffed CpS (more during a CpS buff), or anything
 * at all when an ascension is about to reset it.
 *
 * @param {object} args
 * @param {*} args.effect        Game.TickerEffect
 * @param {number} args.bank
 * @param {number} args.cps      Game.cookiesPs, buffed
 * @param {number} args.unbuffedCps
 * @param {boolean} args.ascensionImminent
 * @returns {{take: boolean, reason: string}}
 */
export function fortuneChoice({ effect, bank, cps, unbuffedCps, ascensionImminent }) {
    if (!effect || effect.type !== 'fortune') return { take: false, reason: 'no fortune' };
    if (effect.sub !== 'fortuneCPS') return { take: true, reason: effect.sub === 'fortuneGC' ? 'a golden cookie' : 'an upgrade' };
    const payout = Math.min(cps * 3600, bank);
    if (!(payout > 0)) return { take: false, reason: 'it would pay nothing' };
    if (ascensionImminent) return { take: true, reason: 'an ascension is imminent' };
    if (payout >= unbuffedCps * 3600) return { take: true, reason: 'the bank covers an hour of CpS' };
    return { take: false, reason: 'the bank covers less than an hour of CpS' };
}
