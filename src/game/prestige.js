// Heavenly upgrades and permanent slots, read from and measured against the live game.
//
// Both are planned BEFORE ascending: a heavenly upgrade is worth the share of income it adds,
// and on the ascension screen the bakery is empty, so there is nothing to measure there.
import { simulateEach } from '../core/sim.js';
import { estimateIncome } from '../core/income.js';
import { readState } from './measure.js';
import { rankHeavenly, planChips } from '../core/heavenly.js';

const MAX_PLAN_STEPS = 60;
const SLOT_UPGRADES = ['Permanent upgrade slot I', 'Permanent upgrade slot II', 'Permanent upgrade slot III', 'Permanent upgrade slot IV', 'Permanent upgrade slot V'];

/**
 * Prestige upgrades that could be bought once everything in `planned` is bought, as shown at
 * `prestige`: some are only shown at certain prestige levels (Lucky digit and its line).
 */
export function heavenlyCandidates(game, planned = new Set(), prestige = game.prestige) {
    const saved = game.prestige;
    game.prestige = prestige;
    try {
        const out = [];
        for (const upgrade of game.PrestigeUpgrades) {
            if (upgrade.bought || planned.has(upgrade)) continue;
            if (upgrade.showIf && !upgrade.showIf()) continue;
            const parentsMet = (upgrade.parents || []).every((p) => p === -1 || p.bought || planned.has(p));
            if (!parentsMet) continue;
            out.push({ id: upgrade.id, name: upgrade.name, price: upgrade.getPrice(), upgrade });
        }
        return out;
    } finally {
        game.prestige = saved;
    }
}

/**
 * Which heavenly upgrades to buy with `chips`, chosen one at a time so that each choice sees
 * the ones before it (a bought parent opens its children; a multiplier changes every share).
 *
 * `prestigeAfter` is the prestige level the run is about to reach: upgrades that unlock a share
 * of the prestige bonus are worth nothing at the prestige of the run being measured, which on a
 * first run is zero.
 * @returns {{buy: Array<{id, name, price, share}>, saving: {name, price} | null, left: number}}
 */
export function planHeavenly(game, settings, chips, prestigeAfter = game.prestige) {
    const planned = new Set();
    const buy = [];
    let left = chips;
    let saving = null;
    const applyPlanned = () => {
        game.prestige = prestigeAfter;
        for (const upgrade of planned) {
            upgrade.bought = 1;
            upgrade.unlocked = 1;
        }
    };
    for (let step = 0; step < MAX_PLAN_STEPS; step++) {
        const candidates = heavenlyCandidates(game, planned, prestigeAfter);
        if (!candidates.length) break;
        const trials = [
            { apply: applyPlanned },
            ...candidates.map((c) => ({
                apply() {
                    applyPlanned();
                    c.upgrade.bought = 1;
                    c.upgrade.unlocked = 1;
                },
            })),
        ];
        const measured = simulateEach(game, trials, () => estimateIncome(readState(game, settings)));
        const income = measured[0];
        const ranked = rankHeavenly({ candidates, measured: measured.slice(1), income });
        const plan = planChips({ ranked, chips: left });
        if (plan.saving) saving = { name: plan.saving.name, price: plan.saving.price };
        if (!plan.buy.length) break;
        const next = plan.buy[0];
        planned.add(next.upgrade);
        buy.push({ id: next.id, name: next.name, price: next.price, share: next.share });
        left -= next.price;
    }
    return { buy, saving, left };
}

/** Owned upgrades a permanent slot may hold (main.js:10543-10547). */
export function slotCandidates(game) {
    return Object.values(game.UpgradesById).filter(
        (u) => u.bought && u.unlocked && !u.noPerm && (u.pool === '' || u.pool === 'cookie')
    );
}

/**
 * Every upgrade a permanent slot could hold, ranked by the share of income its loss would
 * cost, measured on the bakery as it stands. Measured before ascending; used on the ascension
 * screen, where the upgrades are still owned until the reset.
 * @returns {Array<{id: number, name: string, share: number}>} best first
 */
export function rankPermanentSlots(game, settings) {
    const upgrades = slotCandidates(game);
    const trials = [{ apply() {} }, ...upgrades.map((u) => ({ apply: () => { u.bought = 0; } }))];
    const measured = simulateEach(game, trials, () => estimateIncome(readState(game, settings)).total);
    const now = measured[0];
    return upgrades
        .map((u, i) => ({ id: u.id, name: u.name, share: now > 0 ? (now - measured[i + 1]) / now : 0 }))
        .filter((c) => c.share > 0)
        .sort((a, b) => b.share - a.share);
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
