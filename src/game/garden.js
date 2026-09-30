// The garden as the game has it, and the mutation rules asked of the game itself.

/** The garden minigame once it has loaded, else null. */
export function gardenOf(game) {
    const M = game.Objects['Farm'].minigame;
    return M && M.plants && M.plot ? M : null;
}

/** Tiles of the plot that can be planted at the farm's current level. */
export function plotTiles(M) {
    const tiles = [];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) if (M.isTileUnlocked(x, y)) tiles.push({ x, y });
    return tiles;
}

function zeroCounts(M) {
    const counts = {};
    for (const key of Object.keys(M.plants)) counts[key] = 0;
    return counts;
}

/**
 * The chance that `target` appears in one empty tile in one garden tick, given how many of its
 * neighbours hold each parent (all mature). Every mutation the game lists is rolled on its own and
 * one of those that pass is picked at random (minigameGarden.js:1943-1958), so other mutations
 * that can happen in the same tile take a share: approximated by halving each competitor.
 */
export function chanceFunction(M, target, loops = 1) {
    return (counts) => {
        const neighs = zeroCounts(M);
        for (const [key, n] of Object.entries(counts)) neighs[key] = n;
        let p = 0;
        let others = 1;
        for (const [key, chance] of M.getMuts(neighs, neighs)) {
            if (key === target) p = 1 - (1 - p) * (1 - chance);
            else others *= 1 - chance / 2;
        }
        const once = p * others;
        return 1 - Math.pow(1 - once, loops);
    };
}

/**
 * The best recipe for `target` from plants that can be planted now: one parent, or two, in
 * counts up to what fits around a tile. Asked of the game's own mutation function, so upper
 * limits and odd conditions come for free.
 * @returns {{parents: string[], best: number} | null}  best: the highest single-tile chance seen
 */
export function findRecipe(M, target) {
    const plantable = Object.values(M.plants).filter((p) => p.unlocked && p.plantable !== false && p.key !== target);
    const chance = chanceFunction(M, target);
    let found = null;
    const consider = (parents, counts) => {
        const c = chance(counts);
        if (c > 0 && (!found || c > found.best)) found = { parents, best: c };
    };
    for (const a of plantable) {
        for (let n = 1; n <= 8; n++) consider([a.key], { [a.key]: n });
    }
    for (let i = 0; i < plantable.length; i++) {
        for (let j = i + 1; j < plantable.length; j++) {
            const a = plantable[i].key;
            const b = plantable[j].key;
            for (let na = 1; na <= 4; na++) for (let nb = 1; nb <= 4; nb++) consider([a, b], { [a]: na, [b]: nb });
        }
    }
    return found;
}

/** Soil ids (minigameGarden.js:877-929). */
export const SOIL = { dirt: 0, fertilizer: 1, clay: 2, pebbles: 3, woodchips: 4 };

/** Changes soil the way the player does, by clicking it; false when the game refuses. */
export function chooseSoil(M, key) {
    const soil = M.soils[key];
    if (!soil || M.soil === soil.id || M.freeze || M.nextSoil > Date.now() || M.parent.amount < soil.req) return false;
    const button = document.getElementById('gardenSoil-' + soil.id);
    if (!button) return false;
    button.click();
    return M.soil === soil.id;
}
