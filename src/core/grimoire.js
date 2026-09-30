/**
 * When to cast Force the Hand of Fate. Pure.
 *
 * The next outcome is known (src/game/fate.js). What remains is timing: an outcome is worth more
 * when it lands on a buff that is already running, and mana spent now is mana not regenerating.
 * Values are in cookies; figures come from main.js:5493-5602 and 13862-13972.
 */

/** Cookies a single outcome is worth if it lands now. */
export function outcomeValue(outcome, ctx) {
    const {
        passive, // cookies per second from buildings, unbuffed
        click, // cookies per second from clicking, unbuffed
        clicksPerSecond,
        bank,
        durationMult,
        buildingSpecialMean,
        cpsMult = 1, // product of CpS buffs running now
        buffSecondsLeft = 0, // seconds until the shortest running CpS buff ends
    } = ctx;
    const base = passive + click;
    // How much of an effect lasting `seconds` overlaps the buffs running now.
    const overlap = (seconds) => 1 + (cpsMult - 1) * Math.min(1, buffSecondsLeft / seconds);
    const d = (seconds) => seconds * durationMult;
    switch (outcome) {
        case 'frenzy':
            return base * 6 * d(77) * overlap(d(77));
        case 'building special':
            return base * (buildingSpecialMean / 10) * d(30) * overlap(d(30));
        case 'click frenzy':
            return click * 776 * d(13) * overlap(d(13));
        case 'blood frenzy':
            return base * 665 * d(6) * overlap(d(6));
        case 'multiply cookies':
            return Math.min(0.15 * bank, 900 * passive * cpsMult) + 13;
        case 'cookie storm':
            // About 105 drops worth four minutes of CpS each, half of them reached.
            return passive * cpsMult * 105 * 240 * 0.5 * durationMult;
        case 'cookie storm drop':
            return passive * cpsMult * 150;
        case 'cursed finger':
            // CpS stops; each click pays the whole duration's CpS.
            return clicksPerSecond * d(10) * passive * cpsMult * d(10) - passive * cpsMult * d(10);
        case 'clot':
            return -base * 0.5 * d(66);
        case 'ruin cookies':
            return -(Math.min(0.05 * bank, 600 * passive * cpsMult) + 13);
        case 'free sugar lump':
            return Infinity;
        default:
            return 0; // blab, everything must go
    }
}

/** How long an outcome's effect lasts, for deciding whether a running buff covers it. */
const EFFECT_SECONDS = { frenzy: 77, 'building special': 30, 'click frenzy': 13, 'blood frenzy': 6 };

/**
 * @param {object} args
 * @param {{success: boolean, outcome: string}} args.next   the forecast for the next cast
 * @param {number} args.mana
 * @param {number} args.maxMana
 * @param {number} args.fateCost
 * @param {number} args.skipCost   the cheapest spell that advances the count
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

    const seconds = EFFECT_SECONDS[next.outcome];
    const stacked = (ctx.cpsMult || 1) > 1 && (!seconds || (ctx.buffSecondsLeft || 0) >= seconds * ctx.durationMult * 0.5);
    if (stacked) return out('cast', `${next.outcome} on a running ×${ctx.cpsMult.toFixed(1)} buff`);
    if (mana >= maxMana - 1) return out('cast', `${next.outcome}, mana is full`);
    return out('wait', `holding ${next.outcome} for a buff`);
}
