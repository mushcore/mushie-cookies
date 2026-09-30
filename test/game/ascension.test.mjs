import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

/** A bakery a few hours in, with the settings of an unattended run. */
const midGame = () =>
    (() => {
        Game.Earn(1e14);
        for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank']) Game.Objects[name].buy(60);
        for (let pass = 0; pass < 3; pass++) {
            Game.RebuildUpgrades();
            for (const u of Game.UpgradesInStore.slice()) if (['', 'cookie'].includes(u.pool) && !MushieCookies.NEVER_BUY.has(u.id)) u.buy();
        }
        Game.CalculateGains();
    })();

test('heavenly upgrades are planned on the living bakery, Legacy first, by income per chip', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const out = await game.eval(() => {
            Game.Earn(1e14);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank']) Game.Objects[name].buy(60);
            Game.CalculateGains();
            const before = MushieCookies.takeSnapshot(Game);
            const plan = MushieCookies.planHeavenly(Game, FrozenCookies, 400, 400);
            return {
                names: plan.buy.map((b) => b.name),
                shares: Object.fromEntries(plan.buy.map((b) => [b.name, b.share])),
                left: plan.left,
                saving: plan.saving,
                diff: MushieCookies.diffSnapshots(before, MushieCookies.takeSnapshot(Game)),
                chips: Game.heavenlyChips,
                prestigeUntouched: Game.prestige,
            };
        });
        assert.equal(out.names[0], 'Legacy');
        assert.equal(out.prestigeUntouched, 0, 'the what-if must not leave the projected prestige behind');
        assert.ok(out.names.includes('Heavenly cookies'), out.names.join(', '));
        assert.ok(Math.abs(out.shares['Heavenly cookies'] - 0.1) < 0.02, `Heavenly cookies should add about 10%, measured ${out.shares['Heavenly cookies']}`);
        assert.ok(out.names.includes('How to bake your dragon'));
        assert.ok(out.left >= 0 && out.left < 400);
        assert.deepEqual(out.diff, [], 'planning is a what-if and must leave nothing behind');
        assert.equal(out.chips, 0, 'planning spends no real chips');
    } finally {
        await game.close();
    }
});

test('a permanent slot takes the owned upgrade whose loss would cost the most', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const out = await game.eval(() => {
            Game.Earn(1e14);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank']) Game.Objects[name].buy(60);
            for (let pass = 0; pass < 3; pass++) {
                Game.RebuildUpgrades();
                for (const u of Game.UpgradesInStore.slice()) if (['', 'cookie'].includes(u.pool) && !MushieCookies.NEVER_BUY.has(u.id)) u.buy();
            }
            Game.Upgrades['Kitten helpers'].earn();
            Game.Upgrades['Permanent upgrade slot I'].earn();
            Game.CalculateGains();
            const ranking = MushieCookies.rankPermanentSlots(Game, FrozenCookies);
            const first = MushieCookies.assignPermanentSlots(Game, ranking);
            const again = MushieCookies.assignPermanentSlots(Game, ranking);
            // A weak upgrade forced into the slot is replaced.
            const weak = Object.values(Game.UpgradesById).find((u) => u.bought && u.pool === '' && !u.noPerm && u.id !== first[0].id);
            Game.permanentUpgrades[0] = weak.id;
            const replaced = MushieCookies.assignPermanentSlots(Game, ranking);
            return { first, again, replaced, slot: Game.permanentUpgrades[0], topShare: ranking[0].share, topId: ranking[0].id };
        });
        assert.equal(out.first.length, 1);
        assert.equal(out.first[0].id, out.topId, 'the slot takes the top of the ranking');
        assert.ok(out.topShare > 0.05, `the pick should matter: share ${out.topShare}`);
        assert.deepEqual(out.again, [], 'a slot holding the best pick is left alone');
        assert.equal(out.replaced.length, 1);
        assert.equal(out.slot, out.first[0].id);
    } finally {
        await game.close();
    }
});

test('a first ascension: plans, ascends, buys and reincarnates by itself', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e14);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank']) Game.Objects[name].buy(60);
            Game.cookiesEarned = Game.HowManyCookiesReset(400); // enough for the starter set
            Game.CalculateGains();
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoClick = 1; // a fresh run earns its first cookies by clicking
            FrozenCookies.cookieClickSpeed = 50;
            FrozenCookies.autoAscendToggle = 1;
            FCStart();
        });
        await game.advanceSeconds(120);
        const out = await game.eval(() => ({
            resets: Game.resets,
            onAscend: Game.OnAscend,
            prestige: Game.prestige,
            legacy: Game.Has('Legacy'),
            heavenlyCookies: Game.Has('Heavenly cookies'),
            chipsLeft: Game.heavenlyChips,
            report: MushieCookies.ascension.report(),
            buildings: Game.BuildingsOwned,
            status: MushieCookies.status(),
        }));
        assert.equal(out.resets, 1, 'should have ascended and reincarnated once');
        assert.equal(out.onAscend, 0);
        assert.ok(out.prestige >= 399, `prestige ${out.prestige}`); // the cube root lands a hair under 400
        assert.equal(out.legacy, 1);
        assert.equal(out.heavenlyCookies, 1);
        assert.ok(out.chipsLeft < 400);
        assert.equal(out.report.ascensions, 1);
        assert.ok(out.report.last.bought.includes('Legacy'));
        assert.ok(out.buildings > 0, 'the buyer should have started rebuilding');
        assert.deepEqual(Object.entries(out.status).filter(([, s]) => s.failures > 0), []);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('a day-long buff or a debuff does not hold an ascension; a short income buff does', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e14);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank']) Game.Objects[name].buy(60);
            Game.cookiesEarned = Game.HowManyCookiesReset(400);
            Game.CalculateGains();
            // A golden sugar lump grants this for 24 hours (main.js harvestLumps); a backfired
            // spell leaves an hour of Haggler's misery.
            Game.gainBuff('sugar blessing', 24 * 60 * 60, 1);
            Game.gainBuff('haggler misery', 60 * 60, 2);
            FrozenCookies.autoAscendToggle = 1;
            FCStart();
        });
        await game.advanceSeconds(60);
        assert.equal(await game.eval(() => Game.resets), 1, 'ascended despite the long buffs');

        // A frenzy is income worth finishing first. The doubling rule has no minimum run time,
        // so the frenzy is the only thing that can hold this ascension.
        await game.eval(() => {
            MushieCookies.ascension.options.rule = 'double';
            Game.cookiesEarned = Game.HowManyCookiesReset(4000);
            Game.gainBuff('frenzy', 77, 7);
        });
        await game.advanceSeconds(30);
        const during = await game.eval(() => ({ resets: Game.resets, phase: MushieCookies.ascension.report().phase, frenzy: !!Game.buffs.Frenzy }));
        assert.deepEqual(during, { resets: 1, phase: 'playing', frenzy: true }, 'waits while the frenzy runs');
        await game.advanceSeconds(90);
        assert.equal(await game.eval(() => Game.resets), 2, 'ascends once the frenzy is over');
    } finally {
        await game.close();
    }
});

test('with auto-ascend off nothing ascends, however much prestige is waiting', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e14);
            Game.cookiesEarned = Game.HowManyCookiesReset(4000);
            FrozenCookies.autoAscendToggle = 0;
            FCStart();
        });
        await game.advanceSeconds(120);
        assert.equal(await game.eval(() => Game.resets), 0);
    } finally {
        await game.close();
    }
});

test('a machine sleep does not end a run that is still growing', { skip }, async () => {
    const game = await launchWithMod();
    try {
        // A run an hour old at prestige 100, gaining a tenth of a level a minute: faster than its
        // average. Golden cookies off, so nothing but the rule moves.
        await game.eval(() => {
            Game.shimmerTypes.golden.spawnConditions = () => false;
            Game.prestige = 100;
            Game.heavenlyChips = 0;
            Game.resets = 1;
            Game.cookiesReset = Game.HowManyCookiesReset(100);
            Game.startDate = Date.now() - 3600 * 1000;
            FrozenCookies.autoAscendToggle = 1;
            FCStart();
        });
        const grow = (minute) =>
            game.eval((m) => {
                Game.cookiesEarned = Game.HowManyCookiesReset(100.5 + 0.12 * m) - Game.cookiesReset;
            }, minute);
        const read = () =>
            game.eval(() => {
                const r = MushieCookies.ascension.report();
                return { resets: Game.resets, ascending: Game.OnAscend || Game.AscendTimer, phase: r.phase, verdict: r.verdict && r.verdict.reason, runSeconds: r.runSeconds };
            });
        for (let minute = 0; minute < 16; minute++) {
            await grow(minute);
            await game.advanceSeconds(60);
        }
        const awake = await read();
        assert.match(awake.verdict, /still growing/, 'the premise: awake, the run is growing faster than its average');

        await game.machineSleep(3600);
        await grow(16);
        await game.advanceSeconds(10);
        const woken = await read();
        assert.deepEqual({ resets: woken.resets, ascending: woken.ascending, phase: woken.phase }, { resets: 1, ascending: 0, phase: 'playing' }, woken.verdict);
        assert.match(woken.verdict, /still growing/);
        assert.ok(Math.abs(woken.runSeconds - (3600 + 16 * 60 + 10)) < 5, `the run clock counts play: ${woken.runSeconds}`);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('Auto Ascend switched off during its own ascension hands it back to the player', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.shimmerTypes.golden.spawnConditions = () => false;
            Game.Earn(1e14);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank']) Game.Objects[name].buy(60);
            Game.prestige = 100;
            Game.heavenlyChips = 0;
            Game.cookiesReset = Game.HowManyCookiesReset(100);
            Game.cookiesEarned = Game.HowManyCookiesReset(210) - Game.cookiesReset;
            Game.resets = 1;
            Game.CalculateGains();
            MushieCookies.ascension.options.rule = 'double'; // decides at once
            FrozenCookies.autoAscendToggle = 1;
            FCStart();
        });
        const read = () =>
            game.eval(() => ({
                phase: MushieCookies.ascension.phase(),
                timer: Game.AscendTimer,
                onAscend: Game.OnAscend,
                resets: Game.resets,
                ascensions: MushieCookies.ascension.report().ascensions,
                prepared: !!FrozenCookies.preparedForAscension,
            }));
        const until = async (phase) => {
            for (let i = 0; i < 40; i++) {
                await game.advance(15);
                const s = await read();
                if (s.phase === phase && (phase !== 'ascending' || s.timer > 0)) return s;
            }
            throw new Error(`the ascension never reached '${phase}'`);
        };
        const autoAscend = (on) => game.eval((v) => (FrozenCookies.autoAscendToggle = v), on ? 1 : 0);

        // Off during the ascend animation: the heavenly screen is left to the player.
        await until('ascending');
        await autoAscend(false);
        await game.advanceSeconds(10);
        const screen = await read();
        assert.deepEqual(
            { onAscend: screen.onAscend, phase: screen.phase, ascensions: screen.ascensions },
            { onAscend: 1, phase: 'playing', ascensions: 0 }
        );
        await game.eval(() => {
            Game.ClosePrompt();
            Game.Reincarnate(1);
        });
        await game.advanceSeconds(3);

        // Off while collecting, before Game.Ascend: nothing is started and the run goes on.
        await game.eval(() => {
            Game.cookiesEarned = Game.HowManyCookiesReset(2 * Game.prestige + 50) - Game.cookiesReset;
        });
        await autoAscend(true);
        await until('settling');
        await autoAscend(false);
        await game.advanceSeconds(5);
        assert.deepEqual(await read(), { phase: 'playing', timer: 0, onAscend: 0, resets: 2, ascensions: 0, prepared: false });

        // Back on, it decides afresh and ascends by itself.
        await autoAscend(true);
        await game.advanceSeconds(60);
        const again = await read();
        assert.deepEqual({ resets: again.resets, ascensions: again.ascensions, onAscend: again.onAscend }, { resets: 3, ascensions: 1, onAscend: 0 });

        // An ascension the player starts is still the player's.
        await game.eval(() => Game.Ascend(1));
        await game.advanceSeconds(10);
        const manual = await read();
        assert.deepEqual({ onAscend: manual.onAscend, ascensions: manual.ascensions, phase: manual.phase }, { onAscend: 1, ascensions: 1, phase: 'playing' });
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});
