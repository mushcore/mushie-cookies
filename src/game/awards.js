// What a purchase would unlock or earn, for use inside a what-if. The game does these in the
// purchase itself (a building's buy function, main.js:7846) and in its five-second check
// (main.js:16315), which a what-if cannot wait for. Every achievement won here is milk the
// what-if's recalculation then counts.

// main.js:16412-16424: the least-owned building's count, with the biscuit each unlocks.
const CENTENNIALS = [
    [100, 'Centennial', 'Milk chocolate butter biscuit'],
    [150, 'Centennial and a half', 'Dark chocolate butter biscuit'],
    [200, 'Bicentennial', 'White chocolate butter biscuit'],
    [250, 'Bicentennial and a half', 'Ruby chocolate butter biscuit'],
    [300, 'Tricentennial', 'Lavender chocolate butter biscuit'],
    [350, 'Tricentennial and a half', 'Synthetic chocolate green honey butter biscuit'],
    [400, 'Quadricentennial', 'Royal raspberry chocolate butter biscuit'],
    [450, 'Quadricentennial and a half', 'Ultra-concentrated high-energy chocolate butter biscuit'],
    [500, 'Quincentennial', 'Pure pitch-black chocolate butter biscuit'],
    [550, 'Quincentennial and a half', 'Cosmic chocolate butter biscuit'],
    [600, 'Sexcentennial', 'Butter biscuit (with butter)'],
    [650, 'Sexcentennial and a half', 'Everybutter biscuit'],
    [700, 'Septcentennial', 'Personal biscuit'],
];

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

// main.js:16464-16472
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

// main.js:16439 and 16448: a seasonal set is an achievement once all of it is owned.
const SEASONAL_SETS = [
    ['Spooky cookies', ['Skull cookies', 'Ghost cookies', 'Bat cookies', 'Slime cookies', 'Pumpkin cookies', 'Eyeball cookies', 'Spider cookies']],
    ['Let it snow', ['Christmas tree biscuits', 'Snowflake biscuits', 'Snowman biscuits', 'Holly biscuits', 'Candy cane biscuits', 'Bell biscuits', 'Present biscuits']],
];

/**
 * The part of the five-second check a purchase can change, in the game's order
 * (main.js:16355-16502). Wins go to `win` and unlocks to `unlock`, so the same rules can both
 * award a purchase and list what is already due.
 */
function checkPurchaseRules(game, win, unlock) {
    const has = (name) => game.Has(name);
    if (has('Prism heart biscuits')) win('Lovely cookies');
    if (has('Fortune cookies')) {
        const fortunes = game.Tiers['fortune'].upgrades;
        if (fortunes.every((it) => has(it.name))) win('O Fortuna');
    }
    if (game.elderWrath >= 3) win('Grandmapocalypse');

    const buildings = game.ObjectsById;
    const n = buildings.length;
    const checkMathematician = !game.HasAchiev('Mathematician');
    const checkBase10 = !game.HasAchiev('Base 10');
    let owned = 0;
    let least = 100000;
    let mathematician = 1;
    let base10 = 1;
    for (const b of buildings) {
        owned += b.amount;
        least = Math.min(b.amount, least);
        if (checkMathematician && b.amount < Math.min(128, Math.pow(2, n - b.id - 1))) mathematician = 0;
        if (checkBase10 && b.amount < (n - b.id) * 10) base10 = 0;
    }
    if (least >= 1) win('One with everything');
    if (mathematician) win('Mathematician');
    if (base10) win('Base 10');
    for (const [count, name, biscuit] of CENTENNIALS) {
        if (least < count) break;
        win(name);
        unlock(biscuit);
    }

    for (const [name, set] of SEASONAL_SETS) if (set.every(has)) win(name);

    for (const [count, name] of BUILDING_COUNT_ACHIEVEMENTS) if (owned >= count) win(name);
    for (const [count, name] of UPGRADE_COUNT_ACHIEVEMENTS) if (game.UpgradesOwned >= count) win(name);
    if (owned >= 4000 && game.UpgradesOwned >= 300) win('Polymath');
    if (owned >= 8000 && game.UpgradesOwned >= 400) win('Renaissance baker');

    if (!game.HasAchiev('Jellicles')) {
        let kittens = 0;
        for (const it of game.UpgradesByPool['kitten']) if (has(it.name)) kittens++;
        if (kittens >= 10) win('Jellicles');
    }

    let grandmas = 0;
    for (const name of Object.values(game.GrandmaSynergies)) if (has(name)) grandmas++;
    if (grandmas >= 7) win('Elder');
    if (grandmas >= 14) win('Veteran');
    if (game.Objects['Grandma'].amount >= 6 && !has('Bingo center/Research facility') && game.HasAchiev('Elder')) {
        unlock('Bingo center/Research facility');
    }
    if (game.pledges > 0) win('Elder nap');
    if (game.pledges >= 5) win('Elder slumber');
    if (game.pledges >= 10) unlock('Sacrificial rolling pins');
    if (game.Objects['Cursor'].amount + game.Objects['Grandma'].amount >= 777) win('The elder scrolls');
}

const NOTHING_PENDING = new Set();

/**
 * What the next five-second check awards whatever is bought: rules that already hold for
 * something not yet won or unlocked. A purchase must not be credited with these. The buyer
 * ranks again right after a real purchase, often before the check has run, and every candidate
 * would otherwise count the same milk, which favours the dearest.
 */
export function pendingAwards(game) {
    const due = new Set();
    checkPurchaseRules(
        game,
        (name) => {
            if (!game.HasAchiev(name)) due.add(name);
        },
        (name) => {
            const it = game.Upgrades[name];
            if (it && !it.unlocked) due.add(name);
        }
    );
    return due;
}

function awardRules(game, pending) {
    checkPurchaseRules(
        game,
        (name) => {
            if (!pending.has(name)) game.Win(name);
        },
        (name) => {
            if (!pending.has(name)) game.Unlock(name);
        }
    );
}

/**
 * After a building's amount changed: what its buy function does (tier upgrades and
 * achievements, synergies, grandma types, the cursor count achievements of main.js:8718), then
 * the five-second check. `pending` is pendingAwards of the state before the purchase.
 */
export function awardForBuildings(game, building, pending = NOTHING_PENDING) {
    if (building.buyFunction) building.buyFunction.call(building);
    else game.UnlockTiered(building);
    awardRules(game, pending);
}

/** After an upgrade was bought: the five-second check. `pending` as for awardForBuildings. */
export function awardForUpgrades(game, pending = NOTHING_PENDING) {
    awardRules(game, pending);
}
