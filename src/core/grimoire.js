/**
 * When to cast Force the Hand of Fate. Pure.
 *
 * The next outcome is known (src/game/fate.js). What remains is timing: an outcome is worth more
 * when it lands on a buff that is already running, less under a debuff it can wait out, and mana
 * spent now is mana not regenerating. Values are in cookies; figures come from main.js:5493-5602
 * and 13862-13972.
 *
 * A buff is filed by name, and granting one that is already running only adds the new time to
 * it: the running buff keeps its multiplier (Game.gainBuff, main.js:13765-13771; every golden
 * cookie buff is `add:true`). So an outcome whose buff is running does not stack on it; it is
 * that buff running on after its current time runs out.
 */
import { cpsMultOf, clickMultOf } from './buffs.js';

// The buff each outcome grants, by the name the game files it under (main.js:13869-13968).
// A building special's name depends on the building it picks (5886-5907).
const OUTCOME_BUFF = {
    frenzy: 'Frenzy',
    'blood frenzy': 'Elder frenzy',
    'click frenzy': 'Click frenzy',
    clot: 'Clot',
    'cursed finger': 'Cursed finger',
    'cookie storm': 'Cookie storm',
};

// A storm drop pays 1 to 7 whole minutes of CpS, uniformly: 4 minutes on average, times the
// golden cookie gain multiplier (main.js:5599).
const STORM_DROP_SECONDS = 4 * 60;
// During a cookie storm a drop appears on half of the game's frames (main.js:5257).
const STORM_DROP_CHANCE = 0.5;

const cpsMult = (running) => running.reduce((m, b) => m * cpsMultOf(b), 1);
const clickMult = (running) => running.reduce((m, b) => m * clickMultOf(b), 1);
const storming = (running) => running.some((b) => b.name === 'Cookie storm');

/** Mean, over [from, to] seconds from now, of `f` of the buffs still running. */
function meanOver(buffs, from, to, f) {
    const at = (t) => f(buffs.filter((b) => b.secondsLeft > t));
    if (!(to > from)) return at(from);
    const ends = buffs.map((b) => b.secondsLeft).filter((s) => s > from && s < to).sort((a, b) => a - b);
    let sum = 0;
    let t = from;
    for (const end of ends.concat([to])) {
        sum += at(t) * (end - t);
        t = end;
    }
    return sum / (to - from);
}

/** Mean, over [from, to] seconds from now, of the product of the CpS multipliers of the buffs still running. */
const meanCpsMult = (buffs, from, to) => meanOver(buffs, from, to, cpsMult);

/**
 * Where a buff called `name` would take effect: from now if it is not running; otherwise when the
 * running one would have ended, with the running one's own multiplier (`own`), and only the other
 * buffs to overlap.
 */
function landing(buffs, name) {
    const own = (name && buffs.find((b) => b.name === name)) || null;
    return own ? { own, from: own.secondsLeft, others: buffs.filter((b) => b !== own) } : { own, from: 0, others: buffs };
}

/**
 * Cookies a single outcome is worth if it lands now.
 *
 * ctx.buffs: every running buff as { name, multCpS, multClick, secondsLeft, power }.
 * ctx.buildingSpecials: the building buff a building special could grant, one per building with
 * 10 or more, as { name, mult }; the game picks one of them at random (main.js:5496-5512).
 */
export function outcomeValue(outcome, ctx) {
    const {
        passive, // cookies per second from buildings, unbuffed
        click, // cookies per second from clicking, unbuffed
        clicksPerSecond,
        bank,
        durationMult,
        buildingSpecials = [],
        buffs = [],
        fps = 30, // storm drops are rolled each frame
        gainMult = 1, // what storm drops pay is multiplied by it
        stormReach = 1, // the share of storm drops clicked before they fade: all, clicked on sight
    } = ctx;
    // The game rounds buff durations up to whole seconds (main.js:5494-5595).
    const d = (seconds) => Math.ceil(seconds * durationMult);
    const cpsNow = meanCpsMult(buffs, 0, 0);
    // Seconds of unbuffed CpS a running storm pays each second: the drops reached, minutes of
    // CpS each (main.js:5257, 5599).
    const stormSecondsPerSecond = fps * STORM_DROP_CHANCE * stormReach * STORM_DROP_SECONDS * gainMult;
    // What a CpS multiplier multiplies each second, given the other buffs running: buildings;
    // clicks, which Plastic mouse and its kind pay a share of buffed CpS (main.js:4692-4708) under
    // any click buff; and a storm's drops, minutes of buffed CpS each (5599).
    const cpsScaled = (running) =>
        cpsMult(running) * (passive + click * clickMult(running) + (storming(running) ? passive * stormSecondsPerSecond : 0));
    // What a click multiplier multiplies: clicks, under every other buff (4732-4735).
    const clickScaled = (running) => click * cpsMult(running) * clickMult(running);
    // What raising CpS or clicks by `mult` for `seconds` adds, as a buff called `name`.
    const boost = (name, seconds, mult, key = 'multCpS') => {
        const at = landing(buffs, name);
        const m = at.own ? (at.own[key] === undefined ? 1 : at.own[key]) : mult;
        const scaled = key === 'multClick' ? clickScaled : cpsScaled;
        return (m - 1) * d(seconds) * meanOver(at.others, at.from, at.from + d(seconds), scaled);
    };
    switch (outcome) {
        case 'frenzy':
            return boost('Frenzy', 77, 7);
        case 'building special':
            // With no building at 10 or more the game gives a frenzy instead (main.js:5501).
            if (!buildingSpecials.length) return outcomeValue('frenzy', ctx);
            return buildingSpecials.reduce((sum, s) => sum + boost(s.name, 30, s.mult), 0) / buildingSpecials.length;
        case 'click frenzy':
            return boost('Click frenzy', 13, 777, 'multClick');
        case 'blood frenzy':
            return boost('Elder frenzy', 6, 666);
        case 'multiply cookies':
            return Math.min(0.15 * bank, 900 * passive * cpsNow) + 13;
        case 'cookie storm': {
            // Drops for as long as the storm lasts, those reached.
            const at = landing(buffs, 'Cookie storm');
            const drops = fps * STORM_DROP_CHANCE * d(7) * stormReach;
            return passive * STORM_DROP_SECONDS * gainMult * drops * meanCpsMult(at.others, at.from, at.from + d(7));
        }
        case 'cookie storm drop':
            return passive * STORM_DROP_SECONDS * gainMult * cpsNow;
        case 'cursed finger': {
            // CpS stops; each click pays the CpS of the whole duration as it was when the finger
            // struck (main.js:5556), so a running finger keeps its own payout.
            const at = landing(buffs, 'Cursed finger');
            const perClick = at.own ? at.own.power || 0 : passive * cpsNow * d(10);
            return clicksPerSecond * d(10) * perClick - passive * d(10) * meanCpsMult(at.others, at.from, at.from + d(10));
        }
        case 'clot':
            return boost('Clot', 66, 0.5);
        case 'ruin cookies':
            return -(Math.min(0.05 * bank, 600 * passive * cpsNow) + 13);
        case 'free sugar lump':
            return Infinity;
        default:
            return 0; // blab, everything must go
    }
}

/**
 * What an outcome landing now leaves for a cast right after it, as [{ weight, ctx }]: its buff
 * running, or the running buff of its name lengthened with its own multiplier kept (main.js:
 * 13765-13771), and its payout in the bank. A building special may leave any one of its picks.
 */
export function afterOutcome(outcome, ctx) {
    const buffs = ctx.buffs || [];
    const specials = ctx.buildingSpecials || [];
    const d = (seconds) => Math.ceil(seconds * ctx.durationMult);
    const cpsNow = meanCpsMult(buffs, 0, 0);
    const only = (next) => [{ weight: 1, ctx: next }];
    const withBuff = (name, seconds, multCpS = 1, multClick = 1, extra = {}) => {
        const own = buffs.find((b) => b.name === name);
        const next = own
            ? buffs.map((b) => (b === own ? { ...b, secondsLeft: b.secondsLeft + d(seconds) } : b))
            : buffs.concat([{ name, multCpS, multClick, secondsLeft: d(seconds), ...extra }]);
        return { ...ctx, buffs: next };
    };
    const banked = (delta) => ({ ...ctx, bank: Math.max(0, ctx.bank + delta) });
    // Buffs and payouts as main.js:5493-5602 grants them.
    switch (outcome) {
        case 'frenzy':
            return only(withBuff('Frenzy', 77, 7));
        case 'blood frenzy':
            return only(withBuff('Elder frenzy', 6, 666));
        case 'clot':
            return only(withBuff('Clot', 66, 0.5));
        case 'click frenzy':
            return only(withBuff('Click frenzy', 13, 1, 777));
        case 'cookie storm':
            return only(withBuff('Cookie storm', 7));
        case 'cursed finger':
            return only(withBuff('Cursed finger', 10, 0, 1, { power: ctx.passive * cpsNow * d(10) }));
        case 'building special':
            if (!specials.length) return afterOutcome('frenzy', ctx);
            return specials.map((s) => ({ weight: 1 / specials.length, ctx: withBuff(s.name, 30, s.mult) }));
        case 'multiply cookies':
            return only(banked(Math.min(0.15 * ctx.bank, 900 * ctx.passive * cpsNow) + 13));
        case 'ruin cookies':
            return only(banked(-(Math.min(0.05 * ctx.bank, 600 * ctx.passive * cpsNow) + 13)));
        case 'cookie storm drop':
            return only(banked(ctx.passive * STORM_DROP_SECONDS * (ctx.gainMult === undefined ? 1 : ctx.gainMult) * cpsNow));
        default:
            return only(ctx);
    }
}

/** The buffs still running `t` seconds from now, with the time they will have left then. */
const runningAfter = (buffs, t) => buffs.filter((b) => b.secondsLeft > t).map((b) => ({ ...b, secondsLeft: b.secondsLeft - t }));

/**
 * What an outcome would be worth held until each running debuff (a CpS multiplier below 1) ends,
 * as [{ value, seconds, name }], soonest first; empty with none running. A debuff only delays
 * what an outcome is worth: a Cursed finger stops CpS (main.js:5159, 13932) and pays clicks its
 * own power (4744), so a storm drop cast under it pays nothing (5599) and a Lucky 13 cookies
 * (5536), yet either is worth its full amount once the finger ends. Every end is kept, because
 * beside a long debuff (hours of loan interest) the short one is the one worth waiting for.
 */
function afterDebuffs(outcome, ctx) {
    const buffs = ctx.buffs || [];
    return buffs
        .filter((b) => cpsMultOf(b) < 1)
        .map((debuff) => ({
            value: outcomeValue(outcome, { ...ctx, buffs: runningAfter(buffs, debuff.secondsLeft) }),
            seconds: debuff.secondsLeft,
            name: debuff.name,
        }))
        .sort((a, b) => a.seconds - b.seconds);
}

// Mana regenerates max(0.002, √(magic / max(max magic, 100))) × 0.002 a frame, 30 frames a
// second, and stops at the maximum (minigameGrimoire.js:486-488): what each second of waiting
// with mana full throws away.
const fullManaRegen = (maxMana) => Math.max(0.002, Math.sqrt(maxMana / Math.max(maxMana, 100))) * 0.002 * 30;

/** How long an outcome's effect lasts, for deciding whether a running buff covers it. */
const EFFECT_SECONDS = { frenzy: 77, 'building special': 30, 'click frenzy': 13, 'blood frenzy': 6 };

/**
 * Whether an effect lasting `seconds` (none for a one-off payout), as a buff called `name`, lands
 * on a boost: the other buffs running when it takes effect multiply CpS, and the first boost to
 * end still covers half of it. Its own running buff is not something to land on.
 */
function landsOnBoost(buffs, name, seconds) {
    const at = landing(buffs, name);
    const running = at.others.filter((b) => b.secondsLeft > at.from);
    const mult = running.reduce((m, b) => m * cpsMultOf(b), 1);
    const boosts = running.filter((b) => cpsMultOf(b) > 1).map((b) => b.secondsLeft - at.from);
    const left = boosts.length ? Math.min(...boosts) : 0;
    return { mult, stacked: mult > 1 && (!seconds || left >= seconds * 0.5) };
}

/**
 * @param {object} args
 * @param {{success: boolean, outcome: string}} args.next   the forecast for the next cast
 * @param {number} args.mana
 * @param {number} args.maxMana
 * @param {number} args.fateCost
 * @param {number} args.skipCost   the spell cast only to advance the count
 * @param {object} args.ctx        see outcomeValue
 * @returns {{action: 'cast'|'skip'|'wait', reason: string, value: number}}
 */
export function decideCast({ next, mana, maxMana, fateCost, skipCost, ctx }) {
    const value = outcomeValue(next.outcome, ctx);
    const out = (action, reason) => ({ action, reason, value });
    if (value === Infinity) return mana >= fateCost ? out('cast', 'a free sugar lump') : out('wait', 'mana for a sugar lump');
    if (mana < fateCost) return out('wait', 'not enough mana');

    // A debuff never makes an outcome one to burn: only one worthless whenever it is cast is.
    const ends = afterDebuffs(next.outcome, ctx);
    const holding = (end) => `holding ${next.outcome} until ${end.name} ends`;
    if (value <= 0) {
        const worth = ends.find((end) => end.value > 0); // the soonest end at which it pays
        if (worth) return out('wait', holding(worth));
        return mana >= skipCost ? out('skip', `the next cast would be ${next.outcome}`) : out('wait', 'mana to skip');
    }
    const full = mana >= maxMana - 1;
    // Waiting costs nothing while mana is filling. Once it is full, each second waited is
    // regeneration lost, counted as that share of a cast worth what this one would be: a Cursed
    // finger or a clot is waited out, a loan's hours of interest are not. The end to wait for is
    // the one worth most net of its own wait.
    const waitCost = (end) => (full ? (end.value * fullManaRegen(maxMana) * end.seconds) / fateCost : 0);
    let later = null;
    for (const end of ends) {
        const net = end.value - waitCost(end);
        if (net > value && (!later || net > later.net)) later = { ...end, net };
    }
    if (later) return out('wait', holding(later));

    const buffs = ctx.buffs || [];
    const specials = ctx.buildingSpecials || [];
    const outcome = next.outcome === 'building special' && !specials.length ? 'frenzy' : next.outcome;
    const seconds = EFFECT_SECONDS[outcome] && EFFECT_SECONDS[outcome] * ctx.durationMult;
    // A building special lands on a boost if at least half the buildings it may pick would.
    const picks = outcome === 'building special' ? specials.map((s) => landsOnBoost(buffs, s.name, seconds)) : [landsOnBoost(buffs, OUTCOME_BUFF[outcome], seconds)];
    const landed = picks.filter((p) => p.stacked);
    if (landed.length && landed.length * 2 >= picks.length) {
        return out('cast', `${next.outcome} on a running ×${landed[0].mult.toFixed(1)} buff`);
    }
    if (full) return out('cast', `${next.outcome}, mana is full`);
    return out('wait', `holding ${next.outcome} for a buff`);
}
