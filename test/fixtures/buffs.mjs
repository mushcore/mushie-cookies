// Every buff type in Cookie Clicker v2.053, as the game grants it, with the classification each
// should get. Shared by the unit test (which builds the buff objects from these rows, or from the
// game's own buff functions when the game is installed) and the game test (which grants each
// with Game.gainBuff).
//
// `args` are what the game passes to Game.gainBuff after the type name, taken from its call
// sites: seconds, power, and for building buffs the building id. `name`, `multCpS` and
// `multClick` are what the type's function returns for those arguments (main.js:13862-14192).

export const BUFF_FIXTURES = [
    // Golden cookies (main.js:5496-5595); durations before golden-cookie duration upgrades.
    { type: 'frenzy', args: [77, 7], name: 'Frenzy', multCpS: 7, kind: 'income spike' },
    { type: 'blood frenzy', args: [6, 666], name: 'Elder frenzy', multCpS: 666, kind: 'income spike' },
    { type: 'clot', args: [66, 0.5], name: 'Clot', multCpS: 0.5, kind: 'debuff' },
    { type: 'dragon harvest', args: [60, 15], name: 'Dragon Harvest', multCpS: 15, kind: 'income spike' },
    { type: 'everything must go', args: [8, 5], name: 'Everything must go', kind: 'neutral' },
    // Power is the payout per click: CpS × the duration (main.js:5557).
    { type: 'cursed finger', args: [10, 1e6], name: 'Cursed finger', multCpS: 0, kind: 'debuff', fixedClick: 1e6 },
    { type: 'click frenzy', args: [13, 777], name: 'Click frenzy', multClick: 777, kind: 'income spike' },
    { type: 'dragonflight', args: [10, 1111], name: 'Dragonflight', multClick: 1111, kind: 'income spike' },
    { type: 'cookie storm', args: [7, 7], name: 'Cookie storm', kind: 'income spike' },
    // Building 0 is the Cursor; power is 1 + amount/10 (main.js:5504).
    { type: 'building buff', args: [30, 6, 0], name: 'High-five', multCpS: 6, kind: 'income spike' },
    { type: 'building debuff', args: [30, 6, 0], name: 'Slap to the face', multCpS: 1 / 6, kind: 'debuff' },
    // Golden sugar lump (main.js:4495).
    { type: 'sugar blessing', args: [86400, 1], name: 'Sugar blessing', kind: 'long boost' },
    // Grimoire (minigameGrimoire.js:29-254).
    { type: 'haggler luck', args: [60, 2], name: "Haggler's luck", kind: 'neutral' },
    { type: 'haggler misery', args: [3600, 2], name: "Haggler's misery", kind: 'debuff' },
    { type: 'pixie luck', args: [60, 2], name: 'Crafty pixies', kind: 'neutral' },
    { type: 'pixie misery', args: [3600, 2], name: 'Nasty goblins', kind: 'debuff' },
    { type: 'magic adept', args: [300, 10], name: 'Magic adept', kind: 'neutral' },
    { type: 'magic inept', args: [600, 5], name: 'Magic inept', kind: 'debuff' },
    // Godzamok, 1% per building sold at level 1 (main.js:7897).
    { type: 'devastation', args: [10, 1.5], name: 'Devastation', multClick: 1.5, kind: 'income spike' },
    // A sugar lump spent in the stats menu (main.js:11043).
    { type: 'sugar frenzy', args: [3600, 3], name: 'Sugar frenzy', multCpS: 3, kind: 'long boost' },
    // Stock market loans (minigameMarket.js:348-352, 376-380): name, mult, minutes, interest mult, minutes.
    { type: 'loan 1', args: [7200, 1.5], name: 'Loan 1', multCpS: 1.5, kind: 'long boost' },
    { type: 'loan 1 interest', args: [14400, 0.25], name: 'Loan 1 (interest)', multCpS: 0.25, kind: 'debuff' },
    // The pawnshop loan lasts 0.67 minutes: a spike, not a long boost.
    { type: 'loan 2', args: [0.67 * 60, 2], name: 'Loan 2', multCpS: 2, kind: 'income spike' },
    { type: 'loan 2 interest', args: [2400, 0.1], name: 'Loan 2 (interest)', multCpS: 0.1, kind: 'debuff' },
    { type: 'loan 3', args: [172800, 1.2], name: 'Loan 3', multCpS: 1.2, kind: 'long boost' },
    { type: 'loan 3 interest', args: [432000, 0.8], name: 'Loan 3 (interest)', multCpS: 0.8, kind: 'debuff' },
    // Sending or redeeming a gift (main.js:12029, 12217).
    { type: 'gifted out', args: [3600, 1], name: 'Gifted out', kind: 'neutral' },
];

/** A buff object shaped as Game.gainBuff leaves it, built from a fixture row. */
export function buffFromFixture(row, fps = 30) {
    const buff = { name: row.name, time: row.args[0] * fps, type: { name: row.type }, power: row.args[1] };
    if (row.multCpS !== undefined) buff.multCpS = row.multCpS;
    if (row.multClick !== undefined) buff.multClick = row.multClick;
    buff.maxTime = buff.time;
    return buff;
}
