// Heavenly upgrades and permanent slots, read from and measured against the live game.
//
// Both are planned BEFORE ascending: a heavenly upgrade is worth the share of income it adds,
// and on the ascension screen the bakery is empty, so there is nothing to measure there.
import { simulateEach } from '../core/sim.js';
import { estimateIncome } from '../core/income.js';
import { readState } from './measure.js';
import { rankHeavenly, planChips } from '../core/heavenly.js';

const MAX_PLAN_STEPS = 60;

/** Prestige upgrades that could be bought once everything in `planned` is bought. */
export function heavenlyCandidates(game, planned = new Set()) {
    const out = [];
    for (const upgrade of game.PrestigeUpgrades) {
        if (upgrade.bought || planned.has(upgrade)) continue;
        if (upgrade.showIf && !upgrade.showIf()) continue;
        const parentsMet = (upgrade.parents || []).every((p) => p === -1 || p.bought || planned.has(p));
        if (!parentsMet) continue;
        out.push({ id: upgrade.id, name: upgrade.name, price: upgrade.getPrice(), upgrade });
    }
    return out;
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
        const candidates = heavenlyCandidates(game, planned);
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

/** Owned upgrades a permanent slot may hold, not already slotted (main.js:10543-10547). */
export function slotCandidates(game) {
    const slotted = new Set(game.permanentUpgrades);
    return Object.values(game.UpgradesById).filter(
        (u) => u.bought && u.unlocked && !u.noPerm && (u.pool === '' || u.pool === 'cookie') && !slotted.has(u.id)
    );
}

/**
 * Fills the permanent slots the player owns with the upgrades whose loss would cost the most
 * income, measured on the current bakery. A slot already holding something better is left.
 * @returns {Array<{slot: number, id: number, name: string, share: number}>} what was assigned
 */
export function fillPermanentSlots(game, settings) {
    const slots = [];
    for (let i = 0; i < 5; i++) {
        if (game.Has(['Permanent upgrade slot I', 'Permanent upgrade slot II', 'Permanent upgrade slot III', 'Permanent upgrade slot IV', 'Permanent upgrade slot V'][i])) {
            slots.push(i);
        }
    }
    if (!slots.length) return [];

    const shareOf = (upgrades) => {
        const trials = [{ apply() {} }, ...upgrades.map((u) => ({ apply: () => { u.bought = 0; } }))];
        const measured = simulateEach(game, trials, () => estimateIncome(readState(game, settings)).total);
        const now = measured[0];
        return upgrades.map((u, i) => ({ upgrade: u, share: now > 0 ? (now - measured[i + 1]) / now : 0 }));
    };

    const candidates = shareOf(slotCandidates(game)).sort((a, b) => b.share - a.share);
    const current = shareOf(slots.map((i) => game.UpgradesById[game.permanentUpgrades[i]]).filter(Boolean));
    const currentShare = new Map(current.map((c) => [c.upgrade.id, c.share]));

    const assigned = [];
    let next = 0;
    for (const slot of slots) {
        const holding = game.permanentUpgrades[slot];
        const held = holding === -1 ? -1 : currentShare.get(holding) || 0;
        while (next < candidates.length) {
            const pick = candidates[next];
            if (pick.share <= held) break; // what is there is at least as good
            next++;
            if (pick.share <= 0) break;
            game.permanentUpgrades[slot] = pick.upgrade.id;
            assigned.push({ slot, id: pick.upgrade.id, name: pick.upgrade.name, share: pick.share });
            break;
        }
    }
    return assigned;
}
