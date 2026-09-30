// Unlocks every seed and sacrifices the garden for sugar lumps, over and over.
//
// A target is a locked plant with a recipe from plantable parents; the layout puts its parents
// where the summed chance over empty tiles is largest; parents are planted so they mature
// together; a mutant of a locked plant is kept until mature and then harvested, which unlocks
// its seed. Meddleweed only appears on bare ground, and brown mold and crumbspore come from
// harvesting old meddleweed, so those three have their own modes.
import { optimizeLayout, agePerTick, plantNow } from '../core/garden.js';
import { gardenOf, plotTiles, chanceFunction, findRecipe, chooseSoil } from '../game/garden.js';

const TICK_EVERY = 30; // frames
const OLD_MEDDLEWEED = 90; // age at which harvesting it often leaves a fungus behind

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings  autoGarden
 * @param {object} deps.loop
 * @param {(what: string) => void} [deps.log]
 */
export function createGarden({ game, settings, loop, log = () => {} }) {
    const state = { plan: null, unlocked: 0, sacrifices: 0, planted: 0, harvested: 0 };

    const buffRunning = () => Object.values(game.buffs).some((b) => b.multCpS > 1);
    const plantAt = (M, x, y) => {
        const tile = M.plot[y][x];
        return tile[0] > 0 ? { plant: M.plantsById[tile[0] - 1], age: tile[1] } : null;
    };

    /** Tiles holding a plant we have no seed for yet, and the plants they secure. */
    function securedNow(M) {
        const tiles = new Set();
        const plants = new Set();
        for (const t of plotTiles(M)) {
            const here = plantAt(M, t.x, t.y);
            if (here && !here.plant.unlocked) {
                tiles.add(`${t.x},${t.y}`);
                plants.add(here.plant.key);
            }
        }
        return { tiles, plants };
    }

    function choosePlan(M) {
        // A locked plant already growing somewhere is secured: it will unlock when it matures,
        // so the rest of the plot works on the next target meanwhile.
        const secured = securedNow(M);
        const tiles = plotTiles(M).filter((t) => !secured.tiles.has(`${t.x},${t.y}`));
        const locked = Object.values(M.plants).filter((p) => !p.unlocked && !secured.plants.has(p.key));
        let best = null;
        for (const plant of locked) {
            const recipe = findRecipe(M, plant.key);
            if (recipe && (!best || recipe.best > best.recipe.best)) best = { target: plant.key, recipe };
        }
        if (best) {
            const woodchips = M.parent.amount >= M.soils.woodchips.req;
            const { layout, score } = optimizeLayout({
                tiles,
                parents: best.recipe.parents,
                chance: chanceFunction(M, best.target, woodchips ? 3 : 1),
            });
            log(`garden: aiming for ${M.plants[best.target].name} from ${best.recipe.parents.map((k) => M.plants[k].name).join(' + ')}, ${(score * 100).toFixed(2)}% a tick`);
            return { mode: 'breed', target: best.target, parents: best.recipe.parents, tiles, layout };
        }
        if (!M.plants.meddleweed.unlocked && !secured.plants.has('meddleweed')) {
            return { mode: 'fallow', target: 'meddleweed', tiles, layout: tiles.map(() => null) };
        }
        const fungus = ['brownMold', 'crumbspore'].find((k) => !M.plants[k].unlocked && !secured.plants.has(k));
        if (fungus && M.plants.meddleweed.unlocked) return { mode: 'weeds', target: fungus, tiles, layout: tiles.map(() => 'meddleweed') };
        // Nothing left to aim for but plants already growing: wait for them.
        return { mode: 'wait', target: null, tiles, layout: tiles.map(() => null) };
    }

    function tend(M, plan) {
        const slots = [];
        // Locked plants outside the plan's tiles (secured earlier) are harvested once mature.
        for (const t of plotTiles(M)) {
            const here = plantAt(M, t.x, t.y);
            if (here && !here.plant.unlocked && here.age >= here.plant.mature && !plan.tiles.some((u) => u.x === t.x && u.y === t.y)) {
                M.harvest(t.x, t.y);
                state.harvested++;
                log(`garden: harvested a mature ${here.plant.name}, seed unlocked`);
            }
        }
        plan.tiles.forEach((t, i) => {
            const planned = plan.layout[i];
            const here = plantAt(M, t.x, t.y);
            if (here) {
                const { plant, age } = here;
                const mature = age >= plant.mature;
                if (!plant.unlocked) {
                    // A plant we have no seed for: keep it until it can be harvested for the seed.
                    if (mature) {
                        M.harvest(t.x, t.y);
                        state.harvested++;
                        log(`garden: harvested a mature ${plant.name}, seed unlocked`);
                    }
                    return;
                }
                if (planned === plant.key) {
                    if (plan.mode === 'weeds' && age >= OLD_MEDDLEWEED) M.harvest(t.x, t.y);
                    else slots.push({ key: planned, planted: true, ticksLeft: Math.max(0, (plant.mature - age) / agePerTick(plant)) });
                    return;
                }
                M.harvest(t.x, t.y); // weeds, stray mutations of plants already unlocked
                return;
            }
            if (planned) slots.push({ key: planned, planted: false, ticksLeft: M.plants[planned].mature / agePerTick(M.plants[planned]), x: t.x, y: t.y });
        });

        // Seeds cost minutes of the current, buffed CpS: plant only between buffs.
        if (buffRunning()) return slots;
        const allowed = plantNow(slots);
        for (const slot of slots) {
            if (slot.planted || !allowed.has(slot.key)) continue;
            const plant = M.plants[slot.key];
            if (!M.canPlant(plant)) continue;
            if (M.useTool(plant.id, slot.x, slot.y)) state.planted++;
        }
        return slots;
    }

    // Fertilizer ticks every 3 minutes, so parents grow up sooner. Wood chips tick every 5 but roll
    // for mutations three times a tick: per tick of aging that is three chances against one, so
    // once most parents are mature, wood chips (minigameGarden.js:877-928).
    function soil(M, plan, slots) {
        if (plan.mode !== 'breed' || !slots.length) return chooseSoil(M, 'fertilizer') || chooseSoil(M, 'dirt');
        const mature = slots.filter((s) => s.planted && s.ticksLeft <= 0).length;
        if (mature * 2 >= slots.length) return chooseSoil(M, 'woodchips') || chooseSoil(M, 'fertilizer');
        return chooseSoil(M, 'fertilizer');
    }

    function tick() {
        const M = gardenOf(game);
        if (!M || M.freeze || game.OnAscend) return;
        state.unlocked = M.plantsUnlockedN;

        if (M.plantsUnlockedN >= M.plantsN) {
            M.convert();
            state.sacrifices++;
            state.plan = null;
            log('garden: every seed unlocked; sacrificed the garden for 10 sugar lumps');
            return;
        }
        const secured = securedNow(M);
        const stale =
            !state.plan ||
            (state.plan.target && (M.plants[state.plan.target].unlocked || secured.plants.has(state.plan.target))) ||
            [...secured.tiles].some((k) => state.plan.tiles.some((t) => `${t.x},${t.y}` === k)) ||
            state.plan.tiles.length + secured.tiles.size !== plotTiles(M).length;
        if (stale) state.plan = choosePlan(M);
        if (!state.plan) return;
        const slots = tend(M, state.plan);
        soil(M, state.plan, slots || []);
    }

    loop.add('garden', tick, { everyFrames: TICK_EVERY, enabled: () => settings.autoGarden == 1 });

    return {
        report() {
            const M = gardenOf(game);
            return {
                unlocked: M ? M.plantsUnlockedN : 0,
                of: M ? M.plantsN : 0,
                target: state.plan ? state.plan.target : null,
                mode: state.plan ? state.plan.mode : null,
                sacrifices: state.sacrifices,
                planted: state.planted,
                harvested: state.harvested,
            };
        },
    };
}
