// What the buyer may consider buying right now, each with its price and an `apply` that
// makes the purchase inside a what-if.
import { awardForBuildings, awardForUpgrades, pendingAwards } from './awards.js';
import { wrinklerParams, spawnPerSecond } from './wrinklers.js';
import { gapCost } from '../core/wrinklers.js';

/** Upgrades the buyer never buys by itself: selectors, switches and decisions other systems own. */
export const NEVER_BUY = new Set([
    74, // Elder Pledge: bought only as part of the elder plan below
    84, // Elder Covenant: likewise
    85, // Revoke Elder Covenant: likewise
    227, // Chocolate egg: sold-buildings trick before ascending
    331, 332, // Golden switch
    333, // Milk selector
    361, // Golden cookie sound selector
    414, // Background selector
    452, // Sugar frenzy: costs a lump, switched on by the lump system (src/systems/lumps.js)
    563, 564, // Shimmering veil
    806, // Jukebox
]);

/** The research line's side effect on the grandmapocalypse stage (main.js:10066-10072). */
const WRATH_STAGE = { 'One mind': 1, 'Communal brainsweep': 2, 'Elder Pact': 3 };

const STORE_POOLS = new Set(['', 'cookie', 'tech']);

function buildingCandidate(game, building, pending) {
    return {
        key: `building:${building.name}`,
        kind: 'building',
        name: building.name,
        building,
        price: building.getPrice(),
        apply() {
            building.amount += 1;
            building.bought += 1;
            game.BuildingsOwned += 1;
            awardForBuildings(game, building, pending);
        },
    };
}

function applyUpgrade(game, upgrade, pending) {
    upgrade.bought = 1;
    game.UpgradesOwned += 1;
    if (WRATH_STAGE[upgrade.name]) game.elderWrath = WRATH_STAGE[upgrade.name];
    awardForUpgrades(game, pending);
}

function upgradeCandidate(game, upgrade, pending) {
    return {
        key: `upgrade:${upgrade.id}`,
        kind: 'upgrade',
        name: upgrade.name,
        upgrade,
        price: upgrade.getPrice(),
        apply: () => applyUpgrade(game, upgrade, pending),
    };
}

/**
 * A locked upgrade that buying a few more buildings would unlock, as one purchase: the buildings
 * and the upgrade together. `needs` maps building ids to the count that unlocks it.
 */
function chainCandidate(game, upgrade, needs, reach = Infinity, pending = undefined) {
    const steps = [];
    for (const [id, count] of needs) {
        const building = game.ObjectsById[id];
        const missing = count - building.amount;
        if (missing > 0) steps.push({ building, missing });
    }
    if (!steps.length) return null;
    const total = steps.reduce((sum, s) => sum + s.missing, 0);
    // Out of reach: skip before pricing, which loops once per missing building (main.js:7797).
    if (total > reach) return null;
    const price = steps.reduce((sum, s) => sum + s.building.getSumPrice(s.missing), 0) + upgrade.getPrice();
    return {
        key: `chain:${upgrade.id}`,
        kind: 'chain',
        name: steps.map((s) => `${s.missing} × ${s.building.name}`).join(' + ') + ` + ${upgrade.name}`,
        upgrade,
        steps,
        missing: total,
        price,
        apply() {
            for (const { building, missing } of steps) {
                building.amount += missing;
                building.bought += missing;
                game.BuildingsOwned += missing;
                awardForBuildings(game, building, pending);
            }
            applyUpgrade(game, upgrade, pending);
        },
    };
}

/**
 * What unlocks each locked upgrade. Upgrades in the prerequisite table use it; building tier
 * upgrades missing from it fall back to their tier's threshold. The table matters: some tier
 * upgrades unlock at other counts than their tier says (Billion fingers is tier 6, whose
 * threshold is 150, but cursors unlock it at 100: main.js:8707).
 */
function chainTargets(game, prerequisites, excludedBuildings) {
    const targets = new Map();
    for (const [key, entry] of Object.entries(prerequisites || {})) {
        const upgrade = game.UpgradesById[key];
        if (!upgrade || upgrade.bought || upgrade.unlocked) continue;
        if ((entry.upgrades || []).some((id) => !game.UpgradesById[id] || !game.UpgradesById[id].bought)) continue;
        const needs = [];
        let blocked = false;
        (entry.buildings || []).forEach((count, id) => {
            if (!count) return;
            if (excludedBuildings.has(id)) blocked = true;
            needs.push([id, count]);
        });
        if (!blocked && needs.length) targets.set(upgrade.id, { upgrade, needs });
    }
    for (const building of game.ObjectsById) {
        if (excludedBuildings.has(building.id)) continue;
        for (const upgrade of Object.values(building.tieredUpgrades || {})) {
            if (upgrade.bought || upgrade.unlocked || targets.has(upgrade.id)) continue;
            const threshold = game.Tiers[upgrade.tier].unlock;
            if (threshold === -1) continue;
            targets.set(upgrade.id, { upgrade, needs: [[building.id, threshold]] });
        }
    }
    return targets.values();
}

const PLEDGE = 'Elder Pledge';
const COVENANT = 'Elder Covenant';
const REVOKE = 'Revoke Elder Covenant';
const PLEDGE_PRICE_CAP = 14; // price 8^min(pledges+2, 14) (main.js:10086)
// game -> {pledge, covenant}: the pledge count when the elder plan last put either on sale.
const lastOffered = new WeakMap();

/**
 * Elder nap, Elder slumber and Elder calm as one purchase: pledges until five are made
 * (main.js:16500-16501), each ended at once by an Elder Covenant, which wins Elder calm
 * (main.js:10121), and its revoke. Waiting a pledge out instead costs half an hour without
 * wrath cookies or wrinklers each time (main.js:10082), while a covenant and its revoke cost
 * under 7e13, a few hundredths of a percent of the Elder Pact the pledge needs (2.56e17).
 * The plan ends as it began, the covenant revoked, so no 5% of CpS is lost (main.js:5131) and
 * the grandmapocalypse climbs back within a minute or two (main.js:14219-14223).
 *
 * What it forfeits: the pledge and the covenant pop every wrinkler (main.js:10080, 10122,
 * 14285), and their slots refill at the spawn rate, which the price counts as the feeding lost
 * (the wrinkler system's own gap cost). With nothing attached it costs its price alone, so the
 * ranking itself finds the cheap moment: a run's start, a season hunt, just after a pop. The
 * three achievements are permanent, so once won nothing more is listed.
 *
 * Its steps follow from the game state, so the plan resumes at any step: a pledge running is
 * ended, a covenant held is revoked. Only the first step is bought; the buyer ranks again, and
 * the next step goes on sale once the store is rebuilt at the end of the frame (main.js:16522).
 * Once the achievements are won, a pledge or covenant is ended only if the plan made it: the
 * five-second check can award Elder slumber between the last pledge and its covenant, and that
 * pledge must not run for half an hour, while one the player made is theirs.
 */
function elderPlan(game, policy, pending) {
    if (!game.Has('Elder Pact') || !(game.Objects['Grandma'].amount > 0)) return null;
    const pledge = game.Upgrades[PLEDGE];
    const covenant = game.Upgrades[COVENANT];
    const revoke = game.Upgrades[REVOKE];
    if (!pledge || !covenant || !revoke) return null;
    const pledgesWanted = !game.HasAchiev('Elder slumber') ? 5 : !game.HasAchiev('Elder nap') ? 1 : 0;
    const calm = !game.HasAchiev('Elder calm');
    const more = Math.max(0, pledgesWanted - game.pledges);
    // At rest, no pledge running and no covenant held, whatever the plan made is ended.
    if (!covenant.bought && !(game.pledgeT > 0)) lastOffered.delete(game);
    const offered = lastOffered.get(game) || {};
    const ours = covenant.bought ? offered.covenant === game.pledges : game.pledgeT > 0 && offered.pledge === game.pledges - 1;
    if (!more && !calm && !ours) return null;

    const steps = [];
    if (covenant.bought) steps.push(revoke);
    else if (game.pledgeT > 0) steps.push(covenant, revoke);
    for (let i = 0; i < more; i++) steps.push(pledge, covenant, revoke);
    if (calm && !steps.includes(covenant)) {
        if (!covenant.unlocked) steps.push(pledge); // a pledge puts the covenant on sale (main.js:10078)
        steps.push(covenant, revoke);
    }
    if (policy.excludedUpgrades === 'all' || steps.some((u) => policy.excludedUpgrades.has(u.id))) return null;
    if (!game.UpgradesInStore.includes(steps[0])) return null;

    // Wrinklers are the wrinkler system's: none are popped for this unless it pops them itself,
    // and never a shiny, which it keeps (src/core/wrinklers.js decidePops).
    const inPlay = game.wrinklers.filter((w) => w.phase > 0);
    if (inPlay.some((w) => w.type == 1)) return null;
    if (inPlay.length && !policy.popsWrinklers) return null;

    const stage = game.Has('One mind') + game.Has('Communal brainsweep') + game.Has('Elder Pact');
    let forfeit = 0;
    const pops = steps.includes(pledge) || steps.includes(covenant);
    const p = wrinklerParams(game);
    if (pops && p.attached > 0) {
        // The refill runs at the stage the wrath returns to, not the 0 of a pledge running.
        forfeit = gapCost({ ...p, count: p.attached, cps: game.unbuffedCps, spawnPerSecond: spawnPerSecond(game, stage) });
    }

    // Each pledge costs eight times the last (main.js:10086); the price scales every factor alike.
    const cap = (n) => Math.min(n + 2, PLEDGE_PRICE_CAP);
    let pledgesMade = 0;
    let price = 0;
    for (const step of steps) {
        if (step === pledge) {
            price += pledge.getPrice() * Math.pow(8, cap(game.pledges + pledgesMade) - cap(game.pledges));
            pledgesMade++;
        } else price += step.getPrice();
    }
    // What the plan last put on sale, for knowing its own pledge or covenant once the goals are met.
    if (steps[0] === pledge) lastOffered.set(game, { ...offered, pledge: game.pledges });
    if (steps[0] === covenant) lastOffered.set(game, { ...offered, covenant: game.pledges });
    const goals = [more > 0 && `${pledgesWanted} pledges`, calm && 'Elder calm'].filter(Boolean);
    return {
        // The buyer sees a purchase by the bank falling, and cools down the key of one that did
        // not: a 64-cookie pledge is lost in the rounding of a bank of 1e19. Naming the pledge
        // count keeps such a pledge, which did go through, from holding the next one back.
        key: `elder:${steps[0].id}:${game.pledges}`,
        kind: 'upgrade',
        name: `${steps[0].name} (elder plan: ${goals.join(', ') || 'end it'})`,
        upgrade: steps[0],
        steps,
        forfeit,
        price: price + forfeit,
        apply() {
            // The state after the last revoke: toggles are not counted as upgrades owned (main.js:9645).
            game.pledges += pledgesMade;
            game.pledgeT = 0;
            pledge.bought = 0;
            pledge.unlocked = 1; // offered again on the next frame (main.js:14225-14229)
            covenant.bought = 0;
            covenant.unlocked = 1;
            revoke.bought = 1;
            revoke.unlocked = 1;
            if (!(game.elderWrath > 0)) game.elderWrath = stage;
            if (steps.includes(covenant)) game.Win('Elder calm');
            awardForUpgrades(game, pending);
        },
    };
}

/**
 * @param {object} policy
 * @param {Set<number>|'all'} policy.excludedBuildings  building ids the settings exclude
 * @param {Set<number>|'all'} policy.excludedUpgrades
 * @param {number} policy.chainReach              how many buildings short a chain may be, in total
 * @param {object} [policy.prerequisites]         upgrade id -> {buildings: [count by building id], upgrades: [ids]}
 * @param {boolean} [policy.popsWrinklers]        the wrinkler system pops wrinklers (autoWrinkler)
 */
export function listCandidates(game, policy) {
    const out = [];
    // Every trial starts from this state, so what is already due is the same for all of them.
    const pending = pendingAwards(game);
    const buildings =
        policy.excludedBuildings === 'all' ? [] : game.ObjectsById.filter((b) => !policy.excludedBuildings.has(b.id));
    for (const building of buildings) out.push(buildingCandidate(game, building, pending));
    if (policy.excludedUpgrades !== 'all') {
        for (const upgrade of game.UpgradesInStore) {
            if (!STORE_POOLS.has(upgrade.pool) || NEVER_BUY.has(upgrade.id) || policy.excludedUpgrades.has(upgrade.id)) continue;
            out.push(upgradeCandidate(game, upgrade, pending));
        }
        const elder = elderPlan(game, policy, pending);
        if (elder) out.push(elder);
        if (policy.excludedBuildings !== 'all') {
            const limits = policy.limits || {};
            for (const { upgrade, needs } of chainTargets(game, policy.prerequisites, policy.excludedBuildings)) {
                if (!STORE_POOLS.has(upgrade.pool) || NEVER_BUY.has(upgrade.id) || policy.excludedUpgrades.has(upgrade.id)) continue;
                // Fortunes come from the news ticker, whatever the building counts say.
                if (upgrade.tier === 'fortune') continue;
                const chain = chainCandidate(game, upgrade, needs, policy.chainReach, pending);
                if (!chain) continue;
                if (chain.steps.some((s) => limits[s.building.id] !== undefined && s.building.amount + s.missing > limits[s.building.id])) continue;
                out.push(chain);
            }
        }
    }
    return out;
}
