/**
 * Godzamok and the Golden switch. Pure: src/systems/combos.js reads the live game into these
 * inputs and makes the moves chosen here; src/core/income.js values Godzamok with comboOverBuff.
 *
 * Godzamok. Selling buildings while he is slotted grants Devastation: click power +1% per
 * building sold in the diamond slot, 0.5% in ruby, 0.25% in jade, for 10 seconds. A sale while
 * the buff runs adds to it without renewing the timer (main.js:7885-7901, buff 14077-14088). A
 * sale refunds a quarter of the price the next unit would cost (main.js:7857-7884, 7818-7824), so
 * a sale bought back at once loses about three quarters of the units' prices and leaves the
 * bakery as it was, with the buff. It pays during a click buff, when clicks are worth hundreds of
 * times more; sold and bought back again while the buff runs, the units add to it again.
 *
 * Golden switch. On, it multiplies CpS by 1.5, plus 0.1 per golden cookie upgrade with Residual
 * luck (main.js:5133-5142), and no golden cookie spawns: their timer stops (main.js:5270-5274,
 * 5673-5676). Each toggle costs an hour of the CpS of the moment, buffs included
 * (main.js:10679, 10694). The mouse upgrades add 1% of that CpS to each click (main.js:4692-4708),
 * so during a click buff the switch multiplies what clicking earns too.
 */

/** How long Devastation lasts once started (main.js:7897). */
export const DEVASTATION_SECONDS = 10;

// Per building sold, by Godzamok's slot level: diamond, ruby, jade (main.js:7891-7899).
const PER_BUILDING = [0, 0.01, 0.005, 0.0025];

const on = (value) => Number(value) > 0; // a setting missing from an old save is off

/** Click power Devastation adds per building sold, for Game.hasGod('ruin') (false when unslotted). */
export function devastationPerBuilding(level) {
    return PER_BUILDING[Number(level) || 0] || 0;
}

/**
 * Inherited combos that sell buildings and toggle the switch themselves: the 100% consistency
 * combo sells and buys buildings and turns the switch on and off (fc_spells.js:1427-1435,
 * 1449-1536, 1763-1771); the FTHOF combo sells and buys Wizard towers (fc_spells.js:1109-1151).
 */
export function inheritedCombosOn(s) {
    return on(s.auto100ConsistencyCombo) || on(s.autoFTHOFCombo);
}

/** Godzamok is played: Devastation multiplies clicks, so only while clicking. */
export function godzamokOn(s) {
    return on(s.autoGodzamok) && on(s.autoClick) && !inheritedCombosOn(s);
}

/** The Golden switch is played. */
export function goldenSwitchOn(s) {
    return on(s.autoGS) && !inheritedCombosOn(s);
}

/**
 * Sum of the prices of units lo..hi-1 of a building: its base price, discounted, grown by the
 * price increase for each unit beyond the free ones (main.js:7791-7806). Unrounded.
 * @param {{unitPrice: number, inc: number, free?: number}} b  unitPrice: the discounted base price
 */
export function priceSum(b, lo, hi) {
    lo = Math.max(0, lo);
    if (!(hi > lo)) return 0;
    const free = b.free || 0;
    let sum = 0;
    const flatEnd = Math.min(hi, free);
    if (flatEnd > lo) sum += (flatEnd - lo) * b.unitPrice;
    const from = Math.max(lo, free);
    if (hi > from) sum += (b.unitPrice * (Math.pow(b.inc, hi - free) - Math.pow(b.inc, from - free))) / (b.inc - 1);
    return sum;
}

/**
 * Cookies lost selling the top k of a building and buying them straight back. Each unit sold
 * refunds sellMult of the price the next unit would cost at the count before the sale
 * (main.js:7866-7873), so the refund runs one unit higher than the rebuy.
 * @param {{amount: number, unitPrice: number, inc: number, free?: number, sellMult: number}} b
 */
export function saleLoss(b, k) {
    if (!(k > 0)) return 0;
    const a = b.amount;
    return priceSum(b, a - k, a) - b.sellMult * priceSum(b, a - k + 1, a + 1);
}

/**
 * Each building that can be sold, cheapest Devastation first: all but `keep` of it, the loss of
 * selling those and buying them back, and that loss per unit.
 * @param {Array<{id: number, amount: number, keep: number, unitPrice: number, inc: number, free?: number, sellMult: number}>} buildings
 */
export function saleOptions(buildings) {
    const out = [];
    for (const b of buildings) {
        const sellable = b.amount - b.keep;
        if (!(sellable >= 1)) continue;
        const loss = saleLoss(b, sellable);
        out.push({ id: b.id, sellable, loss, perUnit: loss / sellable, building: b });
    }
    out.sort((x, y) => x.perUnit - y.perUnit);
    return out;
}

/**
 * The sale to make now: the buildings that give the most Devastation per cookie lost, each sold
 * whole while a unit's Devastation is worth more than its average loss, within the budget.
 *
 * Within a building the top units cost the most, so selling more of one only lowers its loss per
 * unit: a building worth selling is worth selling whole. One that does not fit the budget is
 * sold in part, top units first, as far as the budget reaches and only if that part still pays.
 *
 * @param {object} args
 * @param {Array} args.options      from saleOptions
 * @param {number} args.gainPerUnit cookies one unit sold now earns through Devastation
 * @param {number} args.budget      cookies the sale may lose
 * @returns {{sales: Array<{id: number, units: number, loss: number}>, units: number, loss: number, gain: number}}
 */
export function planSale({ options, gainPerUnit, budget }) {
    const choice = chooseSale(options, gainPerUnit, budget);
    const sales = [];
    for (let i = 0; i < choice.whole; i++) sales.push({ id: options[i].id, units: options[i].sellable, loss: options[i].loss });
    if (choice.part > 0) sales.push({ id: options[choice.whole].id, units: choice.part, loss: choice.partLoss });
    return { sales, units: choice.units, loss: choice.loss, gain: choice.units * gainPerUnit };
}

// Running totals of units and losses over the options, cheapest first: the income model plans a
// sale for every cycle of every click buff of every what-if, so a plan is two binary searches.
const prefixes = new WeakMap();
function prefixOf(options) {
    let p = prefixes.get(options);
    if (p && p.n === options.length) return p;
    p = { n: options.length, units: [0], loss: [0] };
    for (let i = 0; i < options.length; i++) {
        p.units.push(p.units[i] + options[i].sellable);
        p.loss.push(p.loss[i] + options[i].loss);
    }
    prefixes.set(options, p);
    return p;
}

/** How many options are sold whole, and how many top units of the next, for planSale. */
function chooseSale(options, gainPerUnit, budget) {
    const p = prefixOf(options);
    // Options worth selling: a prefix, since they are sorted by loss per unit.
    let lo = 0;
    let hi = options.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (options[mid].perUnit < gainPerUnit) lo = mid + 1;
        else hi = mid;
    }
    const worth = lo;
    // Of those, the prefix the budget covers whole.
    lo = 0;
    hi = worth;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (p.loss[mid] <= budget) lo = mid;
        else hi = mid - 1;
    }
    const whole = lo;
    const out = { whole, part: 0, partLoss: 0, units: p.units[whole], loss: p.loss[whole] };
    if (whole < worth) {
        // The largest top part of the next that the rest covers; the loss grows with the part.
        const option = options[whole];
        const left = budget - p.loss[whole];
        let a = 0;
        let b = option.sellable - 1;
        while (a < b) {
            const mid = Math.ceil((a + b) / 2);
            if (saleLoss(option.building, mid) <= left) a = mid;
            else b = mid - 1;
        }
        if (a > 0) {
            const l = saleLoss(option.building, a);
            if (a * gainPerUnit > l) {
                out.part = a;
                out.partLoss = l;
                out.units += a;
                out.loss += l;
            }
        }
    }
    return out;
}

/**
 * What the combo earns over one click buff, playing the policy src/systems/combos.js plays: a
 * cycle every `cycleSeconds`, each selling (and buying back) what planSale chooses for the part
 * of the Devastation window still inside the buff. The first sale starts a window; later sales
 * add to it; once it ends, the next sale starts another.
 *
 * @param {object} args
 * @param {Array} args.options        from saleOptions
 * @param {number} args.perBuilding   see devastationPerBuilding
 * @param {number} args.clickRate     cookies a second clicking earns during the buff, without Devastation
 * @param {number} args.seconds       the buff's length
 * @param {number} args.cycleSeconds  time between sales
 * @param {number} [args.budget]      cookies available at the start
 * @param {boolean} [args.accrue]     what clicking earns joins the budget as the buff runs
 * @returns {{gain: number, loss: number, cycles: number, units: number, firstAt: number|null}}
 */
export function comboOverBuff({ options, perBuilding, clickRate, seconds, cycleSeconds, budget = 0, accrue = true, windowSeconds = DEVASTATION_SECONDS }) {
    const out = { gain: 0, loss: 0, cycles: 0, units: 0, firstAt: null };
    if (!(perBuilding > 0) || !(clickRate > 0) || !(seconds > 0) || !(cycleSeconds > 0) || !options.length) return out;
    let devEnd = -Infinity;
    let devAdd = 0;
    let left = budget;
    const cycles = Math.ceil(seconds / cycleSeconds - 1e-9);
    for (let i = 0; i < cycles; i++) {
        const t = i * cycleSeconds;
        const fresh = !(t < devEnd);
        const end = fresh ? t + windowSeconds : devEnd;
        const overlap = Math.min(end, seconds) - t;
        if (overlap > 0) {
            const gainPerUnit = perBuilding * clickRate * overlap;
            const plan = chooseSale(options, gainPerUnit, left);
            if (plan.units > 0) {
                if (fresh) {
                    devEnd = end;
                    devAdd = 0;
                }
                devAdd += perBuilding * plan.units;
                out.gain += plan.units * gainPerUnit;
                out.loss += plan.loss;
                out.units += plan.units;
                out.cycles++;
                if (out.firstAt === null) out.firstAt = t;
                left -= plan.loss;
            }
        }
        if (accrue) left += clickRate * (1 + (t < devEnd ? devAdd : 0)) * cycleSeconds;
    }
    return out;
}

// --- Buffs over time ---------------------------------------------------------------------------

/**
 * Product of `key` (multCpS or multClick) over the buffs still running `t` seconds from now.
 * @param {Array<{multCpS?: number, multClick?: number, secondsLeft: number}>} buffs
 */
export function buffProduct(buffs, t, key) {
    let m = 1;
    for (const b of buffs) if (b.secondsLeft > t && b[key] !== undefined) m *= b[key];
    return m;
}

/** ∫ rate(t) dt over [0, to], for a rate that changes only when a buff ends. */
function integrate(buffs, to, rate) {
    if (!(to > 0)) return 0;
    const ends = buffs
        .map((b) => b.secondsLeft)
        .filter((s) => s > 0 && s < to)
        .sort((a, b) => a - b);
    let t = 0;
    let sum = 0;
    for (const end of ends.concat([to])) {
        if (end > t) sum += rate(t) * (end - t);
        t = end;
    }
    return sum;
}

/**
 * Cookies one more unit of Devastation sold now earns: its share of clicking for the rest of the
 * window, as the click buffs running now end.
 * @param {object} args
 * @param {number} args.perBuilding
 * @param {number} args.clickIncome   cookies a second clicking earns now, without Devastation
 * @param {Array} args.buffs          the click buffs running now, Devastation left out
 * @param {number} args.windowSeconds what is left of the Devastation window (10 s for a new one)
 */
export function devastationGainPerUnit({ perBuilding, clickIncome, buffs, windowSeconds }) {
    const now = buffProduct(buffs, 0, 'multClick');
    if (!(perBuilding > 0) || !(clickIncome > 0) || !(now > 0)) return 0;
    return perBuilding * clickIncome * integrate(buffs, windowSeconds, (t) => buffProduct(buffs, t, 'multClick') / now);
}

// --- Golden switch -----------------------------------------------------------------------------

/**
 * The best moment to turn the switch off, of now and each moment a running buff ends, and what
 * keeping it on until then is worth, net of the price then and the golden cookies missed.
 *
 * All amounts are per unbuffed second: the running buffs scale them as they run, which is exact
 * for the price (cookiesPs × 3600, main.js:10694) and for the switch's share of CpS, and for its
 * share of clicks through the mouse upgrades (main.js:4692-4708, 4732-4740).
 *
 * @param {object} args
 * @param {number} args.deltaCps        CpS the switch adds, unbuffed
 * @param {number} args.deltaClick      cookies per click it adds, unbuffed
 * @param {number} args.clicksPerSecond
 * @param {number} args.priceOffBase    the price of turning it off with no buff running
 * @param {number} args.goldenRate      cookies a second golden cookies earn, which stop while it is on
 * @param {Array<{multCpS?: number, multClick?: number, secondsLeft: number}>} args.buffs
 * @returns {{offAt: number, value: number, gain: number, priceOff: number}}
 */
export function offPlan({ deltaCps, deltaClick, clicksPerSecond, priceOffBase, goldenRate, buffs }) {
    const cps = (t) => buffProduct(buffs, t, 'multCpS');
    const rate = (t) => cps(t) * (deltaCps + clicksPerSecond * deltaClick * buffProduct(buffs, t, 'multClick'));
    const moments = [0, ...new Set(buffs.map((b) => b.secondsLeft).filter((s) => s > 0))].sort((a, b) => a - b);
    let best = null;
    for (const t of moments) {
        const gain = integrate(buffs, t, rate);
        const priceOff = priceOffBase * cps(t);
        const value = gain - priceOff - goldenRate * t;
        if (!best || value > best.value) best = { offAt: t, value, gain, priceOff };
    }
    return best;
}

/**
 * Whether to turn the switch on now, to turn it off at the best moment (see offPlan): worth it
 * when what it adds until then beats both toggles and the golden cookies missed.
 * @param {object} args  as offPlan, and priceOn: the price of turning it on now
 * @returns {{value: number, offAt: number, gain: number, cost: number, priceOff: number}}
 */
export function switchPlan(args) {
    const off = offPlan(args);
    return {
        value: off.value - args.priceOn,
        offAt: off.offAt,
        gain: off.gain,
        priceOff: off.priceOff,
        cost: args.priceOn + off.priceOff + args.goldenRate * off.offAt,
    };
}

/**
 * The buffs as the switch will see them while the combo keeps selling for Godzamok. Devastation
 * lasts 10 s from a window's first sale and is not renewed by later ones (main.js:7889-7897),
 * but the combo starts a new window as soon as one ends, for as long as the click buff runs: the
 * switch's share of clicks stays multiplied through the gaps. Without this the switch plan saw a
 * window's end as the end of the gain, turned the switch off there and on again a tick later,
 * paying both toggles each window. A new window starts at about the level its first sale gives
 * (later sales in a window add to it, and the next starts over), so the running window keeps its
 * own level until it ends and `freshMult` is assumed after, until `spikeEnd`.
 * @param {Array<{type?: string, multClick?: number, secondsLeft: number}>} buffs  the running buffs
 * @param {number} freshMult  Devastation's multiplier after a window's first sale in this click
 *   buff; 1 (or less) while no sale has been made, when the buffs are returned as they are
 * @param {number} spikeEnd   seconds until the last running click buff ends
 */
export function renewedDevastation(buffs, freshMult, spikeEnd) {
    if (!(freshMult > 1) || !(spikeEnd > 0)) return buffs;
    const dev = buffs.find((b) => b.type === 'devastation');
    if (dev && dev.secondsLeft >= spikeEnd) return buffs;
    // Never above the running window's level: a lower one means the budget has run short.
    const level = dev ? Math.min(freshMult, dev.multClick) : freshMult;
    const renewed = { name: 'Devastation (renewed)', type: 'devastation renewed', multCpS: 1, multClick: level, secondsLeft: spikeEnd };
    if (!dev) return [...buffs, renewed];
    // The running window's own level until it ends: its multiplier over the renewed one's.
    return [...buffs.map((b) => (b === dev ? { ...dev, multClick: dev.multClick / level } : b)), renewed];
}

/** A switch left on stays on while it out-earns the golden cookies it stops. */
export function keepStanding({ incomeOn, incomeOff }) {
    return incomeOn > incomeOff;
}

/**
 * The switch is turned on for good when what it adds repays both toggles within the horizon:
 * the way back is paid for too, since the next ascension or a change of bakery may call for it.
 * Compared as a payback time, never as added × horizon (0 × Infinity is NaN).
 */
export function turnOnStanding({ incomeOn, incomeOff, priceOn, priceOff, horizonSeconds }) {
    const added = incomeOn - incomeOff;
    return added > 0 && (priceOn + priceOff) / added <= horizonSeconds;
}
