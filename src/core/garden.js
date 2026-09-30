/**
 * Garden layout. Pure.
 *
 * A mutation can appear in an empty tile, with a chance that depends on which plants grow in the
 * eight tiles around it (minigameGarden.js:1930-1967). The layout puts parent plants on some tiles
 * and leaves the rest empty so that the summed chance of the target over the empty tiles is as
 * large as possible. `chance(counts)` answers for one empty tile: counts maps a parent key to how
 * many of its eight neighbours hold that parent (all assumed mature).
 */

/** A small seeded generator, so a layout is the same every time for the same inputs. */
function lcg(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/**
 * @param {object} args
 * @param {Array<{x: number, y: number}>} args.tiles   tiles that can be planted
 * @param {string[]} args.parents                       parent keys the layout may use
 * @param {(counts: Object<string, number>) => number} args.chance
 * @param {number} [args.restarts=12]
 * @param {number} [args.seed=1]
 * @returns {{layout: Array<string|null>, score: number}}  layout[i] is the parent on tiles[i], or null for empty
 */
export function optimizeLayout({ tiles, parents, chance, restarts = 12, seed = 1 }) {
    const n = tiles.length;
    const index = new Map(tiles.map((t, i) => [`${t.x},${t.y}`, i]));
    const neighbours = tiles.map((t) => {
        const out = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const j = index.get(`${t.x + dx},${t.y + dy}`);
                if (j !== undefined) out.push(j);
            }
        }
        return out;
    });

    const memo = new Map();
    const tileChance = (counts) => {
        const key = parents.map((p) => counts[p] || 0).join(',');
        if (!memo.has(key)) memo.set(key, chance(counts));
        return memo.get(key);
    };
    const choices = [null, ...parents];
    // Recipes that need many parents score nothing until all are in place, which leaves the
    // search nothing to climb. A tie-breaker far below any real chance (the rarest mutation is
    // 1e-4) rewards gathering parents around the same empty tile.
    const SHAPING = 1e-9;
    const score = (layout, withShaping = true) => {
        let total = 0;
        for (let i = 0; i < n; i++) {
            if (layout[i] !== null) continue;
            const counts = {};
            let around = 0;
            for (const j of neighbours[i]) {
                if (layout[j] !== null) {
                    counts[layout[j]] = (counts[layout[j]] || 0) + 1;
                    around++;
                }
            }
            total += tileChance(counts);
            if (withShaping) total += SHAPING * around * around;
        }
        return total;
    };

    const random = lcg(seed);
    let best = { layout: new Array(n).fill(null), score: 0, shaped: -1 };
    for (let r = 0; r < restarts; r++) {
        // Start from a random layout with about a third of the tiles planted.
        const layout = tiles.map(() => (random() < 0.35 ? parents[Math.floor(random() * parents.length)] : null));
        let current = score(layout);
        let improved = true;
        while (improved) {
            improved = false;
            for (let i = 0; i < n; i++) {
                const keep = layout[i];
                for (const choice of choices) {
                    if (choice === keep) continue;
                    layout[i] = choice;
                    const s = score(layout);
                    if (s > current + 1e-12) {
                        current = s;
                        improved = true;
                        break;
                    }
                    layout[i] = keep;
                }
            }
        }
        const real = score(layout, false);
        if (real > best.score || (real === best.score && current > best.shaped)) best = { layout: layout.slice(), score: real, shaped: current };
    }
    return { layout: best.layout, score: best.score };
}

/**
 * Average growth per garden tick of a plant (minigameGarden.js:1886): ageTick plus half of the
 * random extra, scaled by the plot's aging boost.
 */
export function agePerTick(plant, boost = 1) {
    return (plant.ageTick + plant.ageTickR / 2) * boost;
}

/**
 * Which parents to plant now, so that they come to maturity together. The slowest to mature is
 * planted first; a faster one is planted once it would mature no sooner than the slowest.
 *
 * @param {Array<{key: string, planted: boolean, ticksLeft: number}>} slots  one per planned parent tile
 * @returns {Set<string>} parent keys that may be planted now
 */
export function plantNow(slots) {
    const horizon = Math.max(0, ...slots.map((s) => s.ticksLeft));
    const out = new Set();
    for (const s of slots) if (!s.planted && s.ticksLeft >= horizon - 1) out.add(s.key);
    return out;
}
