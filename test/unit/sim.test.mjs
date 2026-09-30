import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeSnapshot, restoreSnapshot, diffSnapshots, simulate } from '../../src/core/sim.js';

// A small stand-in for the game: two buildings at 50 CpS each, one doubling upgrade, and an
// achievement that the recalculation awards at 200 CpS, as the real game does for CpS milestones.
function fakeGame() {
    const game = {
        cookiesPsRawHighest: 0, cookiesPsRaw: 0, cookiesPs: 0,
        BuildingsOwned: 3, UpgradesOwned: 1, AchievementsOwned: 1,
        season: '', elderWrath: 0, pledges: 0, recalculateGains: 0,
        ObjectsById: [{ amount: 2, bought: 2 }, { amount: 1, bought: 1 }],
        // As in the game: buildings are an array, upgrades and achievements are objects keyed by id.
        UpgradesById: { 0: { bought: 1, unlocked: 1 }, 1: { bought: 0, unlocked: 0 } },
        AchievementsById: { 0: { won: 1 }, 1: { won: 0 } },
        wins: [],
        Win(name) {
            this.wins.push(name);
        },
        CalculateGains() {
            const base = this.ObjectsById.reduce((sum, b) => sum + b.amount * 50, 0);
            this.cookiesPsRaw = base * (this.UpgradesById[1].bought ? 2 : 1);
            this.cookiesPs = this.cookiesPsRaw;
            if (this.cookiesPsRaw >= 200) this.Win('Fast baker');
            this.cookiesPsRawHighest = Math.max(this.cookiesPsRawHighest, this.cookiesPsRaw);
            this.recalculateGains = 0;
        },
    };
    game.CalculateGains();
    return game;
}

test('snapshot round trip leaves no difference', () => {
    const game = fakeGame();
    const snap = takeSnapshot(game);
    game.ObjectsById[0].amount = 99;
    game.UpgradesById[1].bought = 1;
    game.AchievementsById[1].won = 1;
    game.season = 'easter';
    assert.deepEqual(diffSnapshots(snap, takeSnapshot(game)).sort(), [
        'achievement 1 won',
        'building 0 amount',
        'season',
        'upgrade 1 bought',
    ]);
    restoreSnapshot(game, snap);
    assert.deepEqual(diffSnapshots(snap, takeSnapshot(game)), []);
});

test('simulate returns the measurement and restores everything', () => {
    const game = fakeGame();
    const before = takeSnapshot(game);
    const cps = simulate(game, {
        apply() {
            game.ObjectsById[0].amount += 1;
            game.ObjectsById[0].bought += 1;
            game.BuildingsOwned += 1;
        },
        measure: () => game.cookiesPs,
    });
    assert.equal(cps, 200);
    assert.deepEqual(diffSnapshots(before, takeSnapshot(game)), []);
    assert.equal(game.cookiesPs, 150);
});

test('achievements and the highest-CpS record are not touched by a what-if', () => {
    const game = fakeGame();
    simulate(game, {
        apply() {
            game.UpgradesById[1].bought = 1;
        },
        measure: () => game.cookiesPs,
    });
    assert.deepEqual(game.wins, []);
    assert.equal(game.cookiesPsRawHighest, 150);
});

test('a real new high reached before the what-if is kept', () => {
    const game = fakeGame();
    game.ObjectsById[1].amount = 4; // a real purchase whose recalculation is still pending
    simulate(game, { apply() {}, measure: () => 0 });
    assert.equal(game.cookiesPsRawHighest, 300);
    assert.deepEqual(game.wins, ['Fast baker'], 'the real state earns its achievement on the closing recalculation');
});

test('a throwing measure still restores, and the error propagates', () => {
    const game = fakeGame();
    const before = takeSnapshot(game);
    const win = game.Win;
    assert.throws(
        () =>
            simulate(game, {
                apply() {
                    game.ObjectsById[0].amount += 5;
                    game.season = 'halloween';
                },
                measure() {
                    throw new Error('measure broke');
                },
            }),
        /measure broke/
    );
    assert.deepEqual(diffSnapshots(before, takeSnapshot(game)), []);
    assert.equal(game.Win, win);
    assert.equal(game.cookiesPs, 150);
});

test('a throwing apply still restores', () => {
    const game = fakeGame();
    const before = takeSnapshot(game);
    assert.throws(
        () =>
            simulate(game, {
                apply() {
                    game.ObjectsById[0].amount += 5;
                    throw new Error('apply broke');
                },
                measure: () => 0,
            }),
        /apply broke/
    );
    assert.deepEqual(diffSnapshots(before, takeSnapshot(game)), []);
});

test('a throwing revert does not prevent the restore', () => {
    const game = fakeGame();
    const before = takeSnapshot(game);
    const out = simulate(game, {
        apply() {
            game.elderWrath = 3;
        },
        measure: () => 'measured',
        revert() {
            throw new Error('revert broke');
        },
    });
    assert.equal(out, 'measured');
    assert.deepEqual(diffSnapshots(before, takeSnapshot(game)), []);
});

test('nested what-ifs restore to their own starting points', () => {
    const game = fakeGame();
    const before = takeSnapshot(game);
    const out = simulate(game, {
        apply() {
            game.ObjectsById[0].amount += 1;
        },
        measure() {
            const inner = simulate(game, {
                apply() {
                    game.ObjectsById[1].amount += 1;
                },
                measure: () => game.cookiesPs,
            });
            return [game.cookiesPs, inner];
        },
    });
    assert.deepEqual(out, [200, 250]);
    assert.deepEqual(diffSnapshots(before, takeSnapshot(game)), []);
    assert.deepEqual(game.wins, []);
});

test('a collection that grows after a snapshot is picked up by the next one', () => {
    const game = fakeGame();
    game.UpgradesN = 2;
    takeSnapshot(game);
    game.UpgradesById[2] = { bought: 0, unlocked: 0 };
    game.UpgradesN = 3;
    const before = takeSnapshot(game);
    game.UpgradesById[2].bought = 1;
    assert.deepEqual(diffSnapshots(before, takeSnapshot(game)), ['upgrade 2 bought']);
    restoreSnapshot(game, before);
    assert.equal(game.UpgradesById[2].bought, 0);
});
