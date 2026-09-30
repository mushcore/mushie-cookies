import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

async function withMod(fn) {
    const game = await launchWithMod();
    try {
        // The fixture below runs in the page, as a global the tests call.
        await game.eval((source) => (0, eval)(`window.lateBakery = ${source}`), lateBakery.toString());
        await fn(game);
    } finally {
        await game.close();
    }
}

/**
 * Test fixture only: a late bakery (every building at 100, every store upgrade it unlocks bought)
 * after earlier ascensions, owning the heavenly upgrades named.
 */
function lateBakery(heavenlyOwned) {
    Game.Earn(1e40);
    for (const b of Game.ObjectsById) b.buy(100);
    for (let pass = 0; pass < 4; pass++) {
        Game.RebuildUpgrades();
        for (const u of Game.UpgradesInStore.slice()) if (['', 'cookie'].includes(u.pool) && !MushieCookies.NEVER_BUY.has(u.id)) u.buy();
    }
    Game.resets = 3;
    for (const name of heavenlyOwned) Game.Upgrades[name].earn();
    Game.CalculateGains();
}

const before = (names, a, b) => names.indexOf(a) >= 0 && names.indexOf(b) > names.indexOf(a);

test('M2: upgrades that only lead somewhere are bought for what they lead to, parents first', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            lateBakery(['Legacy', 'Heavenly cookies', 'Wrinkly cookies', 'Sacrilegious corruption', 'Elder spice', 'Unholy bait', 'Starter kit', 'Starter kitchen']);
            Game.lumps = 100; // test fixture: a jar held for Sugar baking
            FrozenCookies.autoSeasons = 1; // the season planner collects what Season switcher opens
            Game.CalculateGains();
            const snapshot = MushieCookies.takeSnapshot(Game);
            const plan = MushieCookies.planHeavenly(Game, FrozenCookies, 1e10, 1e10, { runSeconds: 86400 });
            return {
                names: plan.buy.map((b) => b.name),
                shares: Object.fromEntries(plan.buy.map((b) => [b.name, b.share])),
                diff: MushieCookies.diffSnapshots(snapshot, MushieCookies.takeSnapshot(Game)),
                chips: Game.heavenlyChips,
            };
        });
        const names = out.names;
        // Stevia Caelestis only ripens lumps sooner; Sugar baking behind it is +1% CpS per lump held.
        assert.ok(before(names, 'Stevia Caelestis', 'Sugar baking'), names.join(', '));
        assert.ok(out.shares['Sugar baking'] > 0.9, `Sugar baking with 100 lumps held should add about 100%, got ${out.shares['Sugar baking']}`);
        assert.ok(before(names, 'Sugar baking', 'Sugar crystal cookies'), names.join(', '));
        // The angels pay only while the game is closed; Kitten angels and the Synergies are behind them.
        for (const [a, b] of [['Angels', 'Archangels'], ['Archangels', 'Virtues'], ['Virtues', 'Dominions'], ['Dominions', 'Kitten angels'], ['Satan', 'Synergies Vol. I'], ['Dominions', 'Synergies Vol. I']]) {
            assert.ok(before(names, a, b), `${a} before ${b}: ${names.join(', ')}`);
        }
        // Season switcher opens the seasonal drops a run can collect.
        assert.ok(names.includes('Season switcher'), names.join(', '));
        assert.deepEqual(out.diff, [], 'planning is a what-if and must leave nothing behind');
        assert.equal(out.chips, 0, 'planning spends no real chips');
    }));

test('M2: Golden switch and Residual luck are bought on the way to Pet the dragon and Fortune cookies', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            lateBakery(['Legacy', 'Heavenly cookies', 'How to bake your dragon', 'Heavenly luck', 'Lasting fortune', 'Decisive fate', 'Divine discount', 'Divine sales', 'Divine bakeries']);
            Game.dragonLevel = 10; // test fixture: a dragon trained past the level petting needs
            FrozenCookies.petDragon = 1;
            FrozenCookies.autoFortune = 1;
            Game.CalculateGains();
            const plan = MushieCookies.planHeavenly(Game, FrozenCookies, 1e12, 1e12, { runSeconds: 86400 });
            return plan.buy.map((b) => b.name);
        });
        for (const [a, b] of [['Golden switch', 'Residual luck'], ['Residual luck', 'Pet the dragon'], ['Residual luck', 'Distilled essence of redoubled luck'], ['Distilled essence of redoubled luck', 'Fortune cookies']]) {
            assert.ok(before(out, a, b), `${a} before ${b}: ${out.join(', ')}`);
        }
    }));

test('an unlock is worth nothing while the system that would use what it opens is off', { skip }, () =>
    withMod(async (game) => {
        const plan = (on) =>
            game.eval((on) => {
                // Seasons are switched by the season planner, the dragon's drops come from petting,
                // fortunes from clicking the news ticker, and Sugar frenzy from the lump system.
                for (const name of ['autoSeasons', 'petDragon', 'autoFortune', 'sugarFrenzy']) FrozenCookies[name] = on ? 1 : 0;
                return MushieCookies.planHeavenly(Game, FrozenCookies, 1e13, 1e13, { runSeconds: 86400 }).buy.map((b) => ({ name: b.name, for: b.for }));
            }, on);
        await game.eval(() => {
            lateBakery(['Legacy', 'Heavenly cookies', 'How to bake your dragon', 'Wrinkly cookies', 'Stevia Caelestis', 'Sugar baking']);
            Game.dragonLevel = 10;
            Game.lumps = 100;
            Game.CalculateGains();
        });
        const off = await plan(false);
        const on = await plan(true);
        const bought = (list, name) => list.some((b) => b.name === name && b.for === name);
        for (const name of ['Season switcher', 'Starsnow', 'Keepsakes', 'Pet the dragon', 'Fortune cookies', 'Sugar craving']) {
            assert.ok(!bought(off, name), `${name} bought for itself with its user off: ${off.map((b) => b.name).join(', ')}`);
        }
        for (const name of ['Season switcher', 'Pet the dragon', 'Fortune cookies', 'Sugar craving']) {
            assert.ok(on.some((b) => b.name === name), `${name} not bought with its user on: ${on.map((b) => b.name).join(', ')}`);
        }
    }));

test('the lump upgrades are worth the lumps they add: Stevia alone pays when Sugar baking is owned', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            lateBakery(['Legacy', 'Heavenly cookies', 'Wrinkly cookies', 'Sugar baking']);
            Game.lumps = 50; // test fixture: each lump under 100 is 1% of CpS
            Game.CalculateGains();
            const plan = MushieCookies.planHeavenly(Game, FrozenCookies, 1e12, 1e12, { runSeconds: 3 * 86400 });
            const stevia = plan.buy.find((b) => b.name === 'Stevia Caelestis');
            // The best use of a lump here: a level on the top building, or 1/150 of CpS held.
            const total = Game.ObjectsById.reduce((s, b) => s + b.storedTotalCps, 0);
            const bestLevel = Math.max(...Game.ObjectsById.map((b) => (b.storedTotalCps / total) * 0.01 / (b.level + 1)));
            return { names: plan.buy.map((b) => b.name), stevia, lump: Math.max(bestLevel, 0.01 / 1.5) };
        });
        assert.ok(out.stevia, out.names.join(', '));
        // 22 h against 23 h ripening: about 0.049 lumps a day, over half of 3 days.
        const expected = ((24 / 22 - 24 / 23) * 1.0395 * out.lump * 3) / 2;
        assert.ok(Math.abs(out.stevia.share - expected) < expected * 0.05, `Stevia's share ${out.stevia.share}, expected about ${expected}`);
    }));

test('a permanent slot goes to what the next run would miss longest, not to the biggest share', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            lateBakery(['Legacy', 'Permanent upgrade slot I']);
            Game.Upgrades['Kitten helpers'].earn();
            Game.CalculateGains();
            const all = MushieCookies.rankPermanentSlots(Game, FrozenCookies, {});
            const biggest = all.reduce((a, b) => (b.share > a.share ? b : a));
            // The biggest share came back a moment into the run; everything else near its end.
            const reacquire = {};
            for (const c of all) reacquire[c.id] = c.id === biggest.id ? 1 : Game.cookiesEarned * 0.9;
            const ranking = MushieCookies.rankPermanentSlots(Game, FrozenCookies, { reacquire, runCookies: Game.cookiesEarned });
            const assigned = MushieCookies.assignPermanentSlots(Game, ranking);
            return {
                candidates: all.length,
                biggest: biggest.name,
                first: ranking[0].name,
                firstShare: ranking[0].share,
                value: ranking[0].value,
                slot: Game.UpgradesById[Game.permanentUpgrades[0]].name,
                assigned: assigned.length,
            };
        });
        assert.ok(out.candidates > 10, `fixture: ${out.candidates} candidates`);
        assert.notEqual(out.first, out.biggest, `${out.biggest} is rebought at once, so it is not worth the slot`);
        assert.ok(Math.abs(out.value - out.firstShare * 0.9) < 1e-9, 'worth its share over the nine tenths of the run baked before it returns');
        assert.equal(out.slot, out.first, 'the slot takes the top of the ranking');
    }));

test('the heavenly system records how far into the run the buyer bought each upgrade', { skip }, () =>
    withMod(async (game) => {
        await game.eval(() => {
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            FrozenCookies.autoAscendToggle = 1;
            FCStart();
        });
        await game.advanceSeconds(20 * 60);
        const out = await game.eval(() => {
            const record = MushieCookies.heavenly.reacquired();
            const bought = Object.values(Game.UpgradesById).filter((u) => u.bought && u.pool !== 'prestige');
            return {
                bought: bought.map((u) => u.id),
                record,
                earned: Game.cookiesEarned,
                prices: Object.fromEntries(bought.map((u) => [u.id, u.getPrice()])),
            };
        });
        assert.ok(out.bought.length >= 5, `fixture: the buyer bought ${out.bought.length} upgrades`);
        for (const id of out.bought) {
            assert.ok(out.record[id] > 0, `upgrade ${id} has no record`);
            assert.ok(out.record[id] <= out.earned, `upgrade ${id} recorded after the run's end`);
        }
        const values = out.bought.map((id) => out.record[id]);
        assert.ok(new Set(values).size > 1, 'records differ by when each was bought');
    }));
