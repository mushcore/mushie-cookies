const SCALARS = [
    'cookiesPsRawHighest',
    'prestige',
    'BuildingsOwned',
    'UpgradesOwned',
    'AchievementsOwned',
    'season',
    'seasonT',
    'seasonUses',
    'elderWrath',
    'pledges',
    'pledgeT',
    'researchT',
    'nextResearch',
    'upgradesToRebuild',
    'storeToRefresh',
];

// The game keeps buildings in an array, and upgrades and achievements in objects keyed by id.
// `count` names the game's own counter for the collection, used to notice when it has grown.
const GROUPS = [
    { name: 'building', from: 'ObjectsById', count: 'ObjectsN', fields: ['amount', 'bought'] },
    { name: 'upgrade', from: 'UpgradesById', count: 'UpgradesN', fields: ['bought', 'unlocked'] },
    { name: 'achievement', from: 'AchievementsById', count: 'AchievementsN', fields: ['won'] },
];

// A ranking pass takes hundreds of snapshots, so the member lists are built once per collection
// and reused until the collection grows.
const lists = new WeakMap();

function listOf(game, group) {
    const collection = game[group.from];
    const size = game[group.count];
    const cached = lists.get(collection);
    if (cached && size !== undefined && cached.size === size) return cached;
    const keys = Object.keys(collection);
    const list = { size, keys, items: keys.map((key) => collection[key]) };
    lists.set(collection, list);
    return list;
}

/** Everything a what-if is allowed to disturb. */
export function takeSnapshot(game) {
    const snap = { groups: [] };
    for (const group of GROUPS) {
        const list = listOf(game, group);
        const { items } = list;
        const width = group.fields.length;
        const values = new Array(items.length * width);
        for (let i = 0; i < items.length; i++) {
            for (let f = 0; f < width; f++) values[i * width + f] = items[i][group.fields[f]];
        }
        snap.groups.push({ list, values });
    }
    for (const key of SCALARS) snap[key] = game[key];
    return snap;
}

export function restoreSnapshot(game, snap) {
    GROUPS.forEach((group, g) => {
        const { list, values } = snap.groups[g];
        const { items } = list;
        const width = group.fields.length;
        for (let i = 0; i < items.length; i++) {
            for (let f = 0; f < width; f++) items[i][group.fields[f]] = values[i * width + f];
        }
    });
    for (const key of SCALARS) game[key] = snap[key];
}

/** Human-readable list of what differs; empty when the two are equal. */
export function diffSnapshots(a, b) {
    const out = [];
    for (const key of SCALARS) if (a[key] !== b[key]) out.push(key);
    GROUPS.forEach((group, g) => {
        const mine = a.groups[g];
        const theirs = b.groups[g];
        const width = group.fields.length;
        const position = new Map(theirs.list.keys.map((key, i) => [key, i]));
        mine.list.keys.forEach((key, i) => {
            const j = position.get(key);
            for (let f = 0; f < width; f++) {
                if (j === undefined || theirs.values[j * width + f] !== mine.values[i * width + f]) {
                    out.push(`${group.name} ${key} ${group.fields[f]}`);
                }
            }
        });
    });
    return out;
}

/**
 * A stand-in for Game.Win inside a what-if: marks the achievement won and counts it, so the
 * game's recalculation sees its milk, but never notifies the player or Steam. The snapshot
 * restore undoes it.
 */
function quietWin(game) {
    const win = function (what) {
        if (typeof what !== 'string') {
            for (const name of Object.values(what || {})) win(name);
            return;
        }
        const it = game.Achievements && game.Achievements[what];
        if (!it || it.won) return;
        it.won = 1;
        if (!game.CountsAsAchievementOwned || game.CountsAsAchievementOwned(it.pool)) game.AchievementsOwned++;
        game.recalculateGains = 1;
    };
    return win;
}

function closeSession(game, snap, win) {
    restoreSnapshot(game, snap);
    game.Win = win;
    game.recalculateGains = 1;
    game.CalculateGains();
    // The closing recalculation is of the real state, so its own high is legitimate.
    // Anything above it came from the what-if.
    game.cookiesPsRawHighest = Math.max(snap.cookiesPsRawHighest, game.cookiesPsRaw);
}

/**
 * Runs a what-if against the live game and guarantees the game is left as it was found.
 *
 * While it runs, achievements are marked but not announced and the highest-CpS record is
 * frozen: the game's own recalculation does both as side effects, and neither may reach the
 * player for a purchase that was never made.
 */
export function simulate(game, { apply, measure, revert }) {
    const snap = takeSnapshot(game);
    const win = game.Win;
    game.Win = quietWin(game);
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
        closeSession(game, snap, win);
    }
}

/**
 * Many what-ifs from one starting point: one snapshot, one closing recalculation. Each trial's
 * `apply` runs on the restored starting state, is recalculated and measured, then undone.
 * Returns the measurements, aligned with `trials`.
 */
export function simulateEach(game, trials, measure) {
    const snap = takeSnapshot(game);
    const win = game.Win;
    game.Win = quietWin(game);
    const out = [];
    try {
        for (const trial of trials) {
            try {
                trial.apply();
                game.recalculateGains = 1;
                game.CalculateGains();
                out.push(measure(trial));
            } finally {
                restoreSnapshot(game, snap);
            }
        }
    } finally {
        closeSession(game, snap, win);
    }
    return out;
}
