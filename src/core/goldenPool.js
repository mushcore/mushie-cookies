/**
 * Exact outcome probabilities of a golden or wrath cookie.
 *
 * The game builds a list from a fixed base plus a few independent rolls, then picks uniformly
 * from the list (main.js:5424-5447). Enumerating every combination of the rolls, weighted by
 * its probability, gives the exact chance of each outcome. The game's "80% chance to avoid
 * repeating the previous outcome" is left out; it shifts the numbers by a few percent at most.
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
    rolls.push([[0.0001, ['blab']]]);

    const out = {};
    const walk = (i, list, weight) => {
        if (weight <= 0) return;
        if (i === rolls.length) {
            const share = weight / list.length;
            for (const name of list) out[name] = (out[name] || 0) + share;
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
    return out;
}
