// What the buyer may consider buying right now, each with its price and an `apply` that
// makes the purchase inside a what-if.
import { awardForBuildings, awardForUpgrades } from './awards.js';

/** Upgrades the buyer never buys by itself: selectors, switches and decisions other systems own. */
export const NEVER_BUY = new Set([
    74, // Elder Pledge: a grandmapocalypse decision, not a purchase
    84, // Elder Covenant
    85, // Revoke Elder Covenant
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

function buildingCandidate(game, building) {
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
            awardForBuildings(game, building);
        },
    };
}

function applyUpgrade(game, upgrade) {
    upgrade.bought = 1;
    game.UpgradesOwned += 1;
    if (WRATH_STAGE[upgrade.name]) game.elderWrath = WRATH_STAGE[upgrade.name];
    awardForUpgrades(game);
}

function upgradeCandidate(game, upgrade) {
    return {
        key: `upgrade:${upgrade.id}`,
        kind: 'upgrade',
        name: upgrade.name,
        upgrade,
        price: upgrade.getPrice(),
        apply: () => applyUpgrade(game, upgrade),
    };
}

/**
 * A locked upgrade that buying a few more buildings would unlock, as one purchase: the buildings
 * and the upgrade together. `needs` maps building ids to the count that unlocks it.
 */
function chainCandidate(game, upgrade, needs, reach = Infinity) {
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
                awardForBuildings(game, building);
            }
            applyUpgrade(game, upgrade);
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

/**
 * @param {object} policy
 * @param {Set<number>|'all'} policy.excludedBuildings  building ids the settings exclude
 * @param {Set<number>|'all'} policy.excludedUpgrades
 * @param {number} policy.chainReach              how many buildings short a chain may be, in total
 * @param {object} [policy.prerequisites]         upgrade id -> {buildings: [count by building id], upgrades: [ids]}
 */
export function listCandidates(game, policy) {
    const out = [];
    const buildings =
        policy.excludedBuildings === 'all' ? [] : game.ObjectsById.filter((b) => !policy.excludedBuildings.has(b.id));
    for (const building of buildings) out.push(buildingCandidate(game, building));
    if (policy.excludedUpgrades !== 'all') {
        for (const upgrade of game.UpgradesInStore) {
            if (!STORE_POOLS.has(upgrade.pool) || NEVER_BUY.has(upgrade.id) || policy.excludedUpgrades.has(upgrade.id)) continue;
            out.push(upgradeCandidate(game, upgrade));
        }
        if (policy.excludedBuildings !== 'all') {
            const limits = policy.limits || {};
            for (const { upgrade, needs } of chainTargets(game, policy.prerequisites, policy.excludedBuildings)) {
                if (!STORE_POOLS.has(upgrade.pool) || NEVER_BUY.has(upgrade.id) || policy.excludedUpgrades.has(upgrade.id)) continue;
                // Fortunes come from the news ticker, whatever the building counts say.
                if (upgrade.tier === 'fortune') continue;
                const chain = chainCandidate(game, upgrade, needs, policy.chainReach);
                if (!chain) continue;
                if (chain.steps.some((s) => limits[s.building.id] !== undefined && s.building.amount + s.missing > limits[s.building.id])) continue;
                out.push(chain);
            }
        }
    }
    return out;
}
