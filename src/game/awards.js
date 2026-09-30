// What a purchase would unlock or earn, for use inside a what-if. The game does these in its
// buy path and its five-second check, neither of which a what-if can run.

// main.js:16457-16463
const BUILDING_COUNT_ACHIEVEMENTS = [
    [100, 'Builder'],
    [500, 'Architect'],
    [1000, 'Engineer'],
    [2500, 'Lord of Constructs'],
    [5000, 'Grand design'],
    [7500, 'Ecumenopolis'],
    [10000, 'Myriad'],
];

// main.js:16465-16473
const UPGRADE_COUNT_ACHIEVEMENTS = [
    [20, 'Enhancer'],
    [50, 'Augmenter'],
    [100, 'Upgrader'],
    [200, 'Lord of Progress'],
    [300, 'The full picture'],
    [400, "When there's nothing left to add"],
    [500, 'Kaizen'],
    [600, 'Beyond quality'],
    [700, "Oft we mar what's well"],
];

function winThresholds(game, value, table) {
    for (const [threshold, name] of table) if (value >= threshold) game.Win(name);
}

/** After a building's amount changed: its tier upgrades, tier achievements, synergies and the count achievements. */
export function awardForBuildings(game, building) {
    game.UnlockTiered(building);
    winThresholds(game, game.BuildingsOwned, BUILDING_COUNT_ACHIEVEMENTS);
}

/** After an upgrade was bought: the upgrade-count achievements. */
export function awardForUpgrades(game) {
    winThresholds(game, game.UpgradesOwned, UPGRADE_COUNT_ACHIEVEMENTS);
}
