// Heavenly upgrades and permanent slots, read from and measured against the live game.
//
// Both are planned BEFORE ascending: a heavenly upgrade is worth the share of income it adds,
// and on the ascension screen the bakery is empty, so there is nothing to measure there.
import { simulateEach } from '../core/sim.js';
import { estimateIncome } from '../core/income.js';
import { readState } from './measure.js';
import { planTree, fixedShare, lumpsPerDay, lumpValue, lumpShare, rankSlots } from '../core/heavenly.js';

// One step buys one bundle; the tree has about 130 upgrades, so this never cuts a plan short.
const MAX_PLAN_STEPS = 200;
const SLOT_UPGRADES = ['Permanent upgrade slot I', 'Permanent upgrade slot II', 'Permanent upgrade slot III', 'Permanent upgrade slot IV', 'Permanent upgrade slot V'];

/**
 * A store upgrade or drop an upgrade opens counts only when a run like this one bakes ten times
 * its price: it would then be running for at least nine tenths of a similar run's cookies. Dearer
 * ones would arrive too late in the run to matter.
 */
const OPEN_PRICE_SHARE = 0.1;
const DRAGON_DROPS = ['Dragon scale', 'Dragon claw', 'Dragon fang', 'Dragon teddy bear'];
/** Pet the dragon drops these only at dragon level 8 or more (main.js:14957). */
const DRAGON_DROP_LEVEL = 8;

/**
 * An unlock is worth what it opens only while the system that uses it is on: the season planner
 * switches seasons to collect their drops (spec 4.4), petting takes the dragon's drops (4.5),
 * fortunes are clicked from the news ticker, and the lump system takes Sugar frenzy (4.8).
 */
const USED_WHEN = {
    'Season switcher': (settings) => settings.autoSeasons == 1,
    'Pet the dragon': (settings) => settings.petDragon == 1,
    'Fortune cookies': (settings) => settings.autoFortune == 1,
    'Sugar craving': (settings) => settings.sugarFrenzy == 1,
};
const used = (name, settings) => !USED_WHEN[name] || USED_WHEN[name](settings);

/** Every heavenly upgrade as a node of the tree the planner walks, shown or not at `prestige`. */
function readTree(game, prestige) {
    const saved = game.prestige;
    game.prestige = prestige;
    try {
        return game.PrestigeUpgrades.filter((u) => u.pool === 'prestige').map((u) => ({
            id: u.id,
            name: u.name,
            price: u.getPrice(),
            // Parent names become objects when the game starts (main.js:12527).
            parents: (u.parents || []).filter((p) => p && p !== -1).map((p) => p.id),
            owned: !!u.bought,
            shown: !u.showIf || !!u.showIf(),
        }));
    } finally {
        game.prestige = saved;
    }
}

/** Season drop lists by what boosts them (main.js:10226, 10309, 10413, 12394-12415). */
function seasonDropLists(game) {
    return {
        christmas: game.reindeerDrops || [],
        halloween: game.halloweenDrops || [],
        easter: game.easterEggs || [],
        valentines: game.heartDrops || [],
        all: game.seasonDrops || [],
    };
}

/**
 * The store upgrades and drops each heavenly upgrade opens, at the building counts of now, keeping
 * only what a run like this one affords (OPEN_PRICE_SHARE):
 * - cookies that require it, such as the boxes' (main.js:9790-9798, unlocked at 16335-16345);
 * - the synergy tier it gates, for pairs of buildings already at the tier's count (main.js:9920);
 * - Pet the dragon: the dragon's drops, once the dragon reaches level 8 (main.js:14944-14970);
 * - Fortune cookies: the fortune upgrades the news ticker offers (main.js:7565-7581);
 * - Season switcher: the seasonal drops a run can then collect (main.js:10330, 12415).
 * Each only while the system that uses it is on (USED_WHEN). Measured once, on the living bakery,
 * before any what-if.
 */
function opensByUpgrade(game, settings) {
    const cookies = game.cookiesEarned;
    const affordable = (u) => u && !u.bought && u.getPrice() <= OPEN_PRICE_SHARE * cookies;
    const out = new Map();
    const add = (name, upgrade) => {
        if (!used(name, settings) || !affordable(upgrade)) return;
        if (!out.has(name)) out.set(name, new Set());
        out.get(name).add(upgrade);
    };
    for (const unlock of game.UnlockAt || []) {
        // Seasonal cookies unlock only in their season; the season planner owns those.
        if (unlock.require && !unlock.season) add(unlock.require, game.Upgrades[unlock.name]);
    }
    for (const building of game.ObjectsById) {
        for (const syn of building.synergies || []) {
            const tier = game.Tiers[syn.tier];
            if (!tier || !tier.req) continue;
            if (syn.buildingTie1.amount >= tier.unlock && syn.buildingTie2.amount >= tier.unlock) add(tier.req, syn);
        }
    }
    if (game.dragonLevel >= DRAGON_DROP_LEVEL) for (const name of DRAGON_DROPS) add('Pet the dragon', game.Upgrades[name]);
    for (const u of (game.Tiers.fortune && game.Tiers.fortune.upgrades) || []) add('Fortune cookies', u);
    for (const name of seasonDropLists(game).all) add('Season switcher', game.Upgrades[name]);
    return out;
}

/** Income, and what the lump supply depends on, as the game computes them right now. */
function measureNow(game, settings) {
    const state = readState(game, settings);
    // Golden cookies, and everything else that spawns, come doubled 1% of the time
    // (main.js:10871): one more cookie in a hundred, which the income model does not see.
    if (game.Has('Distilled essence of redoubled luck')) state.golden = { ...state.golden, meanInterval: state.golden.meanInterval / 1.01 };
    return {
        total: estimateIncome(state).total,
        // CalculateGains recomputes lump times (main.js:5169), so this is the what-if's.
        ripeMs: game.lumpRipeAge,
        sucralosia: !!game.Has('Sucralosia Inutilis'),
        sugarBaking: !!game.Has('Sugar baking'),
    };
}

/** What each season's drops add to income, all owned against none: the base for the boosts. */
function measureSeasonDrops(game, settings) {
    const lists = seasonDropLists(game);
    const names = Object.keys(lists);
    const set = (list, bought) => () => {
        for (const name of list) if (game.Upgrades[name]) game.Upgrades[name].bought = bought;
    };
    const trials = [];
    for (const name of names) trials.push({ apply: set(lists[name], 0) }, { apply: set(lists[name], 1) });
    const measured = simulateEach(game, trials, () => measureNow(game, settings).total);
    const out = {};
    names.forEach((name, i) => {
        const off = measured[2 * i];
        out[name] = off > 0 ? measured[2 * i + 1] / off - 1 : 0;
    });
    return out;
}

/** Each building's share of CpS, for what a lump is worth as a level. */
function buildingShares(game) {
    const total = game.ObjectsById.reduce((sum, b) => sum + (b.storedTotalCps || 0), 0);
    return game.ObjectsById.map((b) => ({ level: b.level, amount: b.amount, share: total > 0 ? (b.storedTotalCps || 0) / total : 0 }));
}

/**
 * Which heavenly upgrades to buy with `chips`, chosen one bundle at a time (an upgrade with every
 * ancestor it still needs), so that each choice sees the ones before it.
 *
 * `prestigeAfter` is the prestige level the run is about to reach: upgrades that unlock a share
 * of the prestige bonus are worth nothing at the prestige of the run being measured, which on a
 * first run is zero.
 * @param {object} [options]
 * @param {Array<{value: number}>} [options.slotRanking]  rankPermanentSlots' result; measured if missing
 * @param {object} [options.reacquire]    for the slot ranking when it is measured here
 * @param {number} [options.runSeconds]   length of the run being ended: the horizon for lumps and Sugar frenzy
 * @returns {{buy: Array<{id, name, price, share, for}>, saving: {name, price} | null, left: number}}
 */
export function planHeavenly(game, settings, chips, prestigeAfter = game.prestige, options = {}) {
    const horizonSeconds = options.runSeconds > 0 ? options.runSeconds : Math.max(0, (Date.now() - game.startDate) / 1000);
    const slotValues = (options.slotRanking || rankPermanentSlots(game, settings, options)).map((c) => c.value);
    const ownedSlots = SLOT_UPGRADES.filter((name) => game.Upgrades[name] && game.Upgrades[name].bought).length;
    const opens = opensByUpgrade(game, settings);
    // The season boosts and Keepsakes speed up drops only the season planner collects.
    const dropShares = used('Season switcher', settings) ? measureSeasonDrops(game, settings) : {};
    const frenzySeconds = used('Sugar craving', settings) ? horizonSeconds : 0;
    const buildings = buildingShares(game);
    const lumpsOn = game.canLumps();
    const tree = readTree(game, prestigeAfter);

    const bring = (upgrades) => {
        for (const u of upgrades) {
            u.bought = 1;
            u.unlocked = 1;
        }
        for (const u of upgrades) {
            for (const opened of opens.get(u.name) || []) {
                if (opened.bought) continue;
                opened.bought = 1;
                opened.unlocked = 1;
                game.UpgradesOwned += 1;
            }
        }
    };
    const perDay = (m) => lumpsPerDay({ ripeMs: m.ripeMs, sucralosia: m.sucralosia, elderWrath: game.elderWrath, curve: game.auraMult("Dragon's Curve") });

    const value = (planned, bundles) => {
        const plannedUpgrades = [...planned].map((id) => game.UpgradesById[id]);
        const base = () => {
            game.prestige = prestigeAfter;
            bring(plannedUpgrades);
        };
        const trials = [{ apply: base }, ...bundles.map((b) => ({ apply() { base(); bring(b.members.map((m) => game.UpgradesById[m.id])); } }))];
        const measured = simulateEach(game, trials, () => measureNow(game, settings));
        const before = measured[0];
        const plannedSlots = plannedUpgrades.filter((u) => SLOT_UPGRADES.includes(u.name)).length;
        return bundles.map((b, i) => {
            const after = measured[i + 1];
            let share = before.total > 0 ? (after.total - before.total) / before.total : 0;
            share += fixedShare(b.members.map((m) => m.name), { dropShares, horizonSeconds: frenzySeconds });
            // Each slot in the bundle holds the next upgrade down the slot ranking.
            let slot = ownedSlots + plannedSlots;
            for (const m of b.members) if (SLOT_UPGRADES.includes(m.name)) share += slotValues[slot++] || 0;
            if (lumpsOn) {
                const lump = lumpValue({ lumps: game.lumps, sugarBaking: after.sugarBaking, buildings });
                share += lumpShare({ perDayBefore: perDay(before), perDayAfter: perDay(after), value: lump, horizonSeconds });
            }
            return share;
        });
    };

    return planTree({ tree, chips, value, maxSteps: MAX_PLAN_STEPS });
}

/** Owned upgrades a permanent slot may hold (main.js:10543-10547). */
export function slotCandidates(game) {
    return Object.values(game.UpgradesById).filter(
        (u) => u.bought && u.unlocked && !u.noPerm && (u.pool === '' || u.pool === 'cookie')
    );
}

function median(values) {
    if (!values.length) return NaN;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Every upgrade a permanent slot could hold, ranked by what the next run would lose without it:
 * the share of income it adds, measured on the bakery as it stands, over the cookies the run had
 * baked when the buyer bought it (see core/heavenly.js rankSlots). Measured before ascending; used
 * on the ascension screen, where the upgrades are still owned until the reset.
 *
 * @param {object} [options]
 * @param {Object<number, number>} [options.reacquire]  upgrade id -> cookies baked this run when it
 *        was bought. An upgrade with no record is assumed bought at its price times the typical
 *        ratio of the recorded ones (at its price when nothing is recorded).
 * @param {number} [options.runCookies]  cookies the run has baked (default: this run's)
 * @returns {Array<{id: number, name: string, share: number, reacquire: number, value: number}>} best first
 */
export function rankPermanentSlots(game, settings, options = {}) {
    const upgrades = slotCandidates(game);
    const trials = [{ apply() {} }, ...upgrades.map((u) => ({ apply: () => { u.bought = 0; } }))];
    const measured = simulateEach(game, trials, () => estimateIncome(readState(game, settings)).total);
    const now = measured[0];
    const known = options.reacquire || {};
    const runCookies = options.runCookies > 0 ? options.runCookies : game.cookiesEarned;
    const ratio = median(upgrades.filter((u) => known[u.id] > 0 && u.getPrice() > 0).map((u) => known[u.id] / u.getPrice()));
    const typical = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    const candidates = upgrades.map((u, i) => ({
        id: u.id,
        name: u.name,
        share: now > 0 ? (now - measured[i + 1]) / now : 0,
        reacquire: known[u.id] > 0 ? known[u.id] : u.getPrice() * typical,
    }));
    return rankSlots({ candidates, runCookies });
}

/**
 * Fills the permanent slots the player owns from a ranking, best first, the way the slot dialog
 * does (main.js:10572). A slot already holding one of the chosen upgrades keeps it.
 * @returns {Array<{slot: number, id: number, name: string}>} what was assigned
 */
export function assignPermanentSlots(game, ranking) {
    const slots = [];
    SLOT_UPGRADES.forEach((name, i) => {
        if (game.Upgrades[name] && game.Upgrades[name].bought) slots.push(i);
    });
    const chosen = ranking.slice(0, slots.length).map((c) => c.id);
    const assigned = [];
    // Keep what is already in place, then fill the rest.
    const missing = chosen.filter((id) => !slots.some((s) => game.permanentUpgrades[s] === id));
    for (const slot of slots) {
        if (chosen.includes(game.permanentUpgrades[slot])) continue;
        const id = missing.shift();
        if (id === undefined) break;
        game.permanentUpgrades[slot] = id;
        assigned.push({ slot, id, name: game.UpgradesById[id].name });
    }
    return assigned;
}

/** Ranks and assigns in one go, on the living bakery. */
export function fillPermanentSlots(game, settings) {
    return assignPermanentSlots(game, rankPermanentSlots(game, settings));
}
