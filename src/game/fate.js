// Forecasts the outcome of Force the Hand of Fate.
//
// A spell's outcome is drawn from a generator seeded with the game seed and the number of
// spells cast so far (minigameGrimoire.js:312), so the next casts are known in advance. The
// forecast replays the game's draws in the same order on a private generator; the game's own
// generator is left exactly as it was.

const FATE = 'hand of fate';

/** A generator seeded like the game's, without disturbing Math.random. */
export function privateGenerator(seed) {
    const live = Math.random;
    try {
        Math.seedrandom(seed);
        return Math.random;
    } finally {
        Math.random = live;
    }
}

/**
 * The outcome of the Force the Hand of Fate cast `offset` casts from now.
 *
 * @param {object} game
 * @param {object} grimoire   the Wizard tower minigame
 * @param {number} [offset=0] how many casts of any spell come first
 * @param {object} [at]       conditions at the time of that cast, where they differ from now
 * @param {number} [at.failChance]         defaults to the spell's fail chance now
 * @param {string} [at.season]
 * @param {boolean} [at.dragonflight]      the Dragonflight buff is running
 * @param {number} [at.buildingsOwned]
 * @returns {{success: boolean, outcome: string}}
 */
export function forecastFate(game, grimoire, offset = 0, at = {}) {
    const spell = grimoire.spells[FATE];
    const failChance = at.failChance !== undefined ? at.failChance : grimoire.getFailChance(spell);
    const season = at.season !== undefined ? at.season : game.season;
    const dragonflight = at.dragonflight !== undefined ? at.dragonflight : !!game.hasBuff('Dragonflight');
    const buildingsOwned = at.buildingsOwned !== undefined ? at.buildingsOwned : game.BuildingsOwned;

    const random = privateGenerator(game.seed + '/' + (grimoire.spellsCastTotal + offset));
    const success = random() < 1 - failChance;

    // The cookie is created first (main.js:5316-5356): its wrath roll is skipped because the
    // spell forces it, Valentine's and Easter pick a picture, then x and y are drawn.
    if (season === 'valentines' || season === 'easter') random();
    random();
    random();

    let choices;
    if (success) {
        choices = ['frenzy', 'multiply cookies'];
        if (!dragonflight) choices.push('click frenzy');
        if (random() < 0.1) choices.push('cookie storm', 'cookie storm', 'blab');
        if (buildingsOwned >= 10 && random() < 0.25) choices.push('building special');
        if (random() < 0.15) choices = ['cookie storm drop'];
        if (random() < 0.0001) choices.push('free sugar lump');
    } else {
        choices = ['clot', 'ruin cookies'];
        if (random() < 0.1) choices.push('cursed finger', 'blood frenzy');
        if (random() < 0.003) choices.push('free sugar lump');
        if (random() < 0.1) choices = ['blab'];
    }
    return { success, outcome: choices[Math.floor(random() * choices.length)] };
}

/** The next `count` outcomes, assuming today's conditions hold for all of them. */
export function forecastMany(game, grimoire, count) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(forecastFate(game, grimoire, i));
    return out;
}
