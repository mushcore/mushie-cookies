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
import { incomeSpikeRunning, classifyBuffs } from './buffs.js';

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
 * @param {Array<{inSeconds: number, profile}>} [args.ahead]  combos forecast to come
 * @returns {{gain: number, cost: number, net: number}}
 */
export function loanValue({ loan, profile = [], expected, bank, secondsLeft = Infinity, ahead = [] }) {
    const boostEnd = Math.min(loan.seconds, secondsLeft);
    const interestEnd = Math.min(loan.seconds + loan.interestSeconds, secondsLeft);
    let gain = (loan.mult - 1) * incomeOver(profile, expected, 0, boostEnd);
    let interest = interestEnd > loan.seconds ? (1 - loan.interestMult) * expected * (interestEnd - loan.seconds) : 0;
    // A combo forecast to land while the loan runs is scaled with everything else: up during the
    // boost, down during the interest, where one combo can cost more than the loan made.
    for (const combo of ahead) {
        const seconds = combo.profile.reduce((s, p) => s + p.seconds, 0);
        const above = incomeOver(combo.profile, 0, 0, seconds) - expected * seconds;
        if (!(above > 0)) continue;
        if (combo.inSeconds < boostEnd) gain += (loan.mult - 1) * above;
        else if (combo.inSeconds >= loan.seconds && combo.inSeconds < interestEnd) interest += (1 - loan.interestMult) * above;
    }
    // The downpayment is a share of the whole bank (minigameMarket.js:375), gone for good.
    const cost = loan.downpayment * bank + interest;
    return { gain, cost, net: gain - cost };
}

/**
 * What could make a loan pay now, before any valuation: 'combo' while an income spike runs (the
 * shared classifier, src/core/buffs.js), else null. A long boost (Sugar frenzy, a loan, a golden
 * lump's blessing) is no combo: it lasts hours or days, and on it every loan loses as on ordinary
 * income.
 *
 * The run's end is no occasion either. An ascension clears a loan's interest unpaid (the reset
 * kills buffs without their onDie, main.js:3492 and 13827; the game awards "Debt evasion" for
 * it, main.js:3489), so a player may fairly time a loan to it. Measured, it loses: loan 1 taken
 * when the ascension system's end was forecast inside its two hours kept the run's growth above
 * its average, so the run went on until the boost ended; the interest then collapsed CpS and the
 * ascension came at once, 14 minutes into the interest, hours before the run without the loan
 * ended (x0.05 and x0.11 the prestige gained, x0.25 and x0.51 per second; tools/dev/bank.mjs
 * --prestige, luck-free, two starting prestiges).
 * @param {object} args
 * @param {object|Array<object>} args.buffs  Game.buffs
 * @param {number} [args.fps=30]
 */
export function loanOccasion({ buffs, fps = 30 }) {
    return incomeSpikeRunning(buffs, { fps }) ? 'combo' : null;
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

const LOAN_TYPES = new Set(['loan 1', 'loan 1 interest', 'loan 2', 'loan 2 interest', 'loan 3', 'loan 3 interest']);

/**
 * The factor running loans and their interest put on CpS, 1 with none (the shared classifier's
 * multipliers, src/core/buffs.js). What is earned under them, divided by it, is the income they
 * scale: read as it is, the earnings under one loan's interest make the next loan look cheap.
 * @param {object|Array<object>} buffs  Game.buffs
 */
export function loanFactor(buffs, { fps } = {}) {
    return classifyBuffs(buffs, { fps })
        .filter((c) => LOAN_TYPES.has(c.type))
        .reduce((m, c) => m * c.cpsMult, 1);
}

const MIN_RATE_SECONDS = 5 * 60; // less history than this says nothing about a rate

/**
 * Seconds of unbuffed CpS the run has earned a second over the last `seconds` of `samples`,
 * combos and clicks and all, or 0 with less than five minutes of history. Each stretch between
 * samples is counted in seconds of the CpS of its time, with the loans' own factor taken out:
 * CpS grows as the run reinvests, so a combo counted in cookies looks smaller the longer ago it
 * landed, while each one, counted this way, is worth as much to the run by the time the combos
 * of a loan's interest land. The smaller CpS and factor at either end are used, which reads more
 * rather than less.
 * @param {Array<{t: number, earned: number, cps: number, factor: number}>} samples  oldest first;
 *   t in seconds of play, cps unbuffed, factor loanFactor's
 */
export function incomeMultiple(samples, seconds) {
    if (!samples.length) return 0;
    const last = samples[samples.length - 1];
    const from = samples.findIndex((s) => s.t >= last.t - seconds);
    if (!(last.t - samples[from].t >= MIN_RATE_SECONDS)) return 0;
    let sum = 0;
    for (let i = from + 1; i < samples.length; i++) {
        const a = samples[i - 1];
        const b = samples[i];
        const scale = Math.min(a.cps, b.cps) * Math.min(a.factor, b.factor);
        if (scale > 0) sum += Math.max(0, b.earned - a.earned) / scale;
    }
    return sum / (last.t - samples[from].t);
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
 * A loan is taken only when it is worth more than it costs, the combos forecast to land in its
 * boost and its interest counted in, its downpayment comes out of what the buyer is not holding
 * (and out of what it is saving for only when the loan returns more per cookie-second than that
 * purchase), and no combo forecast inside its window (boost and interest, while it cannot be
 * taken again, minigameMarket.js:374) would be worth more to take it on. Of the loans that
 * qualify, the most valuable.
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
        const value = loanValue({ loan, ...now, secondsLeft, ahead });
        if (!(value.net > 0)) continue;
        if (down > spendable - committed && !(value.net / (down * Math.min(loan.seconds, secondsLeft)) > buyerReturn)) continue;
        const window = loan.seconds + loan.interestSeconds;
        // Taken on a combo to come instead, the loan is valued from there, with the combos after it.
        const better = ahead.some(
            (combo) =>
                combo.inSeconds < Math.min(window, secondsLeft) &&
                loanValue({
                    loan,
                    profile: combo.profile,
                    expected: now.expected,
                    bank: now.bank,
                    secondsLeft: secondsLeft - combo.inSeconds,
                    ahead: ahead.filter((c) => c.inSeconds > combo.inSeconds).map((c) => ({ ...c, inSeconds: c.inSeconds - combo.inSeconds })),
                }).net > value.net
        );
        if (better) continue;
        if (!best || value.net > best.net) best = { loan, ...value };
    }
    return best;
}
