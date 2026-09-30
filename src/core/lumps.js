/**
 * What to spend sugar lumps on. Pure.
 *
 * A building level costs (level + 1) lumps and adds 1% to that building's own CpS
 * (main.js:5058, 8104). The community order comes first because its value is not CpS: the four
 * minigames, a full 6×6 garden (Farm 9), and the Cursor levels the last stock market office
 * needs (Cursor 12). After that, Sugar baking pays +1% of all CpS per unspent lump up to 100,
 * which no single building level can match, so 100 are held and only the excess is spent.
 */

const MINIGAMES = ['Wizard tower', 'Temple', 'Farm', 'Bank'];
const TARGETS = [
    ['Farm', 9], // 6×6 garden plot
    ['Cursor', 12], // the fifth bank office needs Cursor level 12
];
export const SUGAR_BAKING_HOLD = 100;

/**
 * The building level with the best CpS gain per lump, or null when nothing owned makes CpS.
 * `valuePerLump` is the fraction of all CpS one lump adds there: a level adds 1% of the building's
 * own CpS (main.js:5058) and costs level + 1 lumps (main.js:8104).
 *
 * @param {Array<{name: string, level: number, amount: number, share: number}>} buildings
 * @returns {{name: string, cost: number, valuePerLump: number, share: number} | null}
 */
export function bestLevel(buildings) {
    let best = null;
    for (const b of buildings) {
        if (!(b.amount > 0) || !(b.share > 0)) continue;
        const cost = b.level + 1;
        const valuePerLump = (b.share * 0.01) / cost;
        if (!best || valuePerLump > best.valuePerLump) best = { name: b.name, cost, valuePerLump, share: b.share };
    }
    return best;
}

/**
 * @param {object} args
 * @param {Array<{name: string, level: number, amount: number, share: number}>} args.buildings  share: fraction of CpS the building makes
 * @param {number} args.lumps
 * @param {boolean} args.sugarBaking  the Sugar baking heavenly upgrade is owned
 * @param {boolean} [args.guard]      the Sugar Baking Guard setting: hold a jar before it is owned
 * @returns {{name: string, cost: number, reason: string} | null}
 */
export function nextLevelUp({ buildings, lumps, sugarBaking, guard = false }) {
    const byName = new Map(buildings.map((b) => [b.name, b]));
    const levelUp = (b, reason, hold) => {
        const cost = b.level + 1;
        return cost <= lumps - hold ? { name: b.name, cost, reason } : null;
    };

    // A minigame costs one lump and opens a whole system, so it is never held back.
    for (const name of MINIGAMES) {
        const b = byName.get(name);
        if (b && b.amount > 0 && b.level === 0) return levelUp(b, 'unlocks its minigame', 0);
    }
    // Once Sugar baking is owned every other lump spent below 100 costs 1/(100 + L) of all CpS
    // until it grows back (main.js:5095), a day per lump, so the targets wait for the excess too.
    // Before that, the guard keeps a jar ready for the purchase but lets the targets go first:
    // their worth is not CpS, and the jar costs nothing until Sugar baking is bought.
    const targetHold = sugarBaking ? SUGAR_BAKING_HOLD : 0;
    for (const [name, target] of TARGETS) {
        const b = byName.get(name);
        if (b && b.amount > 0 && b.level < target) return levelUp(b, `towards level ${target}`, targetHold);
    }

    // The best level per lump is waited for, not traded for whatever is affordable now: spending
    // on cheap low-value levels leaves the lumps spread thin.
    const best = bestLevel(buildings);
    if (!best) return null;
    return levelUp(byName.get(best.name), `+1% of a ${(best.share * 100).toFixed(1)}% share of CpS`, sugarBaking || guard ? SUGAR_BAKING_HOLD : 0);
}
