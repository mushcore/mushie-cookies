/**
 * Stock market loans: whether taking one now is worth it. Pure.
 *
 * A loan multiplies CpS for a while, then divides it for longer, and takes a share of the whole
 * bank at once (minigameMarket.js:348-353, 369-384). On ordinary income every loan loses (see
 * the tests), so a loan pays only on income far above ordinary for its boost: a combo of golden
 * cookie buffs, whose clicks it scales too (each mouse upgrade adds 1% of the buffed CpS to a
 * click, main.js:4692-4708), or a run that ends before its interest does (the reset clears every
 * buff without running a loan's onDie, main.js:3492 and 13827, so no interest is charged).
 */
import { incomeSpikeRunning } from './buffs.js';

/**
 * The three loans. The game stores durations in minutes and passes minutes × 60 as seconds
 * (minigameMarket.js:376, 380); `office` is the office level whose buttons show it (:1090-1095).
 */
export const LOANS = Object.freeze([
    { id: 1, mult: 1.5, seconds: 2 * 60 * 60, interestMult: 0.25, interestSeconds: 4 * 60 * 60, downpayment: 0.2, office: 2 },
    { id: 2, mult: 2, seconds: 0.67 * 60, interestMult: 0.1, interestSeconds: 40 * 60, downpayment: 0.4, office: 4 },
    { id: 3, mult: 1.2, seconds: 2 * 24 * 60 * 60, interestMult: 0.8, interestSeconds: 5 * 24 * 60 * 60, downpayment: 0.5, office: 5 },
]);

/**
 * Income a CpS multiplier scales, summed over [from, to] seconds from now.
 * @param {Array<{seconds: number, perSecond: number}>} profile  what is known, in order from now
 * @param {number} expected  per second once the profile has run out
 */
export function incomeOver(profile, expected, from, to) {
    let sum = 0;
    let t = 0;
    for (const { seconds, perSecond } of profile) {
        const lo = Math.max(from, t);
        const hi = Math.min(to, t + seconds);
        if (hi > lo) sum += perSecond * (hi - lo);
        t += seconds;
    }
    if (to > Math.max(from, t)) sum += expected * (to - Math.max(from, t));
    return sum;
}

/**
 * What taking `loan` now is worth, in cookies.
 * @param {object} args
 * @param {object} args.loan
 * @param {Array<{seconds, perSecond}>} [args.profile]  income the loan would scale over the running buffs
 * @param {number} args.expected     income it would scale per second on average, with no buff known
 * @param {number} args.bank
 * @param {number} [args.secondsLeft=Infinity]  until the run ends; nothing after that counts
 * @returns {{gain: number, cost: number, net: number}}
 */
export function loanValue({ loan, profile = [], expected, bank, secondsLeft = Infinity }) {
    const boostEnd = Math.min(loan.seconds, secondsLeft);
    const interestEnd = Math.min(loan.seconds + loan.interestSeconds, secondsLeft);
    const gain = (loan.mult - 1) * incomeOver(profile, expected, 0, boostEnd);
    // Interest scales the same income down; a combo that lands then is the forecast check's job.
    const interest = interestEnd > loan.seconds ? (1 - loan.interestMult) * expected * (interestEnd - loan.seconds) : 0;
    // The downpayment is a share of the whole bank (minigameMarket.js:375), gone for good.
    const cost = loan.downpayment * bank + interest;
    return { gain, cost, net: gain - cost };
}

/**
 * What could make a loan pay now, before any valuation: 'combo' while an income spike runs (the
 * shared classifier, src/core/buffs.js), 'run end' when the run is forecast to end inside the
 * longest boost of `loans` (its interest is then never charged), else null. A long boost (Sugar
 * frenzy, a loan, a golden lump's blessing) is no combo: it lasts hours or days, and on it every
 * loan loses as on ordinary income.
 * @param {object} args
 * @param {object|Array<object>} args.buffs  Game.buffs
 * @param {number} [args.secondsLeft=Infinity]  until the run is forecast to end
 * @param {Array<object>} args.loans  the loans that could be taken
 * @param {number} [args.fps=30]
 */
export function loanOccasion({ buffs, secondsLeft = Infinity, loans, fps = 30 }) {
    if (incomeSpikeRunning(buffs, { fps })) return 'combo';
    if (loans.length && secondsLeft <= Math.max(...loans.map((l) => l.seconds))) return 'run end';
    return null;
}

/**
 * Income a loan's multiplier would scale over the buffs running now, piece by piece as each ends:
 * CpS with the CpS buffs still running, and the CpS share of each click (each mouse upgrade adds
 * 1% of the buffed CpS to a click, main.js:4692-4708) with the buffs still running. Empty when no
 * buff raises income.
 * @param {object} args
 * @param {Array<{seconds: number, multCpS?: number, multClick?: number}>} args.buffs
 * @param {number} args.cps               CpS with no buff
 * @param {number} args.clicksPerSecond
 * @param {number} args.clickShare        cookies per click that scale with CpS, with every buff running
 */
export function comboProfile({ buffs, cps, clicksPerSecond, clickShare }) {
    if (!buffs.some((b) => (b.multCpS || 1) > 1 || (b.multClick || 1) > 1)) return [];
    const mult = (list, key) => list.reduce((m, b) => m * (b[key] === undefined ? 1 : b[key]), 1);
    const cpsNow = mult(buffs, 'multCpS');
    const clickNow = mult(buffs, 'multClick');
    const ends = Array.from(new Set(buffs.map((b) => b.seconds))).sort((a, b) => a - b);
    const profile = [];
    let t = 0;
    for (const end of ends) {
        const running = buffs.filter((b) => b.seconds > t);
        const cpsMult = mult(running, 'multCpS');
        const clicks = cpsNow > 0 && clickNow > 0 ? clicksPerSecond * clickShare * (cpsMult / cpsNow) * (mult(running, 'multClick') / clickNow) : 0;
        profile.push({ seconds: end - t, perSecond: cps * cpsMult + clicks });
        t = end;
    }
    return profile;
}

const MANA_STEP_SECONDS = 30;

/**
 * Seconds from now at which each of the next `count` casts of a spell costing `cost` could be
 * made, casting as soon as the mana covers it, inside `window`. Mana regenerates
 * max(0.002, √(mana / max(max mana, 100))) × 0.002 a frame at 30 frames a second, up to the
 * maximum (minigameGrimoire.js:486-488).
 */
export function castTimes({ mana, maxMana, cost, count, window }) {
    const times = [];
    if (!(cost <= maxMana)) return times;
    let t = 0;
    let m = mana;
    while (times.length < count) {
        while (m < cost && t <= window) {
            m = Math.min(maxMana, m + Math.max(0.002, Math.sqrt(m / Math.max(maxMana, 100))) * 0.002 * 30 * MANA_STEP_SECONDS);
            t += MANA_STEP_SECONDS;
        }
        if (t > window || m < cost) break;
        times.push(t);
        m -= cost;
    }
    return times;
}

const ETA_WINDOW_SECONDS = 30 * 60; // how far back the trend is fitted
const ETA_MIN_SAMPLES = 10;

/**
 * Seconds until the ascension system is expected to end the run, or Infinity when it cannot be
 * said. It ascends once the run's current growth rate falls under the run's average
 * (src/core/ascension.js); this fits a line to their gap over the last half hour and extends it
 * to zero.
 * @param {Array<{t: number, gap: number}>} samples  oldest first; t in seconds, gap = current − average
 */
export function secondsToAscension(samples) {
    if (!samples.length) return Infinity;
    const last = samples[samples.length - 1];
    if (last.gap <= 0) return 0;
    const recent = samples.filter((s) => s.t >= last.t - ETA_WINDOW_SECONDS);
    if (recent.length < ETA_MIN_SAMPLES) return Infinity;
    const n = recent.length;
    const mt = recent.reduce((s, x) => s + x.t, 0) / n;
    const mg = recent.reduce((s, x) => s + x.gap, 0) / n;
    let num = 0;
    let den = 0;
    for (const x of recent) {
        num += (x.t - mt) * (x.gap - mg);
        den += (x.t - mt) * (x.t - mt);
    }
    const slope = den > 0 ? num / den : 0;
    if (!(slope < 0)) return Infinity;
    // Where the fitted line reaches zero, measured from the latest sample.
    const atLast = mg + slope * (last.t - mt);
    return Math.max(0, -atLast / slope);
}

/**
 * Which loan to take now, or null for none.
 *
 * A loan is taken only when it is worth more than it costs, its downpayment comes out of what
 * the buyer is not holding (and out of what it is saving for only when the loan returns more per
 * cookie-second than that purchase), and no combo forecast inside its window (boost and interest,
 * while it cannot be taken again, minigameMarket.js:374) would be worth more to take it on. Of
 * the loans that qualify, the most valuable.
 *
 * @param {object} args
 * @param {Array<object>} args.loans       loans that can be taken now (office level, none running)
 * @param {{profile, expected, bank, secondsLeft}} args.now
 * @param {number} args.spendable          bank above the buyer's reserve
 * @param {number} [args.committed=0]      of that, what the buyer is saving for its next purchase
 * @param {number} [args.buyerReturn=0]    1 / that purchase's purePayback
 * @param {Array<{inSeconds: number, profile}>} [args.ahead]  combos forecast to come
 * @returns {{loan: object, net: number, gain: number, cost: number} | null}
 */
export function chooseLoan({ loans, now, spendable, committed = 0, buyerReturn = 0, ahead = [] }) {
    const secondsLeft = now.secondsLeft === undefined ? Infinity : now.secondsLeft;
    let best = null;
    for (const loan of loans) {
        const down = loan.downpayment * now.bank;
        if (down > spendable) continue;
        const value = loanValue({ loan, ...now, secondsLeft });
        if (!(value.net > 0)) continue;
        if (down > spendable - committed && !(value.net / (down * Math.min(loan.seconds, secondsLeft)) > buyerReturn)) continue;
        const window = loan.seconds + loan.interestSeconds;
        const better = ahead.some(
            (combo) =>
                combo.inSeconds < Math.min(window, secondsLeft) &&
                loanValue({ loan, profile: combo.profile, expected: now.expected, bank: now.bank, secondsLeft: secondsLeft - combo.inSeconds }).net > value.net
        );
        if (better) continue;
        if (!best || value.net > best.net) best = { loan, ...value };
    }
    return best;
}
