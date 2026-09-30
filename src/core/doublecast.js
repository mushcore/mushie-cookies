/**
 * Double-casting Force the Hand of Fate. Pure.
 *
 * Two casts cost more than a full bar: 10 + 60% of max magic each (minigameGrimoire.js:339-345).
 * Max magic comes from the Wizard tower count (263-267) and current magic is cut down to it
 * (286, 488), so selling towers after the first cast lowers the second cast's price to what the
 * mana left can pay. The towers are bought back straight after, at the price they were sold at
 * four times over (a sale refunds 25%, main.js:7818-7824, 7857-7868).
 *
 * That pays when the second outcome is worth much more on the first one's buff than on its own
 * later (a click frenzy on a frenzy is worth seven of it), by more than the towers' round trip
 * and the mana the second cast takes from the casts after it.
 */
import { outcomeValue, afterOutcome } from './grimoire.js';

/** Max magic with `towers` Wizard towers at `level` (minigameGrimoire.js:263-267). */
export function magicMax(towers, level) {
    const t = Math.max(towers, 1);
    const l = Math.max(level, 1);
    return Math.floor(4 + Math.pow(t, 0.6) + Math.log((t + (l - 1) * 10) / 15 + 1) * 15);
}

/**
 * What a spell costs at `maxMagic` (minigameGrimoire.js:339-345).
 * @param {{costMin: number, costPercent?: number}} spell
 * @param {number} maxMagic
 * @param {number} [intellect=0]  auraMult('Supreme Intellect')
 */
export function spellCost(spell, maxMagic, intellect = 0) {
    return Math.floor((spell.costMin + (spell.costPercent ? maxMagic * spell.costPercent : 0)) * (1 - 0.1 * intellect));
}

/**
 * Seconds to regenerate from `from` to `to` magic with `maxMagic` max: each frame adds
 * max(0.002, √(magic / max(maxMagic, 100))) × 0.002, 30 frames a second (minigameGrimoire.js:486-488).
 */
export function regenSeconds(from, to, maxMagic) {
    if (!(to > from)) return 0;
    const scale = Math.max(maxMagic, 100);
    const perSecond = 0.002 * 30;
    // Below this the per-frame gain is the flat minimum.
    const slow = 0.002 * 0.002 * scale;
    let a = Math.max(0, from);
    let seconds = 0;
    if (a < slow) {
        const b = Math.min(to, slow);
        seconds += (b - a) / (0.002 * perSecond);
        a = b;
    }
    if (to > a) seconds += (2 * Math.sqrt(scale) * (Math.sqrt(to) - Math.sqrt(a))) / perSecond;
    return seconds;
}

/**
 * The fewest Wizard towers to sell so the second cast is affordable with the magic the first
 * one leaves. Current magic is cut to the new max (minigameGrimoire.js:286), so the spell must
 * fit both.
 * @param {object} args
 * @param {number} args.towers     owned now
 * @param {number} args.level      the Wizard tower level
 * @param {number} args.left       magic left after the first cast
 * @param {object} args.spell      {costMin, costPercent}
 * @param {number} [args.intellect=0]
 * @returns {{keep: number, sell: number, maxMagic: number, cost: number} | null}
 */
export function planSale({ towers, level, left, spell, intellect = 0 }) {
    // Max magic only falls as towers go, so the first count that fits keeps the most.
    for (let keep = towers; keep >= 0; keep--) {
        const maxMagic = magicMax(keep, level);
        const cost = spellCost(spell, maxMagic, intellect);
        if (cost <= Math.min(left, maxMagic)) return { keep, sell: towers - keep, maxMagic, cost };
    }
    return null;
}

/**
 * The chance of each outcome of a cast not yet forecast, enumerating the draws of
 * minigameGrimoire.js:48-76.
 * @param {object} at
 * @param {number} at.failChance
 * @param {boolean} [at.dragonflight=false]  no click frenzy while it runs (:53)
 * @param {number} [at.buildingsOwned=Infinity]  a building special needs 10 (:55)
 * @returns {{[outcome: string]: number}}
 */
export function fateOdds({ failChance, dragonflight = false, buildingsOwned = Infinity }) {
    const odds = {};
    const add = (choices, p) => {
        for (const c of choices) odds[c] = (odds[c] || 0) + p / choices.length;
    };
    const success = Math.min(1, Math.max(0, 1 - failChance));
    const special = buildingsOwned >= 10 ? 0.25 : 0;
    for (const [storm, pStorm] of [[true, 0.1], [false, 0.9]]) {
        for (const [building, pBuilding] of [[true, special], [false, 1 - special]]) {
            for (const [drop, pDrop] of [[true, 0.15], [false, 0.85]]) {
                for (const [lump, pLump] of [[true, 0.0001], [false, 0.9999]]) {
                    const p = success * pStorm * pBuilding * pDrop * pLump;
                    if (!p) continue;
                    let choices = ['frenzy', 'multiply cookies'];
                    if (!dragonflight) choices.push('click frenzy');
                    if (storm) choices.push('cookie storm', 'cookie storm', 'blab');
                    if (building) choices.push('building special');
                    if (drop) choices = ['cookie storm drop'];
                    if (lump) choices.push('free sugar lump');
                    add(choices, p);
                }
            }
        }
    }
    for (const [cursed, pCursed] of [[true, 0.1], [false, 0.9]]) {
        for (const [lump, pLump] of [[true, 0.003], [false, 0.997]]) {
            for (const [blab, pBlab] of [[true, 0.1], [false, 0.9]]) {
                const p = (1 - success) * pCursed * pLump * pBlab;
                if (!p) continue;
                let choices = ['clot', 'ruin cookies'];
                if (cursed) choices.push('cursed finger', 'blood frenzy');
                if (lump) choices.push('free sugar lump');
                if (blab) choices = ['blab'];
                add(choices, p);
            }
        }
    }
    return odds;
}

/** What a cast is worth on average, landing on nothing: bad outcomes are skipped, so a cast is always a good one. */
function castWorth(odds, ctx) {
    const quiet = { ...ctx, buffs: [] };
    let weight = 0;
    let sum = 0;
    for (const [outcome, p] of Object.entries(odds)) {
        const value = outcomeValue(outcome, quiet);
        if (!(value > 0) || !Number.isFinite(value)) continue;
        weight += p;
        sum += p * value;
    }
    return weight ? sum / weight : 0;
}

/**
 * Whether to double-cast now, once the forecast casting has decided to cast the first outcome.
 *
 * The double cast is weighed against casting the first outcome alone and the second on its own
 * later, landing on nothing: the difference is the second outcome's worth on the first one's
 * buff less its worth later, less the towers' round trip, less the delay the spent mana puts on
 * every cast after it. That delay is counted at what a cast is worth on average.
 *
 * @param {object} args
 * @param {{success: boolean, outcome: string}} args.first    the next cast
 * @param {{success: boolean, outcome: string}} args.second   the cast after it, forecast with the
 *        conditions it will be cast under (the golden cookies on screen, the buildings left)
 * @param {object} args.ctx          the context now (see outcomeValue)
 * @param {object} [args.ctxSecond]  the context for the second cast, before the first lands:
 *        building specials with the towers left after the sale, the bank with the refund
 * @param {object} args.odds         fateOdds now, for the worth of casts not yet forecast
 * @param {{now: number, max: number, costFirst: number}} args.mana
 * @param {object | null} args.sale  planSale for the magic the first cast leaves
 * @param {number} args.rebuyLoss    cookies lost buying back what the sale sells
 * @param {number} args.spendable    cookies above what the buyer is holding
 * @returns {{action: 'double'|'single', reason: string, gain: number, stacked: number, later: number, penalty: number, short: number}}
 *          `short`: cookies the bank lacks for a double cast that would otherwise pay
 */
export function decideDouble({ first, second, ctx, ctxSecond = ctx, odds, mana, sale, rebuyLoss, spendable }) {
    const out = (action, reason, numbers = {}) => ({ action, reason, gain: -Infinity, stacked: 0, later: 0, penalty: 0, short: 0, ...numbers });
    if (!sale) return out('single', 'no tower count leaves the second cast affordable');

    // The second outcome on the first one's buff, and on its own later (a bad outcome is skipped
    // then, so it is worth nothing rather than less). The first lands before the sale, the second
    // after it: its building specials and the refund in the bank are the sale's.
    const refund = ctxSecond.bank - ctx.bank;
    const stacked = afterOutcome(first.outcome, ctx).reduce(
        (sum, p) => sum + p.weight * outcomeValue(second.outcome, { ...p.ctx, buildingSpecials: ctxSecond.buildingSpecials, bank: p.ctx.bank + refund }),
        0
    );
    const later = Math.max(0, outcomeValue(second.outcome, { ...ctx, buffs: [] }));
    if (!Number.isFinite(stacked) || !Number.isFinite(later) || !Number.isFinite(outcomeValue(first.outcome, ctx))) {
        return out('single', 'a sugar lump is cast on its own');
    }

    // Mana: alone, the first cast leaves `alone`, the second is cast once the bar is full again and
    // leaves what a full-bar cast leaves; doubled, both leave `after`. From then on the two paths
    // cast alike, the doubled one later by `delay`.
    const alone = mana.now - mana.costFirst;
    const cycle = mana.max - mana.costFirst;
    const after = Math.min(alone, sale.maxMagic) - sale.cost;
    const refill = (from) => regenSeconds(from, mana.max, mana.max);
    const delay = refill(after) - refill(alone) - refill(cycle);
    const penalty = refill(cycle) > 0 ? (castWorth(odds, ctx) * Math.max(0, delay)) / refill(cycle) : 0;

    const gain = stacked - later - rebuyLoss - penalty;
    const numbers = { gain, stacked, later, penalty };
    const pair = `${second.outcome} on ${first.outcome}`;
    if (!(gain > 0)) return out('single', `${pair} adds less than the towers and mana cost`, numbers);
    if (rebuyLoss > spendable) {
        return out('single', `buying the towers back for ${pair} would spend the buyer's reserve`, { ...numbers, short: rebuyLoss - spendable });
    }
    return out('double', `${pair}, selling ${sale.sell} Wizard towers`, numbers);
}
