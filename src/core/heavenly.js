/**
 * Spending heavenly chips. Pure.
 *
 * Chips do not accrue while ascended, so there is no wait to price in: each purchase is worth the
 * share of income it adds per chip, and the ranking is that ratio.
 *
 * Many heavenly upgrades add nothing by themselves and are there to reach others: Stevia
 * Caelestis only ripens lumps sooner but leads to Sugar baking; the angels only pay while the game
 * is closed but lead to Kitten angels and the Synergies; Residual luck leads to Pet the dragon and
 * Fortune cookies. So what is ranked is a bundle: an upgrade together with every ancestor it still
 * needs, priced at their sum and valued at what they add together. A parent worth nothing is
 * bought as soon as the best bundle through it pays per chip, and always before its child.
 */

/**
 * Fallback shares, only for effects the income model cannot see and no what-if can show. Every
 * other upgrade is measured: directly, or by the store upgrades and drops it opens
 * (src/game/prestige.js).
 */
export const ENABLER_SHARE = {
    Legacy: 1000, // nothing else in the tree is reachable without it
    // The dragon's auras come from training it, a system of its own rather than a purchase.
    'How to bake your dragon': 0.5,
    // The switch is worth something only to a system that turns it on during click buffs
    // (spec 4.12). What hangs off it (Residual luck, then Pet the dragon and Fortune cookies) is
    // valued through the bundles that pass through it, so it is never locked out by this number.
    'Golden switch': 0.2,
    // Research (the grandmapocalypse line) goes ten times as fast; the model has no research clock.
    'Persistent memory': 0.1,
    // Starter kits save rebuilding, and discounts make buildings and upgrades cheaper; the income
    // model prices neither.
    'Starter kit': 0.02,
    'Starter kitchen': 0.02,
    'Divine discount': 0.02,
    'Divine sales': 0.02,
    'Divine bakeries': 0.02,
    'Five-finger discount': 0.02,
    // Wrinklers appear faster; the model already assumes the most wrinklers.
    'Unholy bait': 0.01,
    // Offline production: worth something to a player who closes the game; the model has no
    // closed time.
    'Twin Gates of Transcendence': 0.02,
    Belphegor: 0.02,
    Mammon: 0.02,
    Abaddon: 0.02,
    Satan: 0.02,
    Asmodeus: 0.02,
    Beelzebub: 0.02,
    Lucifer: 0.02,
};

/**
 * @param {object} args
 * @param {Array<{id, name, price, members?: string[], extra?: number}>} args.candidates
 *        `members`: names of every upgrade in the bundle (default: the candidate alone);
 *        `extra`: share measured outside the income model (lumps, slots, season drops)
 * @param {Array<{total: number}>} args.measured  income after each candidate, aligned
 * @param {{total: number}} args.income           income now
 * @returns candidates with `share` (relative income gain) and `valuePerChip`, best first
 */
export function rankHeavenly({ candidates, measured, income }) {
    const ranked = candidates.map((candidate, i) => {
        const measuredShare = income.total > 0 ? (measured[i].total - income.total) / income.total : 0;
        const members = candidate.members || [candidate.name];
        const fixed = members.reduce((sum, name) => sum + (ENABLER_SHARE[name] || 0), 0);
        const share = measuredShare + fixed + (candidate.extra || 0);
        return { ...candidate, share, valuePerChip: valuePerChip(share, candidate.price) };
    });
    ranked.sort(byValue);
    return ranked;
}

function valuePerChip(share, price) {
    return price > 0 ? share / price : share > 0 ? Infinity : 0;
}

function byValue(a, b) {
    return b.valuePerChip - a.valuePerChip || a.price - b.price;
}

/**
 * Walks the ranking and buys what the chips cover. An item the chips do not cover is saved for
 * when it is far better per chip than anything affordable after it; otherwise it is skipped.
 *
 * @param {object} args
 * @param {Array<{id, name, price, valuePerChip}>} args.ranked
 * @param {number} args.chips
 * @param {number} [args.saveFactor=3]  how much better per chip an unaffordable item must be to wait for
 * @returns {{buy: Array, saving: {id, name, price} | null, left: number}}
 */
export function planChips({ ranked, chips, saveFactor = 3 }) {
    const buy = [];
    let left = chips;
    let saving = null;
    for (let i = 0; i < ranked.length; i++) {
        const item = ranked[i];
        if (!(item.valuePerChip > 0)) break;
        if (item.price <= left) {
            buy.push(item);
            left -= item.price;
            continue;
        }
        if (saving) continue;
        const bestAffordableAfter = ranked.slice(i + 1).find((c) => c.price <= left && c.valuePerChip > 0);
        if (!bestAffordableAfter || item.valuePerChip >= saveFactor * bestAffordableAfter.valuePerChip) {
            saving = item;
            break;
        }
    }
    return { buy, saving, left };
}

/**
 * The upgrades buying `target` takes: every ancestor not yet owned or planned, then the target,
 * parents always before children (the game only sells an upgrade whose parents are owned,
 * main.js:4292-4301), each once.
 *
 * @param {{id, parents: Array}} target
 * @param {Map} byId       node by id
 * @param {Set} planned    ids already planned
 */
export function closure(target, byId, planned) {
    const out = [];
    const seen = new Set();
    const visit = (node) => {
        if (!node || seen.has(node.id) || node.owned || planned.has(node.id)) return;
        seen.add(node.id);
        for (const parent of node.parents) visit(byId.get(parent));
        out.push(node);
    };
    visit(target);
    return out;
}

/**
 * Plans the chips one bundle at a time, re-valuing after each so that every choice sees the ones
 * before it (a bought parent makes its children cheaper to reach; a multiplier changes shares).
 *
 * @param {object} args
 * @param {Array<{id, name, price, parents: Array, owned: boolean, shown: boolean}>} args.tree
 *        every heavenly upgrade; `shown`: the game would offer it at the coming prestige
 * @param {number} args.chips
 * @param {(planned: Set, bundles: Array<{id, name, members, price}>) => number[]} args.value
 *        share of income each bundle adds on top of what is planned
 * @param {number} [args.saveFactor=3]
 * @param {number} [args.reach=4]      bundles dearer than this many times the chips left are not valued
 * @param {number} [args.maxSteps=60]
 * @returns {{buy: Array<{id, name, price, share, for}>, saving: {name, price} | null, left: number}}
 */
export function planTree({ tree, chips, value, saveFactor = 3, reach = 4, maxSteps = 60 }) {
    const byId = new Map(tree.map((n) => [n.id, n]));
    const planned = new Set();
    const buy = [];
    let left = chips;
    let saving = null;
    for (let step = 0; step < maxSteps; step++) {
        const bundles = [];
        for (const node of tree) {
            if (node.owned || planned.has(node.id)) continue;
            const members = closure(node, byId, planned);
            // An ancestor the game would not show blocks every bundle through it.
            if (members.some((m) => !m.shown)) continue;
            const price = members.reduce((sum, m) => sum + m.price, 0);
            if (!(price <= left * reach)) continue;
            bundles.push({ id: node.id, name: node.name, members, price });
        }
        if (!bundles.length) break;
        const shares = value(planned, bundles);
        const ranked = bundles.map((b, i) => ({ ...b, share: shares[i], valuePerChip: valuePerChip(shares[i], b.price) }));
        ranked.sort(byValue);
        const plan = planChips({ ranked, chips: left, saveFactor });
        saving = plan.saving ? { name: plan.saving.name, price: plan.saving.price } : null;
        if (!plan.buy.length) break;
        const next = plan.buy[0];
        for (const m of next.members) {
            planned.add(m.id);
            buy.push({ id: m.id, name: m.name, price: m.price, share: m.id === next.id ? next.share : 0, for: next.name });
        }
        left -= next.price;
    }
    return { buy, saving, left };
}

// Sugar lumps (main.js:4412-4539). The Autopilot harvests at ripe, where a harvest always pays
// (a mature one pays half the time, main.js:4474), so lumps come once per ripening time.

/** Chance of each lump type per roll, and what a harvest of it pays on average (main.js:4485-4506). */
function typeRoll(loops, sucralosia, elderWrath) {
    const events = [
        [1, sucralosia ? 0.15 : 0.1], // bifurcated
        [2, 3 / 1000], // golden
        [3, 0.1 * elderWrath], // meaty
        [4, 1 / 50], // caramelized
    ];
    // Each roll pushes each type independently; the lump is a uniform pick of the list.
    let states = [{ list: [0], p: 1 }];
    for (let i = 0; i < loops; i++) {
        for (const [type, p] of events) {
            const next = [];
            for (const s of states) {
                if (p > 0) next.push({ list: s.list.concat(type), p: s.p * Math.min(1, p) });
                if (p < 1) next.push({ list: s.list, p: s.p * (1 - p) });
            }
            states = next;
        }
    }
    const chance = [0, 0, 0, 0, 0];
    for (const s of states) for (const type of s.list) chance[type] += s.p / s.list.length;
    return chance;
}

/**
 * Mean lumps from one ripe harvest.
 * @param {object} args
 * @param {boolean} [args.sucralosia]  Sucralosia Inutilis owned
 * @param {number} [args.elderWrath]   grandmapocalypse stage (meaty lumps)
 * @param {number} [args.curve]        Dragon's Curve aura strength: 1 + curve rolls, floored at random
 */
export function lumpsPerHarvest({ sucralosia = false, elderWrath = 0, curve = 0 } = {}) {
    const loops = 1 + Math.max(0, curve);
    const low = Math.floor(loops);
    const frac = loops - low;
    const yieldOf = (chance) => {
        // Sucralosia makes 5% of bifurcated lumps give 2 outright, the rest 1 or 2.
        const bifurcated = sucralosia ? 0.05 * 2 + 0.95 * 1.5 : 1.5;
        return chance[0] * 1 + chance[1] * bifurcated + chance[2] * 4.5 + chance[3] * 1 + chance[4] * 2;
    };
    const atLow = yieldOf(typeRoll(low, sucralosia, elderWrath));
    return frac > 1e-9 ? atLow * (1 - frac) + yieldOf(typeRoll(low + 1, sucralosia, elderWrath)) * frac : atLow;
}

/** Lumps a day when each is harvested as it ripens. */
export function lumpsPerDay({ ripeMs, ...type }) {
    return ripeMs > 0 ? (86400000 / ripeMs) * lumpsPerHarvest(type) : 0;
}

/**
 * Share of income one more lump is worth. With Sugar baking, each lump held under 100 adds 1% on a
 * multiplier of 1 + lumps/100 (main.js:5095). Otherwise it goes to the best building level: a level
 * costs level + 1 lumps and adds 1% of that building's output (main.js:5058, core/lumps.js).
 *
 * @param {object} args
 * @param {number} args.lumps
 * @param {boolean} args.sugarBaking
 * @param {Array<{level: number, amount: number, share: number}>} args.buildings  share: fraction of CpS
 */
export function lumpValue({ lumps, sugarBaking, buildings }) {
    let level = 0;
    for (const b of buildings) {
        if (b.amount > 0 && b.share > 0) level = Math.max(level, (b.share * 0.01) / (b.level + 1));
    }
    const held = Math.max(0, lumps);
    const baking = sugarBaking && held < 100 ? 0.01 / (1 + 0.01 * held) : 0;
    return Math.max(level, baking);
}

/**
 * What a faster lump supply adds, as an average share over the next run: the extra lumps pile up
 * from nothing, so the run sees half the last day's gain on average. They keep paying after the
 * run, which this leaves out; the next ascension re-plans with a longer run behind it.
 */
export function lumpShare({ perDayBefore, perDayAfter, value, horizonSeconds }) {
    const extra = perDayAfter - perDayBefore;
    if (!(extra > 0) || !(value > 0) || !(horizonSeconds > 0)) return 0;
    return (extra * value * (horizonSeconds / 86400)) / 2;
}

/**
 * Sugar craving opens Sugar frenzy: triple CpS for an hour, once an ascension (main.js:11032,
 * 11036-11044), which is two extra hours of CpS over a run, or tripling a run shorter than an hour.
 */
export function sugarFrenzyShare(horizonSeconds) {
    if (!(horizonSeconds > 0)) return 0;
    return Math.min(2, (2 * 3600) / horizonSeconds);
}

/**
 * The season upgrades that only make drops come faster (main.js:10584-10586) and Keepsakes
 * (main.js:11219). Seasonal drops reset every ascension (main.js:3560-3571), so a run collects
 * them as it goes: drops `rate` more often reach each drop about `rate` sooner, half of that on
 * average over the run. Keepsakes starts the run with a fifth of them, which would otherwise
 * arrive over the run.
 */
export const SEASON_BOOSTS = {
    Starsnow: { drops: 'christmas', rate: 0.05 },
    Starterror: { drops: 'halloween', rate: 0.1 },
    Starspawn: { drops: 'easter', rate: 0.1 },
    Keepsakes: { drops: 'all', rate: 0.2 },
};

/**
 * @param {string} name
 * @param {Object<string, number>} dropShares  share of income each season's drops add, measured
 */
export function seasonBoostShare(name, dropShares) {
    const boost = SEASON_BOOSTS[name];
    if (!boost) return 0;
    const drops = dropShares[boost.drops];
    return drops > 0 ? (boost.rate / 2) * drops : 0;
}

/**
 * Permanent-slot candidates by what a slot saves: the income the next run loses until the buyer
 * buys the upgrade again. `reacquire` is how many cookies the run had baked when the buyer bought
 * it; the loss is about `share × reacquire` cookies, and as a fraction of the run's cookies it is
 * an average share over the run, comparable with a heavenly upgrade's.
 *
 * @param {object} args
 * @param {Array<{id, name, share: number, reacquire: number}>} args.candidates
 * @param {number} args.runCookies  cookies the run has baked
 * @returns candidates with `value`, best first, worthless ones left out
 */
export function rankSlots({ candidates, runCookies }) {
    return candidates
        .map((c) => ({ ...c, value: runCookies > 0 && c.share > 0 ? (c.share * Math.min(Math.max(0, c.reacquire), runCookies)) / runCookies : 0 }))
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value);
}
