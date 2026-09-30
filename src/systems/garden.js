// Unlocks every seed and sacrifices the garden for sugar lumps, over and over.
//
// A target is a locked plant with a recipe from plantable parents; the layout puts its parents
// where the summed chance over empty tiles is largest; parents are planted so they mature
// together; a mutant of a locked plant is kept until mature and then harvested, which unlocks
// its seed. Meddleweed only appears on bare ground, and brown mold and crumbspore come from
// harvesting old meddleweed, so those three have their own modes.
//
// A seed costs minutes to hours of CpS (minigameGarden.js:1097-1101) and the late parents die and
// are planted again, so a garden that spends whenever it can starves every purchase. Seeds are
// paid for out of a budget, a share of what the bakery earns, and never out of the buyer's
// reserve; a layout is planted only once the budget covers all of it, and the target is the one
// expected to unlock soonest on that budget, saving included.
import { optimizeLayout, agePerTick, expectedUnlock, layoutCost, plantGroup } from '../core/garden.js';
import { gardenOf, plotTiles, chanceFunction, findRecipes, chooseSoil, soilFor } from '../game/garden.js';

const TICK_EVERY = 30; // frames
const OLD_MEDDLEWEED = 90; // age at which harvesting it often leaves a fungus behind
// Laying out one candidate on a full plot takes one to five milliseconds and a replan can have a
// dozen or more, so a replan lays out one candidate a tick: a plan is ready within half a minute,
// against garden ticks of three to five minutes.
const LAYOUTS_PER_TICK = 1;
const LAYOUT_MEMO = 500;

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings  autoGarden; auto100ConsistencyCombo, which plants a garden of its own
 * @param {object} deps.loop
 * @param {() => number} [deps.reserve]  cookies the buyer is holding back
 * @param {(what: string) => void} [deps.log]
 */
export function createGarden({ game, settings, loop, reserve = () => 0, log = () => {} }) {
    // seedShare: the most of what the bakery earns that seeds may take, on average. What seeds
    // take is not reinvested, so a share costs most while purchases compound fast. Luck-free with
    // autoBuy on, from a 1e10 bank with the buyer holding a reserve: in three game hours the
    // garden with no limit spent 13% of income (29% in the first hour) and cost 18% of cookies
    // earned; a tenth cost 6%. From a 1e14 bank it cost nothing in three hours and 5% in twelve,
    // with 8 of 34 seeds unlocked; a quarter unlocked no more, since early seeds wait on growth
    // and chance rather than money. The pot holds one planting, more than any one seed, so the
    // share spaces seeds out and never rules one out.
    const options = { seedShare: 0.1 };
    const state = {
        plan: null,
        planning: null,
        unlocked: 0,
        sacrifices: 0,
        planted: 0,
        harvested: 0,
        budget: 0,
        spent: 0,
        earnedAt: null,
        lastFrame: -Infinity,
    };
    const layouts = new Map();

    const buffRunning = () => Object.values(game.buffs).some((b) => b.multCpS > 1);
    const plantAt = (M, x, y) => {
        const tile = M.plot[y][x];
        return tile[0] > 0 ? { plant: M.plantsById[tile[0] - 1], age: tile[1] } : null;
    };
    const tileKey = (t) => `${t.x},${t.y}`;

    /** Tiles holding a plant we have no seed for yet, and the plants they secure. */
    function securedNow(M) {
        const tiles = new Set();
        const plants = new Set();
        for (const t of plotTiles(M)) {
            const here = plantAt(M, t.x, t.y);
            if (here && !here.plant.unlocked) {
                tiles.add(tileKey(t));
                plants.add(here.plant.key);
            }
        }
        return { tiles, plants };
    }

    /** Cookies to plant the plan's whole layout at today's prices. */
    function planCost(M, plan) {
        let cost = 0;
        for (const key of plan.layout) if (key) cost += M.getCost(M.plants[key]);
        return cost;
    }

    // Seed money: a share of what the bakery earned since the last tick. The pot holds at most one
    // full planting of the plan, so a garden with nothing to plant does not save a day's share to
    // spend at once. Time the system was not running earns nothing, and an ascension (which
    // resets cookies earned) only moves the mark.
    function accrue(frame, cap) {
        const earned = game.cookiesEarned;
        if (state.earnedAt !== null && frame - state.lastFrame <= TICK_EVERY && earned > state.earnedAt) {
            state.budget += options.seedShare * (earned - state.earnedAt);
        }
        state.earnedAt = earned;
        state.lastFrame = frame;
        state.budget = Math.min(state.budget, cap);
    }

    // A layout depends only on the target, its parents, the tiles and the rolls a tick.
    function layoutFor(M, target, parents, tiles, loops) {
        const key = [target, parents.join('+'), loops, tiles.map(tileKey).join(' ')].join('|');
        let out = layouts.get(key);
        const fresh = !out;
        if (fresh) {
            if (layouts.size >= LAYOUT_MEMO) layouts.clear();
            out = optimizeLayout({ tiles, parents, chance: chanceFunction(M, target, loops) });
            layouts.set(key, out);
        }
        return { ...out, fresh };
    }

    /** A parent tile as plantGroup and layoutCost see it, in ticks of the plant's own growth. */
    function parentSlot(M, key, t, age) {
        const plant = M.plants[key];
        const perTick = agePerTick(plant);
        const life = plant.immortal ? Infinity : 100 / perTick; // dies at age 100 (minigameGarden.js:1886-1890)
        const planted = age !== null;
        const grown = planted ? age / perTick : 0;
        return {
            key,
            planted,
            grown,
            ticksLeft: Math.max(0, plant.mature / perTick - grown),
            lifeLeft: life - grown,
            grow: plant.mature / perTick,
            life,
            cost: M.getCost(plant),
            x: t.x,
            y: t.y,
        };
    }

    /**
     * What a layout is expected to cost and how long it takes, on the budget. Parents already
     * growing where the layout wants them cost nothing more and are further along, if they live
     * until the rest has been saved for and grown.
     */
    function appraise(M, tiles, layout, score) {
        const parents = [];
        tiles.forEach((t, i) => {
            const key = layout[i];
            if (!key) return;
            const here = plantAt(M, t.x, t.y);
            const s = parentSlot(M, key, t, here && here.plant.key === key ? here.age : null);
            parents.push({ price: s.cost, grow: s.grow, life: s.life, age: s.planted ? s.grown : null });
        });
        const fertilizer = M.parent.amount >= M.soils.fertilizer.req;
        // Growing on fertilizer if the farms allow it, waiting on wood chips or dirt (both five
        // minutes a tick; minigameGarden.js:877-929).
        const growSeconds = 60 * (fertilizer ? M.soils.fertilizer.tick : M.soils.dirt.tick);
        // Seed prices are minutes of CpS, so CpS is the unit the budget is measured in.
        const budgetRate = options.seedShare * game.cookiesPs;
        const needs = layoutCost({ parents, saved: state.budget, budgetRate, tickSeconds: growSeconds });
        return expectedUnlock({ score, ...needs, growSeconds, waitSeconds: 60 * M.soils.dirt.tick, budgetRate, saved: state.budget });
    }

    // Soonest first; between equals, cheaper, then likelier.
    const better = (a, b) =>
        a.value.seconds < b.value.seconds ||
        (a.value.seconds === b.value.seconds && (a.value.cost < b.value.cost || (a.value.cost === b.value.cost && a.score > b.score)));

    /** A replan in steps: first the candidates, then one layout a tick (see LAYOUTS_PER_TICK). */
    function startPlan(M) {
        // A locked plant already growing somewhere is secured: it will unlock when it matures,
        // so the rest of the plot works on the next target meanwhile.
        const secured = securedNow(M);
        const tiles = plotTiles(M).filter((t) => !secured.tiles.has(tileKey(t)));
        const recipes = findRecipes(M);
        const candidates = [];
        for (const plant of Object.values(M.plants)) {
            if (plant.unlocked || secured.plants.has(plant.key)) continue;
            for (const recipe of recipes[plant.key] || []) candidates.push({ target: plant.key, parents: recipe.parents });
        }
        return { secured, tiles, candidates, next: 0, best: null, loops: M.parent.amount >= M.soils.woodchips.req ? 3 : 1 };
    }

    /** Lays out candidates until the tick's share is used; the finished plan, or null. */
    function stepPlan(M, job) {
        let layoutsLeft = LAYOUTS_PER_TICK;
        while (job.next < job.candidates.length && layoutsLeft > 0) {
            const { target, parents } = job.candidates[job.next++];
            const { layout, score, fresh } = layoutFor(M, target, parents, job.tiles, job.loops);
            if (fresh) layoutsLeft--;
            // No layout of these tiles produces it (a ring of eight on a 2×2 plot): not a target.
            if (!(score > 0)) continue;
            // One the budget cannot pay for scores Infinity and loses to any other; it is still
            // better than nothing, since a pot that cannot pay plants nothing (plantGroup), and
            // a budget of nothing can be a passing moment (Cursed finger stops CpS for seconds,
            // main.js:13920-13933).
            const candidate = { target, parents, layout, score, value: appraise(M, job.tiles, layout, score) };
            if (!job.best || better(candidate, job.best)) job.best = candidate;
        }
        return job.next < job.candidates.length ? null : finishPlan(M, job);
    }

    function finishPlan(M, { secured, tiles, best }) {
        const stamp = M.plantsUnlockedN;
        if (best) {
            const minutes = best.value.cost / Math.max(game.cookiesPs, 1) / 60;
            log(
                `garden: aiming for ${M.plants[best.target].name} from ${best.parents.map((k) => M.plants[k].name).join(' + ')}, ` +
                    `${(best.score * 100).toFixed(2)}% a tick, about ${minutes.toFixed(0)} minutes of CpS in seeds`
            );
            return { mode: 'breed', target: best.target, parents: best.parents, tiles, layout: best.layout, stamp };
        }
        if (!M.plants.meddleweed.unlocked && !secured.plants.has('meddleweed')) {
            return { mode: 'fallow', target: 'meddleweed', tiles, layout: tiles.map(() => null), stamp };
        }
        const fungus = ['brownMold', 'crumbspore'].find((k) => !M.plants[k].unlocked && !secured.plants.has(k));
        if (fungus && M.plants.meddleweed.unlocked) return { mode: 'weeds', target: fungus, tiles, layout: tiles.map(() => 'meddleweed'), stamp };
        // Nothing left to aim for, or nothing this plot can reach: wait for what is growing.
        return { mode: 'wait', target: null, tiles, layout: tiles.map(() => null), stamp };
    }

    function stale(M) {
        const plan = state.plan;
        if (!plan) return true;
        const secured = securedNow(M);
        return (
            plan.stamp !== M.plantsUnlockedN ||
            (plan.target && (M.plants[plan.target].unlocked || secured.plants.has(plan.target))) ||
            [...secured.tiles].some((k) => plan.tiles.some((t) => tileKey(t) === k)) ||
            plan.tiles.length + secured.tiles.size !== plotTiles(M).length
        );
    }

    /** Harvests every mature plant we have no seed for, wherever it grows: that unlocks the seed. */
    function harvestMature(M) {
        for (const t of plotTiles(M)) {
            const here = plantAt(M, t.x, t.y);
            if (!here || here.plant.unlocked || here.age < here.plant.mature) continue;
            M.harvest(t.x, t.y);
            state.harvested++;
            log(`garden: harvested a mature ${here.plant.name}, seed unlocked`);
        }
    }

    function tend(M, plan) {
        const slots = [];
        harvestMature(M);
        plan.tiles.forEach((t, i) => {
            const planned = plan.layout[i];
            const here = plantAt(M, t.x, t.y);
            if (here) {
                const { plant, age } = here;
                // A plant we have no seed for: kept until it can be harvested for the seed.
                if (!plant.unlocked) return;
                if (planned === plant.key) {
                    if (plan.mode === 'weeds' && age >= OLD_MEDDLEWEED) M.harvest(t.x, t.y);
                    else slots.push(parentSlot(M, planned, t, age));
                    return;
                }
                M.harvest(t.x, t.y); // weeds, stray mutations of plants already unlocked
                return;
            }
            if (planned) slots.push(parentSlot(M, planned, t, null));
        });

        // Seeds cost minutes of the current, buffed CpS: plant only between buffs.
        if (buffRunning()) return slots;
        // Never into what the buyer holds back.
        const spare = () => game.cookies - reserve();
        // A meddleweed is harvested old for a chance of a fungus on its own, so each is bought
        // alone; a layout's parents are bought as plantGroup allows, all of a group at once.
        const buy = plan.mode === 'weeds' ? slots.filter((s) => !s.planted) : plantGroup(slots, { budget: state.budget, spare: spare() });
        for (const slot of buy) {
            const plant = M.plants[slot.key];
            const cost = M.getCost(plant);
            // Out of the garden's own money.
            if (cost > state.budget || cost > spare()) break;
            if (M.useTool(plant.id, slot.x, slot.y)) {
                state.planted++;
                state.budget -= cost;
                state.spent += cost;
            }
        }
        return slots;
    }

    // Fertilizer ticks every 3 minutes, so parents grow up sooner. Wood chips tick every 5 but roll
    // for mutations three times a tick: per tick of aging that is three chances against one, so
    // once most parents are mature, wood chips (minigameGarden.js:877-928). The wanted soil is
    // chosen first, falling back only to what the farms unlock; a soil already in use is kept.
    function soil(M, plan, slots) {
        let wanted = ['fertilizer', 'dirt'];
        if (plan.mode === 'breed' && slots.length) {
            const mature = slots.filter((s) => s.planted && s.ticksLeft <= 0).length;
            if (mature * 2 >= slots.length) wanted = ['woodchips', 'fertilizer', 'dirt'];
        }
        return chooseSoil(M, soilFor(M, wanted));
    }

    function tick(frame) {
        const M = gardenOf(game);
        accrue(frame, M && state.plan ? planCost(M, state.plan) : 0);
        if (!M || M.freeze || game.OnAscend) return;
        state.unlocked = M.plantsUnlockedN;

        if (M.plantsUnlockedN >= M.plantsN) {
            M.convert();
            state.sacrifices++;
            state.plan = null;
            state.planning = null;
            log('garden: every seed unlocked; sacrificed the garden for 10 sugar lumps');
            return;
        }
        if (state.planning || stale(M)) {
            // Nothing is planted for a plan being replaced, but seeds are still collected.
            harvestMature(M);
            // The recipe search has a tick to itself; layouts follow, one a tick.
            if (!state.planning) {
                state.planning = startPlan(M);
                return;
            }
            const plan = stepPlan(M, state.planning);
            if (!plan) return;
            state.planning = null;
            state.plan = plan;
        }
        const slots = tend(M, state.plan);
        soil(M, state.plan, slots);
    }

    // The inherited consistency combo plants whiskerblooms and harvests the garden itself.
    loop.add('garden', tick, { everyFrames: TICK_EVERY, enabled: () => settings.autoGarden == 1 && settings.auto100ConsistencyCombo != 1 });

    return {
        options,
        report() {
            const M = gardenOf(game);
            return {
                unlocked: M ? M.plantsUnlockedN : 0,
                of: M ? M.plantsN : 0,
                target: state.plan ? state.plan.target : null,
                mode: state.planning ? 'planning' : state.plan ? state.plan.mode : null,
                sacrifices: state.sacrifices,
                planted: state.planted,
                harvested: state.harvested,
                budget: state.budget,
                spent: state.spent,
            };
        },
    };
}
