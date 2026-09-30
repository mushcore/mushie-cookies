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
 * The chance that `target` wins one tile in one roll, from the mutations the game lists for it.
 * Every mutation listed is rolled on its own and one of those that pass is picked at random
 * (minigameGarden.js:1953-1958), so other mutations that can happen in the same tile take a
 * share: approximated by halving each competitor.
 */
function chanceIn(muts, target) {
    let p = 0;
    let others = 1;
    for (let i = 0; i < muts.length; i++) {
        const chance = muts[i][1];
        if (muts[i][0] === target) p = 1 - (1 - p) * (1 - chance);
        else others *= 1 - chance / 2;
    }
    return p * others;
}

/**
 * The chance that `target` appears in one empty tile in one garden tick, given how many of its
 * neighbours hold each parent (all mature), with `loops` rolls a tick (three on wood chips).
 */
export function chanceFunction(M, target, loops = 1) {
    // One counts object, cleared after each question: getMuts only reads it, and building a fresh
    // one with every plant in it per question was most of a replan's time.
    const neighs = zeroCounts(M);
    return (counts) => {
        const keys = Object.keys(counts);
        for (const key of keys) neighs[key] = counts[key];
        const muts = M.getMuts(neighs, neighs);
        for (const key of keys) neighs[key] = 0;
        return 1 - Math.pow(1 - chanceIn(muts, target), loops);
    };
}

const recipeMemo = new WeakMap(); // garden -> { key: the plantable seeds, recipes }

/**
 * Recipes for every plant from the plants that can be planted now: one parent, or two, in counts
 * up to what fits around a tile. Asked of the game's own mutation function, so upper limits and
 * odd conditions come for free. One pass over the parent counts answers for every target at once,
 * and the answer is kept until the plantable seeds change.
 *
 * Per target, the likeliest recipe comes first; then, if it is a different one, the recipe with
 * the most chance per minute of CpS its parents around one tile cost (a seed costs minutes of
 * CpS, minigameGarden.js:1097-1101).
 * @returns {Object<string, Array<{parents: string[], best: number}>>}  best: the single-tile chance
 */
export function findRecipes(M) {
    const plantable = Object.values(M.plants).filter((p) => p.unlocked && p.plantable !== false);
    const key = plantable.map((p) => p.key).join(',');
    const memo = recipeMemo.get(M);
    if (memo && memo.key === key) return memo.recipes;

    // Thousands of questions per search: plain loops, and one counts object reused throughout.
    const neighs = zeroCounts(M);
    const likeliest = {};
    const cheapest = {};
    const counts = [0, 0];
    const consider = (parents) => {
        let minutes = 0;
        for (let k = 0; k < parents.length; k++) {
            neighs[parents[k]] = counts[k];
            minutes += counts[k] * M.plants[parents[k]].cost;
        }
        const muts = M.getMuts(neighs, neighs);
        for (let k = 0; k < parents.length; k++) neighs[parents[k]] = 0;
        for (let i = 0; i < muts.length; i++) {
            const target = muts[i][0];
            let seen = parents.indexOf(target) >= 0;
            for (let m = 0; m < i && !seen; m++) seen = muts[m][0] === target;
            if (seen) continue;
            const c = chanceIn(muts, target);
            if (!(c > 0)) continue;
            if (!likeliest[target] || c > likeliest[target].best) likeliest[target] = { parents, best: c };
            if (!cheapest[target] || c / minutes > cheapest[target].perMinute) cheapest[target] = { parents, best: c, perMinute: c / minutes };
        }
    };
    for (const a of plantable) {
        const one = [a.key];
        for (let n = 1; n <= 8; n++) {
            counts[0] = n;
            consider(one);
        }
    }
    for (let i = 0; i < plantable.length; i++) {
        for (let j = i + 1; j < plantable.length; j++) {
            const two = [plantable[i].key, plantable[j].key];
            for (let na = 1; na <= 4; na++) {
                for (let nb = 1; nb <= 4; nb++) {
                    counts[0] = na;
                    counts[1] = nb;
                    consider(two);
                }
            }
        }
    }
    const recipes = {};
    for (const target of Object.keys(likeliest)) {
        const first = likeliest[target];
        const cheap = cheapest[target];
        recipes[target] = [first];
        if (cheap.parents.join() !== first.parents.join()) recipes[target].push({ parents: cheap.parents, best: cheap.best });
    }
    recipeMemo.set(M, { key, recipes });
    return recipes;
}

/** The likeliest recipe for `target` from plants that can be planted now, or null. */
export function findRecipe(M, target) {
    const list = findRecipes(M)[target];
    return list ? list[0] : null;
}

/** Soil ids (minigameGarden.js:877-929). */
export const SOIL = { dirt: 0, fertilizer: 1, clay: 2, pebbles: 3, woodchips: 4 };

/** The first soil in `preference` that the farm count unlocks (minigameGarden.js:877-929). */
export function soilFor(M, preference) {
    return preference.find((key) => M.soils[key] && M.parent.amount >= M.soils[key].req) || 'dirt';
}

/**
 * Puts the field on `key` the way the player does, by clicking it. True when the field is on it,
 * including when it already was, which needs no click; false while the game refuses the change:
 * ten minutes between changes, a frozen garden, too few farms (minigameGarden.js:1349-1353).
 */
export function chooseSoil(M, key) {
    const soil = M.soils[key];
    if (!soil) return false;
    if (M.soil === soil.id) return true;
    if (M.freeze || M.nextSoil > Date.now() || M.parent.amount < soil.req) return false;
    const button = document.getElementById('gardenSoil-' + soil.id);
    if (!button) return false;
    button.click();
    return M.soil === soil.id;
}
