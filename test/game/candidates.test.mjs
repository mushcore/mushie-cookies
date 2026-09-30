import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('candidates cover buildings, store upgrades and the next tier within reach', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const out = await game.eval(() => {
            Game.Earn(1e12);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine']) Game.Objects[name].buy(30);
            Game.Objects['Factory'].buy(47); // three short of the tier that unlocks at 50
            Game.RebuildUpgrades();
            const policy = { excludedBuildings: new Set(), excludedUpgrades: new Set(), chainReach: 15, prerequisites: upgradeJson };
            const list = MushieCookies.listCandidates(Game, policy);
            const factory = Game.Objects['Factory'];
            const chain = list.find((c) => c.kind === 'chain' && c.steps.length === 1 && c.steps[0].building === factory && c.upgrade.buildingTie === factory);
            const storeIds = Game.UpgradesInStore.filter((u) => ['', 'cookie', 'tech'].includes(u.pool) && !MushieCookies.NEVER_BUY.has(u.id)).map((u) => u.id).sort();
            const limited = MushieCookies.listCandidates(Game, { excludedBuildings: new Set([Game.Objects['Mine'].id]), excludedUpgrades: new Set(), chainReach: 15, prerequisites: upgradeJson });
            const noUpgrades = MushieCookies.listCandidates(Game, { excludedBuildings: new Set(), excludedUpgrades: 'all', chainReach: 15, prerequisites: upgradeJson });
            return {
                buildings: list.filter((c) => c.kind === 'building').length,
                upgradeIds: list.filter((c) => c.kind === 'upgrade').map((c) => c.upgrade.id).sort(),
                storeIds,
                chain: chain && { steps: chain.missing, price: chain.price, expected: factory.getSumPrice(3) + chain.upgrade.getPrice(), upgrade: chain.upgrade.name },
                mineListed: limited.some((c) => c.kind === 'building' && c.name === 'Mine'),
                kinds: [...new Set(noUpgrades.map((c) => c.kind))],
            };
        });
        assert.equal(out.buildings, 20);
        assert.deepEqual(out.upgradeIds, out.storeIds);
        assert.ok(out.upgradeIds.length > 3);
        assert.ok(out.chain, 'a chain to the Factory tier at 50 should be listed');
        assert.equal(out.chain.steps, 3);
        assert.equal(out.chain.price, out.chain.expected);
        assert.equal(out.mineListed, false);
        assert.deepEqual(out.kinds, ['building']);
    } finally {
        await game.close();
    }
});

test('applying a chain inside a what-if unlocks its upgrade and leaves nothing behind', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const out = await game.eval(() => {
            Game.Earn(1e12);
            Game.Objects['Factory'].buy(47);
            Game.CalculateGains(); // settle the real state first, so its own achievements are not mistaken for leaks
            const policy = { excludedBuildings: new Set(), excludedUpgrades: new Set(), chainReach: 15, prerequisites: upgradeJson };
            const chain = MushieCookies.listCandidates(Game, policy).find((c) => c.kind === 'chain' && c.steps.length === 1 && c.steps[0].building === Game.Objects['Factory'] && c.upgrade.buildingTie === Game.Objects['Factory']);
            const before = MushieCookies.takeSnapshot(Game);
            const [measured] = MushieCookies.simulateEach(Game, [chain], () => ({
                amount: Game.Objects['Factory'].amount,
                unlocked: chain.upgrade.unlocked,
                bought: chain.upgrade.bought,
                cps: Game.cookiesPs,
            }));
            return { measured, diff: MushieCookies.diffSnapshots(before, MushieCookies.takeSnapshot(Game)), cpsNow: Game.cookiesPs };
        });
        assert.equal(out.measured.amount, 50);
        assert.equal(out.measured.unlocked, 1);
        assert.equal(out.measured.bought, 1);
        assert.ok(out.measured.cps > out.cpsNow);
        assert.deepEqual(out.diff, []);
    } finally {
        await game.close();
    }
});

test('the fingers line chains from the cursor count that really unlocks it', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const out = await game.eval(() => {
            Game.Earn(1e12);
            Game.Objects['Cursor'].buy(90);
            Game.Objects['Grandma'].buy(10);
            for (const name of ['Thousand fingers', 'Million fingers']) Game.Upgrades[name].earn();
            const policy = { excludedBuildings: new Set(), excludedUpgrades: new Set(), chainReach: 15, prerequisites: upgradeJson };
            const chain = MushieCookies.listCandidates(Game, policy).find((c) => c.kind === 'chain' && c.upgrade.name === 'Billion fingers');
            return chain && { missing: chain.missing, name: chain.name };
        });
        assert.ok(out, 'Billion fingers should be a chain ten cursors away');
        assert.equal(out.missing, 10);
    } finally {
        await game.close();
    }
});
