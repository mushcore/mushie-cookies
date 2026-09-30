// Reads the live game into the inputs of src/core/combos.js, for the combo system and the income
// model alike, so that both value Godzamok the same way.
import { devastationPerBuilding, godzamokOn, saleOptions } from '../core/combos.js';

/** Frames between the combo system's sales: about as often as a player clicks "sell" then "buy". */
export const CYCLE_FRAMES = 15;

/**
 * One of each building is kept. Selling the last Grandma collects every wrinkler and takes the
 * Elder Pledge away (main.js:8785-8794); selling the last of any building greys out its row
 * (main.js:7880). Keeping one costs one unit of Devastation per building.
 */
export const KEEP = 1;

// Never sold: fewer Wizard towers lower the grimoire's maximum magic, and mana above it is lost
// on the minigame's next tick (minigameGrimoire.js:263-287, 485). The grimoire owns the towers.
const NEVER_SOLD = new Set(['Wizard tower']);

/** Godzamok's slot level: 1 diamond, 2 ruby, 3 jade; false or 0 when he is not slotted. */
export function godzamokLevel(game) {
    return game.hasGod ? game.hasGod('ruin') : 0;
}

/** Every building the combo may sell, priced the way the game prices it (main.js:7791-7824). */
export function sellableBuildings(game) {
    const out = [];
    for (const b of game.ObjectsById) {
        if (NEVER_SOLD.has(b.name) || !(b.amount > KEEP)) continue;
        out.push({
            id: b.id,
            name: b.name,
            amount: b.amount,
            keep: KEEP,
            free: b.free || 0,
            // modifyBuildingPrice is a product of discounts, the same for every unit.
            unitPrice: game.modifyBuildingPrice(b, b.basePrice),
            inc: game.priceIncrease,
            sellMult: b.getSellMultiplier(),
        });
    }
    return out;
}

/**
 * What the income model needs to value Godzamok (src/core/income.js): nothing unless the combo
 * system sells for him and he is slotted.
 * @param {object} settings  autoGodzamok, autoClick and the inherited combos
 */
export function devastationState(game, settings) {
    const perBuilding = godzamokOn(settings) ? devastationPerBuilding(godzamokLevel(game)) : 0;
    return {
        perBuilding,
        options: perBuilding > 0 ? saleOptions(sellableBuildings(game)) : [],
        cycleSeconds: CYCLE_FRAMES / game.fps,
    };
}
