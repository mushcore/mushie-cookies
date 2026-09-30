/**
 * Spending heavenly chips. Pure.
 *
 * Chips do not accrue while ascended, so there is no wait to price in: each upgrade is worth the
 * share of income it adds per chip, and the ranking is that ratio. Upgrades whose worth the
 * income model cannot see are given a fixed share by name.
 */

/** Relative income share credited to upgrades the model cannot measure. */
export const ENABLER_SHARE = {
    Legacy: 1000, // nothing else in the tree is reachable without it
    'How to bake your dragon': 0.5,
    'Season switcher': 0.3,
    'Golden switch': 0.2,
    'Persistent memory': 0.1,
    'Permanent upgrade slot I': 0.4,
    'Permanent upgrade slot II': 0.4,
    'Permanent upgrade slot III': 0.3,
    'Permanent upgrade slot IV': 0.3,
    'Permanent upgrade slot V': 0.3,
    // Offline production: worth something to a player who closes the game.
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
 * @param {Array<{id, name, price}>} args.candidates
 * @param {Array<{total: number}>} args.measured  income after each candidate, aligned
 * @param {{total: number}} args.income           income now
 * @returns candidates with `share` (relative income gain) and `valuePerChip`, best first
 */
export function rankHeavenly({ candidates, measured, income }) {
    const ranked = candidates.map((candidate, i) => {
        const measuredShare = income.total > 0 ? (measured[i].total - income.total) / income.total : 0;
        const share = Math.max(measuredShare, ENABLER_SHARE[candidate.name] || 0);
        return { ...candidate, share, valuePerChip: candidate.price > 0 ? share / candidate.price : share > 0 ? Infinity : 0 };
    });
    ranked.sort((a, b) => b.valuePerChip - a.valuePerChip || a.price - b.price);
    return ranked;
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
