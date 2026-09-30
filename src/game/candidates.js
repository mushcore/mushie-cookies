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
    452, // Sugar frenzy
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

/** The next locked tier upgrade of a building, when it is within reach. */
function chainCandidate(game, building, reach) {
    let best = null;
    for (const upgrade of Object.values(building.tieredUpgrades || {})) {
        if (upgrade.bought || upgrade.unlocked) continue;
        const threshold = game.Tiers[upgrade.tier].unlock;
        if (threshold === -1) continue;
        const needed = threshold - building.amount;
        if (needed <= 0 || needed > reach) continue;
        if (!best || needed < best.needed) best = { upgrade, needed };
    }
    if (!best) return null;
    const { upgrade, needed } = best;
    return {
        key: `chain:${upgrade.id}`,
        kind: 'chain',
        name: `${needed} × ${building.name} + ${upgrade.name}`,
        building,
        upgrade,
        steps: needed,
        price: building.getSumPrice(needed) + upgrade.getPrice(),
        apply() {
            building.amount += needed;
            building.bought += needed;
            game.BuildingsOwned += needed;
            awardForBuildings(game, building);
            applyUpgrade(game, upgrade);
        },
    };
}

/**
 * @param {object} policy
 * @param {Set<number>} policy.excludedBuildings  building ids the settings exclude
 * @param {Set<number>|'all'} policy.excludedUpgrades
 * @param {number} policy.chainReach              how many buildings short of a tier a chain may be
 */
export function listCandidates(game, policy) {
    const out = [];
    const buildings = game.ObjectsById.filter((b) => !policy.excludedBuildings.has(b.id));
    if (policy.excludedBuildings !== 'all') {
        for (const building of buildings) out.push(buildingCandidate(game, building));
    }
    if (policy.excludedUpgrades !== 'all') {
        for (const upgrade of game.UpgradesInStore) {
            if (!STORE_POOLS.has(upgrade.pool) || NEVER_BUY.has(upgrade.id) || policy.excludedUpgrades.has(upgrade.id)) continue;
            out.push(upgradeCandidate(game, upgrade));
        }
        if (policy.excludedBuildings !== 'all') {
            for (const building of buildings) {
                const chain = chainCandidate(game, building, policy.chainReach);
                if (chain) out.push(chain);
            }
        }
    }
    return out;
}
