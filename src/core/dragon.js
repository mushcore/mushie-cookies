/**
 * Dragon training and petting decisions. Pure; src/systems/dragon.js measures the auras against
 * the live game and trains or pets the way a player does.
 *
 * Training sacrifices buildings (main.js:14773-14821). A sacrifice refunds nothing and takes the
 * top units, so what it costs is what rebuying them costs. The dragon resets at every ascension
 * (main.js:3537-3539), so a level is worth training only if the income its aura adds repays that
 * within the time the run has left.
 */

/** Game.dragonLevels.length - 1: the level at which the dragon is fully trained. */
export const FULLY_TRAINED = 27;
/** Petting drops something only from this level (main.js:14957). */
export const PET_LEVEL = 8;
/** The second aura slot opens here (main.js:15018). */
export const SECOND_SLOT = 27;
/** The drop list, in the game's order before its shuffle (main.js:14960). */
export const DROPS = Object.freeze(['Dragon scale', 'Dragon claw', 'Dragon fang', 'Dragon teddy bear']);

const PRICE_INCREASE = 1.15; // Game.priceIncrease (main.js:7673)

/**
 * What training from `level` to the next costs, or null when fully trained.
 * { cookies } for the egg (main.js:14774-14793), { building, count } for levels 5-24, which
 * sacrifice 100 of ObjectsById[level - 5] (main.js:14857-14866), and { every } for levels 25 and
 * 26, which take 50 and 200 of every building (main.js:14814-14821).
 */
export function levelCost(level) {
    if (!(level >= 0) || level >= FULLY_TRAINED) return null;
    if (level <= 4) return { cookies: 1e6 * Math.pow(2, level) };
    if (level <= 24) return { building: level - 5, count: 100 };
    return { every: level === 25 ? 50 : 200 };
}

/**
 * What rebuying the top `k` units of a building costs: the sum of their prices, as getSumPrice
 * adds them from the count the sacrifice leaves (main.js:7797-7806).
 * @param {{basePrice: number, amount: number, free: number, modifier: number}} b
 *   modifier: Game.modifyBuildingPrice(b, 1), the discounts, which multiply
 */
export function rebuyCost(b, k, priceIncrease = PRICE_INCREASE) {
    let sum = 0;
    for (let i = Math.max(0, b.amount - k); i < b.amount; i++) sum += b.basePrice * Math.pow(priceIncrease, Math.max(0, i - (b.free || 0)));
    return Math.ceil(sum * b.modifier);
}

/**
 * The levels that can be trained one after another from `level` with what is owned now, each
 * with what it costs. Step i trains level + i to level + i + 1.
 *
 * @param {object} a
 * @param {number} a.level
 * @param {Array<{basePrice: number, amount: number, free: number, modifier: number}>} a.buildings  in ObjectsById order
 * @param {number} a.spendable  cookies the buyer is not holding, for the egg levels
 * @param {(level: number, after: number[], taken: number[]) => boolean} [a.allowed]
 *   a further condition on a level, given the building counts after it and what it takes
 * @returns {Array<{level: number, cost: number, spend: number}>}
 *   cost: cookies spent plus the rebuy cost of what is sacrificed; spend: cookies spent
 */
export function trainableChain({ level, buildings, spendable, allowed = () => true, priceIncrease = PRICE_INCREASE }) {
    const amounts = buildings.map((b) => b.amount);
    const steps = [];
    let spent = 0;
    for (let l = level; l < FULLY_TRAINED; l++) {
        const c = levelCost(l);
        const taken = amounts.map(() => 0);
        let cost = 0;
        let spend = 0;
        if (c.cookies) {
            spend = c.cookies;
            if (spent + spend > spendable) break;
            cost = spend;
        } else {
            const count = c.every || c.count;
            const ids = c.every ? amounts.map((_, i) => i) : [c.building];
            if (ids.some((i) => !(amounts[i] >= count))) break;
            for (const i of ids) {
                cost += rebuyCost({ ...buildings[i], amount: amounts[i] }, count, priceIncrease);
                taken[i] = count;
            }
        }
        const after = amounts.map((a, i) => a - taken[i]);
        if (!allowed(l, after, taken)) break;
        for (let i = 0; i < amounts.length; i++) amounts[i] = after[i];
        spent += spend;
        steps.push({ level: l, cost, spend });
    }
    return steps;
}

/**
 * Where to train toward, if anywhere.
 *
 * A level whose aura is worth no more than the one in place is still worth training when it is
 * on the way to one that is (Radiant Appetite at 19, the second slot at 27): each target is
 * judged on the whole chain to it. The one with the best net gain over the horizon is chosen,
 * and trained toward only if that net gain is positive.
 *
 * @param {object} a
 * @param {number} a.level
 * @param {Array<{cost: number}>} a.steps  from trainableChain
 * @param {number[]} a.income  best income with the dragon at level + i, for i = 0 to steps.length
 * @param {number} a.horizon  seconds the run is expected to last
 * @param {number[]} [a.switchCost]  per i: the buildings the aura switches at level + i sacrifice
 * @param {number[]} [a.switches]  per i: how many aura slots change at level + i
 * @param {number} [a.minSwitchGain]  the share of income below which the gods system makes no
 *   switch (AURA_GAIN in src/core/gods.js): a gain that needs a switch it would not make is none
 * @returns {{train: boolean, target?: number, gain?: number, cost?: number, net?: number, payback?: number}}
 */
export function chooseTarget({ level, steps, income, horizon, switchCost = [], switches = [], minSwitchGain = 0 }) {
    let best = null;
    let cost = 0;
    for (let i = 1; i <= steps.length; i++) {
        cost += steps[i - 1].cost;
        const gain = income[i] - income[0];
        if (!(gain > 0)) continue;
        if (switches[i] > 0 && !(gain > minSwitchGain * income[0])) continue;
        const total = cost + (switchCost[i] || 0);
        const net = gain * horizon - total;
        if (!best || net > best.net) best = { target: level + i, gain, cost: total, net, payback: total / gain };
    }
    if (!best) return { train: false };
    return { train: best.net > 0, ...best };
}

/**
 * The time the run is expected to go on: as long as it has lasted (a run half over is as likely
 * as not to be), and at least an hour, which is shorter than any run the ascension system makes.
 */
export function horizonSeconds(runSeconds) {
    return Math.max(3600, runSeconds);
}

/** The grimoire's mana cap with `towers` Wizard towers at tower `level` (minigameGrimoire.js:263-267). */
export function magicCap(towers, level) {
    const t = Math.max(towers, 1);
    const l = Math.max(level, 1);
    return Math.floor(4 + Math.pow(t, 0.6) + Math.log((t + (l - 1) * 10) / 15 + 1) * 15);
}

/** The game's shuffle (main.js:56-71) on a copy, drawing from `random`. */
export function shuffleWith(list, random) {
    const array = list.slice();
    let counter = array.length;
    while (counter--) {
        const index = (random() * counter) | 0;
        const temp = array[counter];
        array[counter] = array[index];
        array[index] = temp;
    }
    return array;
}

/** The drop petting gives in this minute of the hour: one per quarter hour (main.js:14962). */
export function dropFor(order, minutes) {
    return order[Math.floor((minutes / 60) * order.length)];
}

/** Petting is worth a click only when it can drop something not yet had. */
export function shouldPet({ level, petUpgrade, drop, owned }) {
    return level >= PET_LEVEL && !!petUpgrade && !!drop && !owned;
}
