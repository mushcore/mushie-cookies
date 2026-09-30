/**
 * Exact outcome probabilities of a golden or wrath cookie.
 *
 * The game builds a list from a fixed base plus a few independent rolls, then picks uniformly
 * from the list (main.js:5424-5449). Enumerating every combination of the rolls, weighted by
 * its probability, gives the exact chance of each outcome of one draw.
 *
 * Before the pick, an outcome equal to the previous one is taken out of the list four times in
 * five (main.js:5447), and the previous outcome is kept by the golden cookie type, which wrath
 * cookies share (5455). Draws therefore form a Markov chain over the last outcome, and the share
 * of cookies each outcome takes in the long run is that chain's stationary distribution. The
 * rule matters: frenzy and lucky are in almost every list, so after either the rarer outcomes
 * are drawn from a shorter list, and building special and click frenzy come about a quarter more
 * often than one draw alone says.
 */

const REPEAT_REMOVED = 0.8; // main.js:5447
const BLAB = 0.0001; // added after the removal (main.js:5448)
// A storm's drops go through the same pick with a forced choice, so once one is popped the last
// outcome is 'cookie storm drop' (main.js:5451-5455), which no list holds.
const STORM_DROP = 'cookie storm drop';
const afterOutcome = (name) => (name === 'cookie storm' ? STORM_DROP : name);

/** Every combination of the rolls, as [list, weight] pairs; blab is left out. */
function enumerateLists(rules) {
    const wrath = rules.wrath ? 1 : 0;
    const base = wrath ? ['clot', 'multiply cookies', 'ruin cookies'] : ['frenzy', 'multiply cookies'];
    if (wrath && rules.scorn) base.push('clot', 'ruin cookies', 'clot', 'ruin cookies');

    // Each roll is a list of [probability, entries added] branches that exclude one another;
    // the branch that adds nothing is implied. Order follows the game.
    const rolls = [];
    if (wrath) {
        // 30% for the wrath trio; otherwise the 3% chain and storm roll still happens (main.js:5429-5430).
        const chain = rules.chainEligible ? 0.7 * 0.03 : 0;
        rolls.push([[0.3, ['blood frenzy', 'chain cookie', 'cookie storm']], [chain, ['chain cookie', 'cookie storm']]]);
    } else if (rules.chainEligible) rolls.push([[0.03, ['chain cookie', 'cookie storm']]]);
    if (rules.fools) rolls.push([[0.05, ['everything must go']]]);
    // 10%, and a further 5% roll when Dragonflight is active: 0.1 * 0.05 = 0.005.
    rolls.push([[rules.dragonflightActive ? 0.005 : 0.1, ['click frenzy']]]);
    if (wrath) rolls.push([[0.1, ['cursed finger']]]);
    if (rules.buildingSpecial) rolls.push([[0.25, ['building special']]]);
    if (rules.lumps) rolls.push([[0.0005, ['free sugar lump']]]);
    // One gate for both dragon outcomes, (golden and 15%) or 5%: 19.25% for a golden cookie and
    // 5% for a wrath cookie. Inside it each aura rolls on its own (main.js:5439-5445).
    const gate = wrath ? 0.05 : 1 - 0.85 * 0.95;
    const reaper = Math.min(1, Math.max(0, rules.reaper || 0));
    const dragonflight = Math.min(1, Math.max(0, rules.dragonflight || 0));
    if (reaper > 0 || dragonflight > 0) {
        rolls.push([
            [gate * reaper * dragonflight, ['dragon harvest', 'dragonflight']],
            [gate * reaper * (1 - dragonflight), ['dragon harvest']],
            [gate * (1 - reaper) * dragonflight, ['dragonflight']],
        ]);
    }

    const lists = [];
    const walk = (i, list, weight) => {
        if (weight <= 0) return;
        if (i === rolls.length) {
            lists.push([list, weight]);
            return;
        }
        let rest = 1;
        for (const [p, entries] of rolls[i]) {
            if (p > 0) walk(i + 1, list.concat(entries), weight * p);
            rest -= p;
        }
        walk(i + 1, list, weight * rest);
    };
    walk(0, base, 1);
    return lists;
}

/** Adds `weight` times a uniform pick from `list`, blab included (main.js:5448-5449), into `out`. */
function pick(list, weight, out) {
    const plain = (weight * (1 - BLAB)) / list.length;
    const withBlab = (weight * BLAB) / (list.length + 1);
    for (const name of list) out[name] = (out[name] || 0) + plain + withBlab;
    out.blab = (out.blab || 0) + withBlab;
}

/**
 * One draw's distribution after each possible previous outcome, from one pass over the lists:
 * `first` is the draw with nothing to avoid, `after[last]` the draw when `last` came before. A
 * previous outcome no list holds changes nothing.
 */
function drawTable(rules) {
    const first = {};
    const shifts = {}; // last -> what taking it out changes, to add to `first`
    for (const [list, weight] of enumerateLists(rules)) {
        pick(list, weight, first);
        for (const last of new Set(list)) {
            const shift = shifts[last] || (shifts[last] = {});
            const without = list.slice();
            without.splice(without.indexOf(last), 1); // one copy only, as the game splices one
            pick(without, weight * REPEAT_REMOVED, shift);
            pick(list, -weight * REPEAT_REMOVED, shift);
        }
    }
    const after = {};
    for (const [last, shift] of Object.entries(shifts)) {
        const row = { ...first };
        for (const [name, p] of Object.entries(shift)) row[name] = (row[name] || 0) + p;
        after[last] = row;
    }
    return { first, after };
}

const rowAfter = (table, last) => table.after[last] || table.first;

/**
 * Long-run shares by cookie type when a fraction `w` of cookies are wrath and the rest golden,
 * all sharing one last outcome. Power iteration from the first draw; the chain mixes within a
 * few dozen steps.
 */
function stationary(goldenTable, wrathTable, w) {
    const step = (pi) => {
        const golden = {};
        const wrath = {};
        for (const [last, p] of Object.entries(pi)) {
            if (!(p > 0)) continue;
            const next = afterOutcome(last);
            if (goldenTable) for (const [k, q] of Object.entries(rowAfter(goldenTable, next))) golden[k] = (golden[k] || 0) + p * (1 - w) * q;
            if (wrathTable) for (const [k, q] of Object.entries(rowAfter(wrathTable, next))) wrath[k] = (wrath[k] || 0) + p * w * q;
        }
        return { golden, wrath };
    };
    const total = ({ golden, wrath }) => {
        const out = { ...golden };
        for (const [k, v] of Object.entries(wrath)) out[k] = (out[k] || 0) + v;
        return out;
    };
    let shares = step({ '': 1 });
    for (let i = 0; i < 1000; i++) {
        const pi = total(shares);
        const next = step(pi);
        const after = total(next);
        let change = 0;
        for (const k of new Set([...Object.keys(pi), ...Object.keys(after)])) change += Math.abs((after[k] || 0) - (pi[k] || 0));
        shares = next;
        if (change < 1e-15) break;
    }
    return shares;
}

// Rules change rarely (a flag flips at ten buildings, an aura is set) while a ranking reads them
// for every trial, so each chain is solved once.
const solved = new Map();
const SOLVED_LIMIT = 64;
function remember(key, compute) {
    if (solved.has(key)) return solved.get(key);
    const value = compute();
    if (solved.size >= SOLVED_LIMIT) solved.clear();
    solved.set(key, value);
    return value;
}
const keyOf = (rules) =>
    [rules.wrath, rules.scorn, rules.chainEligible, rules.fools, rules.dragonflightActive, rules.buildingSpecial, rules.lumps, rules.reaper, rules.dragonflight]
        .map((v) => Number(v) || 0)
        .join(',');

/**
 * One draw's probabilities when the previous outcome was `last` ('' for none).
 * @param {object} rules  as for outcomeProbabilities
 * @param {string} [last]
 */
export function drawProbabilities(rules, last = '') {
    return { ...rowAfter(drawTable(rules), last) };
}

/**
 * Long-run probability of each outcome for cookies that are all of one type, the no-repeat rule
 * included.
 *
 * @param {object} rules
 * @param {0|1} rules.wrath
 * @param {boolean} rules.scorn              Skruuia slotted
 * @param {boolean} rules.chainEligible      cookiesEarned >= 100,000
 * @param {boolean} rules.fools              Business Day season
 * @param {boolean} rules.dragonflightActive the Dragonflight buff is running
 * @param {boolean} rules.buildingSpecial    BuildingsOwned >= 10
 * @param {boolean} rules.lumps              sugar lumps unlocked
 * @param {number} rules.reaper              auraMult('Reaper of Fields'): 0, 1 or 1.1
 * @param {number} rules.dragonflight        auraMult('Dragonflight'): 0, 1 or 1.1
 * @returns {{[outcome: string]: number}}
 */
export function outcomeProbabilities(rules) {
    const shares = remember(`one:${keyOf(rules)}`, () => {
        const table = drawTable(rules);
        return rules.wrath ? stationary(null, table, 1).wrath : stationary(table, null, 0).golden;
    });
    return { ...shares };
}

/**
 * Long-run share of all cookies each outcome takes, split by the type of cookie that gave it,
 * when a fraction `wrathChance` are wrath cookies (main.js:5325). Golden and wrath cookies share
 * the last outcome, so a mixed run is not its two pools mixed: a wrath outcome before a golden
 * cookie takes nothing out of its list. The two splits sum to 1 together.
 * @returns {{golden: {[outcome: string]: number}, wrath: {[outcome: string]: number}}}
 */
export function mixedOutcomeProbabilities(goldenRules, wrathRules, wrathChance) {
    const w = Math.min(1, Math.max(0, Number(wrathChance) || 0));
    const shares = remember(`mix:${keyOf(goldenRules)}/${keyOf(wrathRules)}/${w}`, () =>
        stationary(w < 1 ? drawTable({ ...goldenRules, wrath: 0 }) : null, w > 0 ? drawTable({ ...wrathRules, wrath: 1 }) : null, w)
    );
    return { golden: { ...shares.golden }, wrath: { ...shares.wrath } };
}
