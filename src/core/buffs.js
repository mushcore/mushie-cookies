/**
 * The shared buff classifier. Pure.
 *
 * Systems ask this module what a running buff means instead of reading `Game.buffs` raw
 * (autopilot spec, section 2 rule 3). Reading it raw went wrong both ways: waiting on "any buff"
 * stalls a day for a golden lump's Sugar blessing, and "any buff with multCpS > 1" waits two
 * days for a retirement loan.
 *
 * A buff is what Game.gainBuff leaves in `Game.buffs` (main.js:13748-13793): `name`, `time` and
 * `maxTime` in frames, `multCpS` and `multClick` when it multiplies an income (main.js:5159,
 * 4734; absent means 1), `power`, and `type`, the Game.buffType it was made from. Known types
 * are looked up by `type.name` in BUFF_TYPES; a buff without a type object by its own name; any
 * other buff falls back on its multipliers (see `fallback`).
 *
 * Kinds:
 *   income spike  a short buff raising CpS or click power, or raining cookies: what spells,
 *                 combos and a pending ascension are timed against.
 *   long boost    hours or days: a backdrop, never worth waiting out.
 *   debuff        lowers CpS or click power, or makes something dearer or riskier.
 *   neutral       no effect on income (price cuts, spell luck, the gift cooldown).
 */

export const KINDS = Object.freeze({
    SPIKE: 'income spike',
    LONG: 'long boost',
    DEBUFF: 'debuff',
    NEUTRAL: 'neutral',
});

const { SPIKE, LONG, DEBUFF, NEUTRAL } = KINDS;

const row = (kind, buff, effect, note) => Object.freeze({ kind, buff, effect, note });

/**
 * Every buff type of v2.053, by `type.name`. `buff` is the name the buff itself carries (null
 * where it depends on the building), `effect` what it acts on. Durations are before golden-cookie
 * duration upgrades.
 */
export const BUFF_TYPES = Object.freeze({
    frenzy: row(SPIKE, 'Frenzy', 'cps', 'golden cookie: CpS x7 for 77 s'),
    'blood frenzy': row(SPIKE, 'Elder frenzy', 'cps', 'wrath cookie: CpS x666 for 6 s'),
    clot: row(DEBUFF, 'Clot', 'cps', 'wrath cookie or backfire: CpS x0.5 for 66 s / 15 min'),
    'dragon harvest': row(SPIKE, 'Dragon Harvest', 'cps', 'dragon aura cookie: CpS x15 for 60 s'),
    'everything must go': row(NEUTRAL, 'Everything must go', 'building prices', 'golden cookie: buildings 5% cheaper for 8 s'),
    'cursed finger': row(DEBUFF, 'Cursed finger', 'cps', 'wrath cookie: CpS 0 for 10 s, each click pays CpS x10 s (power)'),
    'click frenzy': row(SPIKE, 'Click frenzy', 'click', 'golden cookie: clicks x777 for 13 s'),
    dragonflight: row(SPIKE, 'Dragonflight', 'click', 'dragon aura cookie: clicks x1111 for 10 s'),
    'cookie storm': row(SPIKE, 'Cookie storm', 'shimmers', 'golden cookie: cookie drops rain for 7 s'),
    'building buff': row(SPIKE, null, 'cps', 'golden cookie: CpS x(1 + buildings/10) for 30 s'),
    'building debuff': row(DEBUFF, null, 'cps', 'wrath cookie: CpS /(1 + buildings/10) for 30 s'),
    'sugar blessing': row(LONG, 'Sugar blessing', 'shimmers', 'golden sugar lump: 10% more golden cookies for 24 h, no CpS'),
    'haggler luck': row(NEUTRAL, "Haggler's luck", 'upgrade prices', 'spell: upgrades 2% cheaper for 1 min'),
    'haggler misery': row(DEBUFF, "Haggler's misery", 'upgrade prices', 'backfire: upgrades 2% dearer for 1 h'),
    'pixie luck': row(NEUTRAL, 'Crafty pixies', 'building prices', 'spell: buildings 2% cheaper for 1 min'),
    'pixie misery': row(DEBUFF, 'Nasty goblins', 'building prices', 'backfire: buildings 2% dearer for 1 h'),
    'magic adept': row(NEUTRAL, 'Magic adept', 'spells', 'spell: backfires 10x rarer for 5 min'),
    'magic inept': row(DEBUFF, 'Magic inept', 'spells', 'backfire: backfires 5x likelier for 10 min'),
    devastation: row(SPIKE, 'Devastation', 'click', 'Godzamok: clicks +1% per building sold for 10 s'),
    'sugar frenzy': row(LONG, 'Sugar frenzy', 'cps', 'a sugar lump: CpS x3 for 1 h'),
    'loan 1': row(LONG, 'Loan 1', 'cps', 'modest loan: CpS x1.5 for 2 h'),
    'loan 1 interest': row(DEBUFF, 'Loan 1 (interest)', 'cps', 'CpS x0.25 for 4 h'),
    'loan 2': row(SPIKE, 'Loan 2', 'cps', 'pawnshop loan: CpS x2 for 40 s'),
    'loan 2 interest': row(DEBUFF, 'Loan 2 (interest)', 'cps', 'CpS x0.1 for 40 min'),
    'loan 3': row(LONG, 'Loan 3', 'cps', 'retirement loan: CpS x1.2 for 2 days'),
    'loan 3 interest': row(DEBUFF, 'Loan 3 (interest)', 'cps', 'CpS x0.8 for 5 days'),
    'gifted out': row(NEUTRAL, 'Gifted out', 'gifts', 'gift sent or redeemed: no gifts for 1 h'),
});

/** Type name by the buff's own name, for a buff object that has lost its type. */
const TYPE_BY_BUFF_NAME = (() => {
    const out = {};
    for (const type of Object.keys(BUFF_TYPES)) if (BUFF_TYPES[type].buff) out[BUFF_TYPES[type].buff] = type;
    return out;
})();

/** An unknown buff raising income for longer than this, in full, is a long boost. */
export const LONG_BOOST_SECONDS = 30 * 60;

const DEFAULT_FPS = 30;
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export const cpsMultOf = (buff) => (buff.multCpS === undefined ? 1 : buff.multCpS);
export const clickMultOf = (buff) => (buff.multClick === undefined ? 1 : buff.multClick);

/** `Game.buffs` (an object by name, whose entries the game briefly sets to 0 on removal) or a list. */
const listOf = (buffs) => (Array.isArray(buffs) ? buffs : Object.values(buffs || {})).filter(Boolean);

/**
 * An unknown type, by its multipliers: below 1 on either income is a debuff (the harm is certain,
 * what the other buys is not); above 1 is an income spike, or a long boost when its full
 * duration (maxTime, else time) passes LONG_BOOST_SECONDS; neither is neutral. A harmful buff
 * without multipliers cannot be told apart and reads neutral.
 */
function fallback(buff, cpsMult, clickMult, fps) {
    if (cpsMult < 1 || clickMult < 1) return DEBUFF;
    if (cpsMult > 1 || clickMult > 1) {
        const full = (buff.maxTime === undefined ? buff.time : buff.maxTime) / fps;
        return full > LONG_BOOST_SECONDS ? LONG : SPIKE;
    }
    return NEUTRAL;
}

/**
 * @param {object} buff  a running buff, as the game keeps it
 * @param {{fps?: number}} [opts]  frames per second (Game.fps, 30)
 * @returns {{name: string, type: string|null, kind: string, effect: string, known: boolean,
 *   secondsLeft: number, cpsMult: number, clickMult: number, fixedClick: number|null,
 *   raisesIncome: boolean}}
 *   fixedClick: what each click pays regardless of click power (the Cursed finger, main.js:4744).
 *   raisesIncome: multiplies CpS or clicks by more than 1, or rains cookies.
 */
export function classifyBuff(buff, { fps = DEFAULT_FPS } = {}) {
    const typeName = buff.type && typeof buff.type.name === 'string' ? buff.type.name : null;
    let type = typeName !== null && has(BUFF_TYPES, typeName) ? typeName : null;
    if (type === null && typeName === null && has(TYPE_BY_BUFF_NAME, buff.name)) type = TYPE_BY_BUFF_NAME[buff.name];
    const cpsMult = cpsMultOf(buff);
    const clickMult = clickMultOf(buff);
    const entry = type === null ? null : BUFF_TYPES[type];
    return {
        name: buff.name,
        type: type === null ? typeName : type,
        kind: entry ? entry.kind : fallback(buff, cpsMult, clickMult, fps),
        effect: entry ? entry.effect : 'unknown',
        known: !!entry,
        secondsLeft: buff.time / fps,
        cpsMult,
        clickMult,
        fixedClick: type === 'cursed finger' ? buff.power : null,
        raisesIncome: cpsMult > 1 || clickMult > 1 || type === 'cookie storm',
    };
}

/** Every running buff classified; `buffs` is Game.buffs or a list. */
export const classifyBuffs = (buffs, opts) => listOf(buffs).map((buff) => classifyBuff(buff, opts));

/**
 * Is an income spike running? With `maxSeconds`, only a spike ending within that many seconds
 * counts (one worth waiting for).
 */
export function incomeSpikeRunning(buffs, { maxSeconds = Infinity, fps } = {}) {
    return classifyBuffs(buffs, { fps }).some((c) => c.kind === SPIKE && c.secondsLeft <= maxSeconds);
}

/** Seconds until the last running income spike ends; 0 with none. */
export function longestSpikeSecondsLeft(buffs, { fps } = {}) {
    return classifyBuffs(buffs, { fps }).reduce((most, c) => (c.kind === SPIKE ? Math.max(most, c.secondsLeft) : most), 0);
}

/**
 * The products the running buffs multiply CpS and click power by (main.js:5159-5163, 4732-4735):
 * divide Game.cookiesPs by `cps` to get the unbuffed CpS. Click power cannot simply be divided
 * by `click`: each mouse upgrade adds 1% of the already buffed CpS to every click (4692-4706,
 * 5163-5167), so under a Frenzy that part of a click is 7× bigger while `click` is 1; readState
 * (src/game/measure.js) recomputes the click at the unbuffed CpS and divides only `click` out.
 * Under a Cursed finger `cps` is 0, so CpS cannot be divided back (use Game.unbuffedCps), and
 * every click pays `fixedClick` instead of a multiple of click power; otherwise it is null.
 */
export function unbuffedFactors(buffs) {
    let cps = 1;
    let click = 1;
    let fixedClick = null;
    for (const c of classifyBuffs(buffs)) {
        cps *= c.cpsMult;
        click *= c.clickMult;
        if (c.fixedClick !== null) fixedClick = c.fixedClick;
    }
    return { cps, click, fixedClick };
}

/**
 * A buff worth finishing before an irreversible step such as ascending: it raises income and
 * ends within `maxSeconds`. This is the ascension system's rule (src/systems/ascension.js), so it
 * can replace it: a long boost counts only in its last `maxSeconds`, and a debuff never, since
 * leaving it behind costs nothing.
 */
export function worthFinishing(buff, maxSeconds, { fps = DEFAULT_FPS } = {}) {
    return classifyBuff(buff, { fps }).raisesIncome && buff.time <= maxSeconds * fps;
}
