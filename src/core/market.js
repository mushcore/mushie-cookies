/**
 * The stock market's price model and a trading policy. Pure.
 *
 * `tickMarket` is minigameMarket.js:803-877 line for line, drawing random numbers in the same
 * order (short-circuits included), so that given the same draws it produces the same prices as
 * the game. A test holds it to that. It is used offline to derive trading thresholds by
 * simulation, and in the game only to read what a policy would do.
 */

const MODE = { stable: 0, slowRise: 1, slowFall: 2, fastRise: 3, fastFall: 4, chaotic: 5 };
export { MODE };

/** Resting value a price is pulled towards (minigameMarket.js:261). */
export const restingValue = (id, bankLevel) => 10 + 10 * id + (bankLevel - 1);

const choose = (random, list) => list[Math.floor(random() * list.length)];

/**
 * Advances every good by one market tick, in place.
 * @param {Array<{id, val, d, mode, dur}>} goods
 * @param {{bankLevel: number, dragonBoost: number}} env  dragonBoost: auraMult('Supreme Intellect')
 * @param {() => number} random
 */
export function tickMarket(goods, { bankLevel, dragonBoost = 0 }, random) {
    let globD = 0;
    const globP = random();
    if (random() < 0.1 + 0.1 * dragonBoost) globD = (random() - 0.5) * 2;
    for (const me of goods) {
        me.d *= 0.97 + 0.01 * dragonBoost;

        if (me.mode === 0) {
            me.d *= 0.95;
            me.d += 0.05 * (random() - 0.5);
        } else if (me.mode === 1) {
            me.d *= 0.99;
            me.d += 0.05 * (random() - 0.1);
        } else if (me.mode === 2) {
            me.d *= 0.99;
            me.d -= 0.05 * (random() - 0.1);
        } else if (me.mode === 3) {
            me.d += 0.15 * (random() - 0.1);
            me.val += random() * 5;
        } else if (me.mode === 4) {
            me.d -= 0.15 * (random() - 0.1);
            me.val -= random() * 5;
        } else if (me.mode === 5) me.d += 0.3 * (random() - 0.5);

        me.val += (restingValue(me.id, bankLevel) - me.val) * 0.01;

        if (globD !== 0 && random() < globP) {
            me.val -= (1 + me.d * Math.pow(random(), 3) * 7) * globD;
            me.val -= globD * (1 + Math.pow(random(), 3) * 7);
            me.d += globD * (1 + random() * 4);
            me.dur = 0;
        }

        me.val += Math.pow((random() - 0.5) * 2, 11) * 3;
        me.d += 0.1 * (random() - 0.5);
        if (random() < 0.15) me.val += (random() - 0.5) * 3;
        if (random() < 0.03) me.val += (random() - 0.5) * (10 + 10 * dragonBoost);
        if (random() < 0.1) me.d += (random() - 0.5) * (0.3 + 0.2 * dragonBoost);
        if (me.mode === 5) {
            if (random() < 0.5) me.val += (random() - 0.5) * 10;
            if (random() < 0.2) me.d = (random() - 0.5) * (2 + 6 * dragonBoost);
        }
        if (me.mode === 3 && random() < 0.3) {
            me.d += (random() - 0.5) * 0.1;
            me.val += (random() - 0.7) * 10;
        }
        if (me.mode === 3 && random() < 0.03) me.mode = 4;
        if (me.mode === 4 && random() < 0.3) {
            me.d += (random() - 0.5) * 0.1;
            me.val += (random() - 0.3) * 10;
        }

        if (me.val > 100 + (bankLevel - 1) * 3 && me.d > 0) me.d *= 0.9;

        me.val += me.d;
        if (me.val < 5) me.val += (5 - me.val) * 0.5;
        if (me.val < 5 && me.d < 0) me.d *= 0.95;
        me.val = Math.max(me.val, 1);

        me.dur--;
        if (me.dur <= 0) {
            me.dur = Math.floor(10 + random() * (690 - 200 * dragonBoost));
            if (random() < dragonBoost && random() < 0.5) me.mode = 5;
            else if (random() < 0.7 && (me.mode === 3 || me.mode === 4)) me.mode = 5;
            else me.mode = choose(random, [0, 1, 1, 2, 2, 3, 4, 5]);
        }
    }
}

/**
 * What to do with one good this tick.
 * @param {object} args
 * @param {{val: number, mode: number, stock: number}} args.good
 * @param {{buyAt: number, sellAt: number}} args.thresholds   prices
 * @param {boolean} [args.modeAware=true]  never buy in a fast fall; hold while rising
 * @returns {'buy'|'sell'|'hold'}
 */
export function tradeDecision({ good, thresholds, modeAware = true }) {
    const { val, mode, stock } = good;
    if (stock > 0 && val >= thresholds.sellAt) {
        if (modeAware && (mode === MODE.fastRise || mode === MODE.slowRise) && val < thresholds.sellAt * 1.5) return 'hold';
        return 'sell';
    }
    if (val <= thresholds.buyAt) {
        if (modeAware && mode === MODE.fastFall) return 'hold';
        return 'buy';
    }
    return 'hold';
}
