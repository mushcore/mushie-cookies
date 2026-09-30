/**
 * When to cast Force the Hand of Fate. Pure.
 *
 * The next outcome is known (src/game/fate.js). What remains is timing: an outcome is worth more
 * when it lands on a buff that is already running, and mana spent now is mana not regenerating.
 * Values are in cookies; figures come from main.js:5493-5602 and 13862-13972.
 *
 * A buff is filed by name, and granting one that is already running only adds the new time to
 * it: the running buff keeps its multiplier (Game.gainBuff, main.js:13765-13771; every golden
 * cookie buff is `add:true`). So an outcome whose buff is running does not stack on it; it is
 * that buff running on after its current time runs out.
 */

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

// A storm drop pays 1 to 7 whole minutes of CpS, uniformly: 4 minutes on average (main.js:5599).
const STORM_DROP_SECONDS = 4 * 60;
// During a cookie storm a drop appears on half of the game's 30 frames a second (main.js:5257).
const STORM_DROPS_PER_SECOND = 30 * 0.5;

const cpsMultOf = (buff) => (buff.multCpS === undefined ? 1 : buff.multCpS);

/** Mean, over [from, to] seconds from now, of the product of the CpS multipliers of the buffs still running. */
function meanCpsMult(buffs, from, to) {
    const at = (t) => buffs.reduce((m, b) => (b.secondsLeft > t ? m * cpsMultOf(b) : m), 1);
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
    } = ctx;
    const base = passive + click;
    // The game rounds buff durations up to whole seconds (main.js:5494-5595).
    const d = (seconds) => Math.ceil(seconds * durationMult);
    const cpsNow = meanCpsMult(buffs, 0, 0);
    // What raising `perSecond` by `mult` for `seconds` adds, as a buff called `name`.
    const boost = (perSecond, name, seconds, mult, key = 'multCpS') => {
        const at = landing(buffs, name);
        const m = at.own ? (at.own[key] === undefined ? 1 : at.own[key]) : mult;
        return perSecond * (m - 1) * d(seconds) * meanCpsMult(at.others, at.from, at.from + d(seconds));
    };
    switch (outcome) {
        case 'frenzy':
            return boost(base, 'Frenzy', 77, 7);
        case 'building special':
            // With no building at 10 or more the game gives a frenzy instead (main.js:5501).
            if (!buildingSpecials.length) return outcomeValue('frenzy', ctx);
            return buildingSpecials.reduce((sum, s) => sum + boost(base, s.name, 30, s.mult), 0) / buildingSpecials.length;
        case 'click frenzy':
            return boost(click, 'Click frenzy', 13, 777, 'multClick');
        case 'blood frenzy':
            return boost(base, 'Elder frenzy', 6, 666);
        case 'multiply cookies':
            return Math.min(0.15 * bank, 900 * passive * cpsNow) + 13;
        case 'cookie storm': {
            // Drops for as long as the storm lasts, half of them reached.
            const at = landing(buffs, 'Cookie storm');
            const drops = STORM_DROPS_PER_SECOND * d(7) * 0.5;
            return passive * STORM_DROP_SECONDS * drops * meanCpsMult(at.others, at.from, at.from + d(7));
        }
        case 'cookie storm drop':
            return passive * STORM_DROP_SECONDS * cpsNow;
        case 'cursed finger': {
            // CpS stops; each click pays the CpS of the whole duration as it was when the finger
            // struck (main.js:5556), so a running finger keeps its own payout.
            const at = landing(buffs, 'Cursed finger');
            const perClick = at.own ? at.own.power || 0 : passive * cpsNow * d(10);
            return clicksPerSecond * d(10) * perClick - passive * d(10) * meanCpsMult(at.others, at.from, at.from + d(10));
        }
        case 'clot':
            return boost(base, 'Clot', 66, 0.5);
        case 'ruin cookies':
            return -(Math.min(0.05 * bank, 600 * passive * cpsNow) + 13);
        case 'free sugar lump':
            return Infinity;
        default:
            return 0; // blab, everything must go
    }
}

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

    if (value <= 0) {
        return mana >= skipCost ? out('skip', `the next cast would be ${next.outcome}`) : out('wait', 'mana to skip');
    }

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
    if (mana >= maxMana - 1) return out('cast', `${next.outcome}, mana is full`);
    return out('wait', `holding ${next.outcome} for a buff`);
}
