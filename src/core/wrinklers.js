/**
 * Wrinklers: when popping one is worth it, what the wrinklers add to income, and when a season
 * hunt pays. Pure; src/game/wrinklers.js reads the game into these arguments.
 *
 * How the game runs them (main.js, v2.053):
 * - An empty slot spawns with a chance per frame (14361-14373); the wrinkler then crawls for
 *   10 s (14381) before it attaches and starts to feed.
 * - With `s` attached, each withers `suck` of CpS (5%, 5124-5128), so the bank gets
 *   (1 - s·suck) of CpS and every attached wrinkler stores the whole withered s·suck·CpS
 *   (14393). Popping one pays what it stored times its pop multiplier (14467-14479).
 * - So with every wrinkler fed, income is f(s) = 1 - s·suck + s·suck·ΣP times CpS: 6.0 at 10
 *   attached, 5.005 at 9. Popping one gives its store now and leaves its slot empty until the
 *   next spawn plus the crawl, which is the only thing a pop costs.
 */

/** Seconds a new wrinkler crawls before it attaches: close grows 1/(10·fps) a frame (main.js:14381). */
export const CRAWL_SECONDS = 10;

const HALLOWEEN_DROPS = ['Skull cookies', 'Ghost cookies', 'Bat cookies', 'Slime cookies', 'Pumpkin cookies', 'Eyeball cookies', 'Spider cookies'];

/** Skruuia (god 'scorn') by slot: diamond, ruby, jade. */
const SCORN_PAYOUT = [1, 1.15, 1.1, 1.05]; // main.js:14476-14478
const SCORN_SPAWN = [1, 2.5, 2, 1.5]; // main.js:14369-14371
/** Selebrak (god 'seasons') by slot, on drop fail rates (main.js:14495-14497, 10439-10441). */
const SELEBRAK_FAIL = [1, 0.9, 0.95, 0.97];

/** What a wrinkler pays per cookie stored when it pops (main.js:14467-14479). */
export function popMultiplier({ sacrilegious = false, wrinklerspawn = false, dragonGuts = 0, scorn = 0, shiny = false } = {}) {
    let m = 1.1;
    if (sacrilegious) m *= 1.05;
    m *= 1 + dragonGuts * 0.2;
    if (shiny) m *= 3;
    if (wrinklerspawn) m *= 1.05;
    m *= SCORN_PAYOUT[scorn] || 1;
    return m;
}

/** Share of CpS each attached wrinkler withers (main.js:5124-5126). */
export function suckRate({ wrinklerEat = 1, dragonGuts = 0 } = {}) {
    return 0.05 * wrinklerEat * (1 + dragonGuts * 0.2);
}

/** Chance each frame that an empty slot spawns a wrinkler (main.js:14361-14373). */
export function spawnChance({ elderWrath = 0, wrinklerSpawn = 1, unholyBait = false, scorn = 0, doormat = false } = {}) {
    if (!(elderWrath > 0)) return 0;
    if (doormat) return 0.1;
    let chance = 0.00001 * elderWrath * wrinklerSpawn;
    if (unholyBait) chance *= 5;
    chance *= SCORN_SPAWN[scorn] || 1;
    return chance;
}

/**
 * Income as a multiple of CpS with `attached` wrinklers feeding, counting what they store as
 * earned. `payoutSum` is the sum of their pop multipliers (a shiny counts three times).
 */
export function incomeMultiplier({ attached, suck, payoutSum }) {
    if (!(attached > 0)) return 1;
    const withered = Math.min(1, attached * suck); // main.js:5128
    return 1 - withered + withered * payoutSum;
}

/**
 * Expected feeding lost by popping `count` ordinary wrinklers now, in cookies.
 *
 * Each emptied slot is empty for the crawl plus an exponential wait (rate λ, the spawn chance per
 * second), independently of the others. With J(t) slots still empty, income is f(s - J) instead
 * of f(s). For t past the crawl J is binomial(count, e^{-λt}), and ∫ P(J = m) dt = 1/(mλ) for
 * m ≥ 1, so the loss is exact: crawl·[f(s) - f(s-count)] + Σ_m [f(s) - f(s-m)] / (mλ).
 */
export function gapCost({ attached, count, suck, payoutSum, popMult, cps, spawnPerSecond, crawl = CRAWL_SECONDS }) {
    if (!(count > 0)) return 0;
    const f = (m) => incomeMultiplier({ attached: attached - m, suck, payoutSum: payoutSum - m * popMult });
    const full = f(0);
    if (!(spawnPerSecond > 0)) return Infinity;
    let loss = crawl * (full - f(count));
    for (let m = 1; m <= count; m++) loss += (full - f(m)) / (m * spawnPerSecond);
    return cps * loss;
}

/**
 * Which wrinklers to pop now so the next purchase is bought sooner.
 *
 * Plans are "pop the j fattest as soon as they, with the bank, cover the purchase". Waiting,
 * the bank grows at the liquid income and each attached wrinkler's payout at
 * cps·min(1, s·suck)·popMult, so the j fattest cover it after τ_j = (need - S_j) / (liquid + j·g);
 * with none popped the bank alone covers it after τ_0 = need / liquid. A plan is worth the income
 * the purchase adds over the time it saves, deltaIncome·(τ_0 - τ_j), less the feeding its pops
 * lose. The best plan is taken only when it is due now; otherwise it waits, since a wrinkler
 * that grows into the need later costs fewer gaps than several popped today.
 *
 * @param {object} args
 * @param {Array<{id: number, payout: number, shiny?: boolean}>} args.candidates  attached wrinklers
 * @param {number} args.attached      wrinklers attached, shinies included
 * @param {number} args.payoutSum     sum of the attached wrinklers' pop multipliers
 * @param {number} args.popMult       an ordinary wrinkler's pop multiplier
 * @param {number} args.suck          share of CpS each attached wrinkler withers
 * @param {number} args.cps           CpS without buffs
 * @param {number} args.bank
 * @param {number} args.price         the next purchase
 * @param {number} args.reserve       what the buyer holds back
 * @param {number} args.deltaIncome   what the next purchase adds to income
 * @param {number} args.liquidIncome  what reaches the bank a second without popping
 * @param {number} args.spawnPerSecond  spawn chance of an empty slot, per second
 * @param {number} [args.crawl]
 * @param {number} [args.maxWait]     longest wait worth counting, seconds
 * @returns {{pop: number[], reason: string, need?: number, plan?: object}}
 */
export function decidePops(args) {
    const { candidates, bank, price, reserve = 0, deltaIncome, liquidIncome, cps, maxWait = 86400 } = args;
    if (!Number.isFinite(price) || !(deltaIncome > 0)) return { pop: [], reason: 'nothing to buy' };
    const need = price + reserve - bank;
    if (need <= 0) return { pop: [], reason: 'affordable', need };

    // A shiny stores three times as much as the wrinkler that would replace it; it is kept.
    const fattest = candidates.filter((c) => !c.shiny && c.payout > 0).sort((a, b) => b.payout - a.payout);
    if (!fattest.length) return { pop: [], reason: 'no wrinklers', need };

    const growth = cps * Math.min(1, args.attached * args.suck) * args.popMult;
    const wait = (covered, rate) => Math.min(maxWait, rate > 0 ? Math.max(0, need - covered) / rate : covered >= need ? 0 : Infinity);
    const alone = wait(0, liquidIncome);

    let best = { count: 0, wait: alone, value: 0 };
    let covered = 0;
    for (let j = 1; j <= fattest.length; j++) {
        covered += fattest[j - 1].payout;
        const due = wait(covered, liquidIncome + j * growth);
        const value = deltaIncome * (alone - due) - gapCost({ ...args, count: j });
        if (value > best.value) best = { count: j, wait: due, value };
        if (due === 0) break; // popping more than covers the need only adds gaps
    }
    if (best.count === 0) return { pop: [], reason: 'not worth a gap', need, plan: best };
    if (best.wait > 0) return { pop: [], reason: 'waiting', need, plan: best };
    return { pop: fattest.slice(0, best.count).map((c) => c.id), reason: 'buys sooner', need, plan: best };
}

/**
 * Wrinklers attached on average over the next `horizon` seconds: the count the income model
 * should assume under a popping policy.
 *
 * In the steady state, pops at `popRate` a second leave popRate·(crawl + 1/λ) slots empty on
 * average (Little's law). From `now` attached, the count moves to that steady state at the
 * refill rate λ; averaged over the horizon, a slow refill (wrath 1 without Unholy bait: about 55
 * minutes a slot) keeps the first hours well under the maximum.
 */
export function expectedAttached({ max, now, popRate = 0, spawnPerSecond, crawl = CRAWL_SECONDS, horizon = 3600 }) {
    const current = Math.max(0, Math.min(max, now));
    if (!(spawnPerSecond > 0)) return current;
    const steady = Math.max(0, Math.min(max, max - popRate * (crawl + 1 / spawnPerSecond)));
    const x = spawnPerSecond * horizon;
    const remaining = Number.isFinite(x) && x > 0 ? (1 - Math.exp(-x)) / x : 0;
    return steady + (current - steady) * remaining;
}

/** Halloween cookie fail rate per pop (main.js:14488-14499). */
export function halloweenFailRate({ spooky = false, starterror = false, dropRateMult = 1, selebrak = 0, shiny = false } = {}) {
    let fail = spooky ? 0.8 : 0.95;
    if (starterror) fail *= 0.9;
    fail /= dropRateMult;
    fail *= SELEBRAK_FAIL[selebrak] || 1;
    if (shiny) fail *= 0.9;
    return fail;
}

/** Chance per pop of each Halloween cookie not yet found: one of seven, uniformly (main.js:14500-14507). */
export function halloweenDrops({ failRate, owned = [] }) {
    const have = new Set(owned);
    const chance = Math.max(0, 1 - failRate) / HALLOWEEN_DROPS.length;
    return HALLOWEEN_DROPS.filter((name) => !have.has(name)).map((name) => ({ name, chance }));
}

/** Easter egg fail rate per pop (Game.DropEgg(0.98), main.js:10430-10442, 14510). */
export function easterFailRate({ dropRateMult = 1, hideAndSeek = false, omelette = false, starspawn = false, selebrak = 0 } = {}) {
    let fail = 0.98 / dropRateMult;
    if (hideAndSeek) fail *= 0.7;
    if (omelette) fail *= 0.9;
    if (starspawn) fail *= 0.9;
    fail *= SELEBRAK_FAIL[selebrak] || 1;
    return fail;
}

/**
 * Chance per pop of each egg not yet found. A success draws a rare egg a tenth of the time and a
 * common one otherwise, uniformly; an egg already owned is redrawn once (main.js:10443-10452).
 */
export function easterDrops({ failRate, owned = [], eggs, rareEggs }) {
    const have = new Set(owned);
    const draw = new Map();
    for (const name of eggs) draw.set(name, 0.9 / eggs.length);
    for (const name of rareEggs) draw.set(name, (draw.get(name) || 0) + 0.1 / rareEggs.length);
    let ownedFirst = 0;
    for (const [name, p] of draw) if (have.has(name)) ownedFirst += p;
    const success = Math.max(0, 1 - failRate);
    const out = [];
    for (const [name, p] of draw) if (!have.has(name)) out.push({ name, chance: success * (p + ownedFirst * p) });
    return out;
}

/**
 * Whether popping for drops pays: each slot popped as soon as it attaches cycles every
 * crawl + 1/λ seconds, and each pop is worth the drops it may bring; against that, income falls
 * from `normalMultiplier` to `huntMultiplier` times CpS while the hunt runs.
 *
 * @param {object} args
 * @param {Array<{name: string, chance: number}>} args.drops  chance per pop of each drop not yet found
 * @param {number | ((name: string) => number)} args.value    cookies a new drop is worth
 */
export function huntDecision({ drops, value, slots, spawnPerSecond, cps, normalMultiplier, huntMultiplier = 1, crawl = CRAWL_SECONDS }) {
    const valueOf = typeof value === 'function' ? value : () => value;
    const perPop = drops.reduce((sum, d) => sum + d.chance * (Number(valueOf(d.name)) || 0), 0);
    const popsPerSecond = spawnPerSecond > 0 ? slots / (crawl + 1 / spawnPerSecond) : 0;
    const gain = popsPerSecond * perPop;
    const cost = cps * Math.max(0, normalMultiplier - huntMultiplier);
    return { hunt: gain > 0 && gain > cost, gain, cost, perPop, popsPerSecond };
}
