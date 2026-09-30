const SCALARS = [
    'cookiesPsRawHighest',
    'BuildingsOwned',
    'UpgradesOwned',
    'AchievementsOwned',
    'season',
    'elderWrath',
    'pledges',
];

// The game keeps buildings in an array, and upgrades and achievements in objects keyed by id.
// Reading every collection by key covers both.
const GROUPS = [
    { name: 'building', from: 'ObjectsById', fields: ['amount', 'bought'] },
    { name: 'upgrade', from: 'UpgradesById', fields: ['bought', 'unlocked'] },
    { name: 'achievement', from: 'AchievementsById', fields: ['won'] },
];

/** Everything a what-if is allowed to disturb. */
export function takeSnapshot(game) {
    const snap = {};
    for (const group of GROUPS) {
        const items = game[group.from];
        snap[group.name] = Object.keys(items).map((key) => [key, ...group.fields.map((f) => items[key][f])]);
    }
    for (const key of SCALARS) snap[key] = game[key];
    return snap;
}

export function restoreSnapshot(game, snap) {
    for (const group of GROUPS) {
        const items = game[group.from];
        for (const [key, ...values] of snap[group.name]) {
            group.fields.forEach((f, i) => {
                items[key][f] = values[i];
            });
        }
    }
    for (const key of SCALARS) game[key] = snap[key];
}

/** Human-readable list of what differs; empty when the two are equal. */
export function diffSnapshots(a, b) {
    const out = [];
    for (const key of SCALARS) if (a[key] !== b[key]) out.push(key);
    for (const group of GROUPS) {
        const other = new Map(b[group.name].map(([key, ...values]) => [key, values]));
        for (const [key, ...values] of a[group.name]) {
            const theirs = other.get(key);
            group.fields.forEach((f, i) => {
                if (!theirs || theirs[i] !== values[i]) out.push(`${group.name} ${key} ${f}`);
            });
        }
    }
    return out;
}

/**
 * Runs a what-if against the live game and guarantees the game is left as it was found.
 *
 * While it runs, the game cannot award achievements and the highest-CpS record is frozen:
 * the game's own recalculation does both as side effects, and neither may happen for a
 * purchase that was never made.
 */
export function simulate(game, { apply, measure, revert }) {
    const snap = takeSnapshot(game);
    const win = game.Win;
    game.Win = function () {};
    try {
        apply();
        game.recalculateGains = 1;
        game.CalculateGains();
        return measure();
    } finally {
        try {
            if (revert) revert();
        } catch (error) {
            // The snapshot restore below is authoritative for everything it covers.
        }
        restoreSnapshot(game, snap);
        game.Win = win;
        game.recalculateGains = 1;
        game.CalculateGains();
        // The closing recalculation is of the real state, so its own high is legitimate.
        // Anything above it came from the what-if.
        game.cookiesPsRawHighest = Math.max(snap.cookiesPsRawHighest, game.cookiesPsRaw);
    }
}
