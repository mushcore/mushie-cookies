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
            const first = MushieCookies.fillPermanentSlots(Game, FrozenCookies);
            const again = MushieCookies.fillPermanentSlots(Game, FrozenCookies);
            // A weak upgrade forced into the slot is replaced.
            const weak = Object.values(Game.UpgradesById).find((u) => u.bought && u.pool === '' && !u.noPerm && u.name !== first[0].name);
            Game.permanentUpgrades[0] = weak.id;
            const replaced = MushieCookies.fillPermanentSlots(Game, FrozenCookies);
            return { first, again, replaced, slot: Game.permanentUpgrades[0], weak: weak.name };
        });
        assert.equal(out.first.length, 1);
        assert.ok(out.first[0].share > 0.05, `the pick should matter: share ${out.first[0].share}`);
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
