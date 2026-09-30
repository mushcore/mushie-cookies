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

    // The search scores thousands of layouts, so a layout is held as parent indices (-1 empty)
    // and a tile's neighbour counts as one number in base 9 (at most 8 of any parent), which
    // indexes the memo directly: no objects or strings per tile.
    const place = parents.map((p, k) => Math.pow(9, k));
    const memo = new Float64Array(Math.pow(9, parents.length)).fill(-1);
    const tileChance = (code) => {
        if (memo[code] < 0) {
            const counts = {};
            for (let k = 0, rest = code; k < parents.length; k++, rest = Math.floor(rest / 9)) if (rest % 9) counts[parents[k]] = rest % 9;
            memo[code] = chance(counts);
        }
        return memo[code];
    };
    // Recipes that need many parents score nothing until all are in place, which leaves the
    // search nothing to climb. A tie-breaker far below any real chance (the rarest mutation is
    // 1e-4) rewards gathering parents around the same empty tile.
    const SHAPING = 1e-9;
    // Neighbour counts of one tile, left in `code` and `around`.
    let code = 0;
    let around = 0;
    const count = (layout, i) => {
        code = 0;
        around = 0;
        const near = neighbours[i];
        for (let m = 0; m < near.length; m++) {
            const v = layout[near[m]];
            if (v !== -1) {
                code += place[v];
                around++;
            }
        }
    };
    const score = (layout, withShaping = true) => {
        let total = 0;
        for (let i = 0; i < n; i++) {
            if (layout[i] !== -1) continue;
            count(layout, i);
            // Term by term: symmetric layouts tie exactly, and the rounding of this sum picks one.
            total += tileChance(code);
            if (withShaping) total += SHAPING * around * around;
        }
        return total;
    };
    // Changing one tile changes only its own score and its neighbours', so a move is scored on
    // those nine tiles at most instead of the whole plot.
    const touched = neighbours.map((near, i) => [i].concat(near));
    const nearby = (layout, i) => {
        let total = 0;
        for (const j of touched[i]) {
            if (layout[j] !== -1) continue;
            count(layout, j);
            total += tileChance(code) + SHAPING * around * around;
        }
        return total;
    };

    const random = lcg(seed);
    let best = { layout: new Array(n).fill(-1), score: 0, shaped: -1 };
    for (let r = 0; r < restarts; r++) {
        // Start from a random layout with about a third of the tiles planted.
        const layout = tiles.map(() => (random() < 0.35 ? Math.floor(random() * parents.length) : -1));
        let current = score(layout);
        let improved = true;
        while (improved) {
            improved = false;
            for (let i = 0; i < n; i++) {
                const keep = layout[i];
                const before = nearby(layout, i);
                for (let choice = -1; choice < parents.length; choice++) {
                    if (choice === keep) continue;
                    layout[i] = choice;
                    const s = current - before + nearby(layout, i);
                    if (s > current + 1e-12) {
                        current = s;
                        improved = true;
                        break;
                    }
                    layout[i] = keep;
                }
            }
        }
        // Scored afresh: a sum kept up move by move drifts in the last bits, enough to break ties.
        const real = score(layout, false);
        const shaped = score(layout);
        if (real > best.score || (real === best.score && shaped > best.shaped)) best = { layout: layout.slice(), score: real, shaped };
    }
    return { layout: best.layout.map((v) => (v === -1 ? null : parents[v])), score: best.score };
}

/**
 * Average growth per garden tick of a plant (minigameGarden.js:1886): ageTick plus half of the
 * random extra, scaled by the plot's aging boost.
 */
export function agePerTick(plant, boost = 1) {
    return (plant.ageTick + plant.ageTickR / 2) * boost;
}

/**
 * What a layout is expected to cost in seeds before its target appears, and how long that takes.
 * A planting succeeds if a mutation lands while every parent is mature: with `score` the summed
 * chance a tick over the empty tiles, a window of w mature ticks succeeds with 1 - e^(-score × w),
 * and each failure pays for the mortal parents again. Seeds come out of a pot that fills at
 * `budgetRate` cookies a second, and nothing is planted until the pot covers the whole layout
 * (plantGroup), so the first planting waits for the saving; a later one waits for the pot to
 * save the replanting again, or for the planting before it to die, whichever is later.
 *
 * @param {object} a
 * @param {number} a.score        summed chance of the target per tick
 * @param {number} a.cost         cookies to plant what the layout still lacks
 * @param {number} a.replantCost  cookies to plant its mortal parents again
 * @param {number} a.growTicks    ticks from planting until the last parent is mature
 * @param {number} [a.regrowTicks=growTicks]  the same for a replanting, which starts from seed
 * @param {number} a.windowTicks  ticks the parents stay mature together; Infinity when immortal
 * @param {number} a.growSeconds  seconds per tick while growing
 * @param {number} a.waitSeconds  seconds per tick while waiting for the mutation
 * @param {number} a.budgetRate   cookies a second the garden may spend
 * @param {number} [a.saved=0]    cookies already in the pot
 * @returns {{cost: number, seconds: number}}  seconds is Infinity when the pot can never pay
 */
export function expectedUnlock({ score, cost, replantCost, growTicks, regrowTicks = growTicks, windowTicks, growSeconds, waitSeconds, budgetRate, saved = 0 }) {
    if (!(score > 0)) return { cost: Infinity, seconds: Infinity };
    const mortal = Number.isFinite(windowTicks);
    const plantings = mortal ? 1 / (1 - Math.exp(-score * windowTicks)) : 1;
    const spend = cost + replantCost * (plantings - 1);
    const save = cost > saved ? (budgetRate > 0 ? (cost - saved) / budgetRate : Infinity) : 0;
    const lastWait = (mortal ? Math.min(windowTicks, 1 / score) : 1 / score) * waitSeconds;
    let seconds = save + growTicks * growSeconds + lastWait;
    if (plantings > 1) {
        // The pot saves for the next planting while the failed one grows and waits.
        const refill = replantCost > 0 ? (budgetRate > 0 ? replantCost / budgetRate : Infinity) : 0;
        seconds += (plantings - 1) * Math.max(regrowTicks * growSeconds + windowTicks * waitSeconds, refill);
    }
    return { cost: spend, seconds };
}

/**
 * What a layout still needs before its first planting, with some parents perhaps growing in
 * place already. Such a parent costs nothing and is further along, but only if it is still alive
 * when the rest has been paid for and grown: otherwise it dies waiting and is bought again.
 * Ages and lifetimes are in ticks.
 *
 * @param {object} a
 * @param {Array<{price: number, grow: number, life: number, age: number|null}>} a.parents
 *   one per parent tile; grow: ticks from seed to mature; life: ticks a seed lives, Infinity when
 *   immortal; age: ticks the parent in place has grown, or null when the tile lacks it
 * @param {number} [a.saved=0]    cookies already in the pot
 * @param {number} a.budgetRate   cookies a second the pot fills
 * @param {number} a.tickSeconds  seconds a tick lasts meanwhile
 * @returns {{cost: number, replantCost: number, growTicks: number, regrowTicks: number, windowTicks: number}}
 *   growTicks count from the first planting, after the saving
 */
export function layoutCost({ parents, saved = 0, budgetRate, tickSeconds }) {
    const kept = parents.map((p) => p.age !== null && p.age !== undefined);
    for (;;) {
        let cost = 0;
        for (let i = 0; i < parents.length; i++) if (!kept[i]) cost += parents[i].price;
        const saveTicks = cost > saved ? (budgetRate > 0 ? (cost - saved) / budgetRate / tickSeconds : Infinity) : 0;
        // Ticks from now until every parent is mature.
        let ready = 0;
        parents.forEach((p, i) => (ready = Math.max(ready, kept[i] ? p.grow - p.age : saveTicks + p.grow)));
        let lost = false;
        parents.forEach((p, i) => {
            if (kept[i] && Number.isFinite(p.life) && p.life - p.age <= ready) {
                kept[i] = false;
                lost = true;
            }
        });
        if (lost) continue;
        let replantCost = 0;
        let regrowTicks = 0;
        let windowTicks = Infinity;
        for (const p of parents) {
            if (!Number.isFinite(p.life)) continue;
            replantCost += p.price;
            regrowTicks = Math.max(regrowTicks, p.grow);
            windowTicks = Math.min(windowTicks, p.life - p.grow);
        }
        const growTicks = Number.isFinite(saveTicks) ? Math.max(0, ready - saveTicks) : Math.max(0, ...parents.map((p) => p.grow));
        return { cost, replantCost, growTicks, regrowTicks: regrowTicks || growTicks, windowTicks };
    }
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

/**
 * The seeds to plant this tick: every empty slot plantNow allows, or none. A layout produces only
 * while its parents are mature together, so the group is planted only when
 * - the pot covers the rest of the layout: this group, the slots planted after it, and the
 *   parents that die before it matures and need a new seed. Bought one seed at a time, a slow
 *   parent that takes longer to afford than a planted one lives never fills the layout, and its
 *   faster partner, held back until it does, is never planted. The pot keeps the later groups'
 *   money meanwhile;
 * - the bank above the reserve covers the group;
 * - every parent already planted will be mature alongside it: alive when it matures, or replaced
 *   by a seed that matures before it dies. A fast parent planted just before its slow partner
 *   dies of old age would die before the partner grows again.
 * Ticks are the plant's own ticks; `grow` and `life` are those of a new seed (life Infinity when
 * immortal), `lifeLeft` those of the plant in the slot.
 *
 * @param {Array<{key: string, planted: boolean, ticksLeft: number, lifeLeft: number, grow: number, life: number, cost: number}>} slots
 * @param {{budget: number, spare: number}} money  the pot, and the bank above the reserve
 * @returns {Array} the slots to plant now, all of them or none
 */
export function plantGroup(slots, { budget, spare }) {
    const allowed = plantNow(slots);
    const group = slots.filter((s) => !s.planted && allowed.has(s.key));
    if (!group.length) return [];
    const matures = Math.max(...group.map((s) => s.ticksLeft));
    const dies = Math.min(...group.map((s) => s.life));
    let rest = 0;
    for (const s of slots) {
        if (!s.planted) rest += s.cost;
        else if (s.lifeLeft <= matures) {
            if (s.lifeLeft + s.grow >= dies) return [];
            rest += s.cost;
        }
    }
    const cost = group.reduce((sum, s) => sum + s.cost, 0);
    return rest <= budget && cost <= spare ? group : [];
}
