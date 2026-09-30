// A fake of the game's collections for unit tests of what purchases earn; `wins`, `unlocks`
// and `tiered` record what happened.

export const NAMES = [
    'Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower', 'Shipment', 'Alchemy lab',
    'Portal', 'Time machine', 'Antimatter condenser', 'Prism', 'Chancemaker', 'Fractal engine', 'Javascript console',
    'Idleverse', 'Cortex baker', 'You',
];
export const KITTENS = Array.from({ length: 12 }, (_, i) => `Kitten ${i}`);
export const GRANDMA_TYPES = Array.from({ length: 16 }, (_, i) => `Grandma type ${i}`);

/** Just enough of the game's collections for the award rules; `won` and `unlocked` record what happened. */
export function fakeGame({ amount = 0, amounts = {}, bought = [], won = [], upgradesOwned = 0 } = {}) {
    const game = {
        ObjectsById: [],
        Objects: {},
        Achievements: {},
        Upgrades: {},
        UpgradesOwned: upgradesOwned,
        BuildingsOwned: 0,
        elderWrath: 0,
        pledges: 0,
        ascensionMode: 0,
        UpgradesByPool: { kitten: KITTENS.map((name) => ({ name })) },
        GrandmaSynergies: GRANDMA_TYPES.slice(),
        Tiers: { fortune: { upgrades: [] } },
        wins: [],
        unlocks: [],
        tiered: [],
        Has(name) {
            return this.Upgrades[name] ? this.Upgrades[name].bought : 0;
        },
        HasAchiev(name) {
            return this.Achievements[name] ? this.Achievements[name].won : 0;
        },
        Win(name) {
            const it = this.Achievements[name] || (this.Achievements[name] = { won: 0 });
            if (it.won) return;
            it.won = 1;
            this.wins.push(name);
        },
        Unlock(name) {
            const it = this.Upgrades[name] || (this.Upgrades[name] = { bought: 0, unlocked: 0 });
            if (it.unlocked) return;
            it.unlocked = 1;
            this.unlocks.push(name);
        },
        // The game's buy functions call it; recorded so a test can see a buy function ran.
        UnlockTiered(building) {
            this.tiered.push(building.name);
        },
    };
    NAMES.forEach((name, id) => {
        const building = { name, id, amount: name in amounts ? amounts[name] : amount };
        building.buyFunction = function () {
            game.UnlockTiered(this);
        };
        game.ObjectsById.push(building);
        game.Objects[name] = building;
    });
    // The cursor's buy function wins the cursor count achievements (main.js:8718).
    game.Objects['Cursor'].buyFunction = function () {
        game.UnlockTiered(this);
        if (this.amount >= 50) game.Win('Mouse wheel');
        if (this.amount >= 200) game.Win('The Digital');
    };
    game.BuildingsOwned = game.ObjectsById.reduce((s, b) => s + b.amount, 0);
    for (const name of bought) game.Upgrades[name] = { bought: 1, unlocked: 1 };
    for (const name of won) game.Achievements[name] = { won: 1 };
    game.wins = [];
    return game;
}

export function buy(game, name, n = 1) {
    const b = game.Objects[name];
    b.amount += n;
    game.BuildingsOwned += n;
    return b;
}
