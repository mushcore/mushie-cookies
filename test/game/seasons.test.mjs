// The season system in the real game: fair play, switching through the buyer's reserve, Santa,
// the reindeer term of the income model, and a Valentine's visit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

async function withMod(run) {
    const game = await launchWithMod();
    try {
        return await run(game);
    } finally {
        await game.close();
    }
}

const failures = (status) =>
    Object.entries(status)
        .filter(([, s]) => s.failures > 0)
        .map(([name, s]) => `${name}: ${s.lastError}`);

/** Test fixture: a bakery with about 1e9 CpS, golden cookies off so runs are deterministic. */
const bakery = (game, { switcher = true, hoursIn = 0 } = {}) =>
    game.eval(
        ({ switcher, hoursIn }) => {
            Game.shimmerTypes.golden.spawnConditions = () => false;
            Game.Earn(1e20);
            for (let i = 0; i < 12; i++) Game.ObjectsById[i].buy(100);
            if (switcher) Game.Upgrades['Season switcher'].earn();
            if (hoursIn) Game.startDate = Date.now() - hoursIn * 3600 * 1000;
            Game.CalculateGains();
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoReindeer = 1;
            FrozenCookies.autoSeasons = 1;
            FCStart();
        },
        { switcher, hoursIn }
    );

test('never switches a season, or buys a season biscuit, without Season switcher', { skip }, () =>
    withMod(async (game) => {
        await bakery(game, { switcher: false });
        // The biscuits unlocked by hand, as a Born-again run leaves them: the store must still
        // not be used without the switcher (the inherited Halloween switch did exactly that).
        await game.eval(() => {
            for (const id of [182, 183, 184, 185, 209]) Game.UpgradesById[id].unlocked = 1;
        });
        await game.advanceSeconds(120);
        const out = await game.eval(() => ({
            season: Game.season,
            uses: Game.seasonUses,
            bought: [182, 183, 184, 185, 209].filter((id) => Game.UpgradesById[id].bought),
            status: MushieCookies.status(),
        }));
        assert.equal(out.season, '');
        assert.equal(out.uses, 0);
        assert.deepEqual(out.bought, []);
        assert.deepEqual(failures(out.status), []);
    }));

test('with Season switcher, settles in Christmas through the buyer, then buys the hat and levels Santa', { skip }, () =>
    withMod(async (game) => {
        await bakery(game);
        // Not while the bank is below the price: the buyer holds the reserve first.
        const poor = await game.eval(() => {
            const before = Game.cookies;
            Game.cookies = 1e8; // fixture: less than the 1e9 base price of a switch
            return before;
        });
        await game.advanceSeconds(20);
        assert.equal(await game.eval(() => Game.season), '', 'a switch the bank cannot cover was made');
        await game.eval((c) => {
            Game.cookies = c;
        }, poor);
        await game.advanceSeconds(120);
        const out = await game.eval(() => ({
            season: Game.season,
            uses: Game.seasonUses,
            hat: Game.Has('A festive hat'),
            santa: Game.santaLevel,
            drops: Game.santaDrops.filter((n) => Game.HasUnlocked(n)).length,
            report: MushieCookies.seasons.report(),
            status: MushieCookies.status(),
            buildings: Game.ObjectsById.reduce((s, b) => s + b.amount, 0),
            counter: Game.BuildingsOwned,
        }));
        assert.equal(out.season, 'christmas', JSON.stringify(out.report.plan));
        assert.equal(out.uses, 1, 'one switch, straight to the season to rest in');
        assert.equal(out.hat, 1, 'A festive hat is bought once Christmas unlocks it');
        assert.ok(out.santa >= 6, `Santa level ${out.santa}: the first levels cost next to nothing`);
        // The hat brings one of Santa's drops, and each level another (main.js:10262, 14754-14759).
        assert.equal(out.drops, Math.min(14, out.santa + 1));
        assert.equal(out.counter, out.buildings, 'a what-if leaked');
        assert.deepEqual(failures(out.status), []);
        assert.deepEqual(game.errors, []);
    }));

test('in Christmas the reindeer upgrades are worth buying; Toy workshop is an enabler, Weighted sleighs is not', { skip }, () =>
    withMod(async (game) => {
        await bakery(game);
        const out = await game.eval(() => {
            Game.Upgrades['Festive biscuit'].buy(); // fixture: Christmas, as a player would switch
            for (const n of ['Reindeer baking grounds', 'Ho ho ho-flavored frosting', 'Weighted sleighs', 'Toy workshop']) Game.Unlock(n);
            FrozenCookies.autoSeasons = 0;
            FrozenCookies.autoBuy = 0;
            Game.RebuildUpgrades();
            Game.CalculateGains(); // fixture: the switch and the unlocks recalculated before measuring
            window.__logged = [];
            const log = console.log;
            console.log = function (...args) {
                window.__logged.push(args.join(' '));
                return log.apply(console, args);
            };
            MushieCookies.buyer.invalidate();
            MushieCookies.buyer.next();
            const row = (name) => MushieCookies.buyer.ranking().find((c) => c.name === name);
            const inChristmas = {
                grounds: row('Reindeer baking grounds').deltaIncome,
                hohoho: row('Ho ho ho-flavored frosting').deltaIncome,
                sleighs: row('Weighted sleighs').deltaIncome,
                reindeer: MushieCookies.buyer.income().reindeer,
                cps: Game.unbuffedCps,
            };
            FrozenCookies.autoReindeer = 0; // nothing clicks them: they earn nothing
            MushieCookies.buyer.invalidate();
            MushieCookies.buyer.next();
            const unclicked = MushieCookies.buyer.income().reindeer;
            return { inChristmas, unclicked };
        });
        const c = out.inChristmas;
        // One reindeer every ~234 s paying 60 s of CpS: about a quarter of CpS.
        assert.ok(c.reindeer > 0.2 * c.cps && c.reindeer < 0.32 * c.cps, `reindeer ${c.reindeer} against CpS ${c.cps}`);
        assert.ok(c.grounds > 0.2 * c.cps, `Reindeer baking grounds ${c.grounds}`);
        assert.ok(c.hohoho > 0.2 * c.cps, `Ho ho ho ${c.hohoho}`);
        assert.ok(!(c.sleighs > 0), 'Weighted sleighs does nothing when reindeer are clicked on sight');
        assert.equal(out.unclicked, 0);
        // Toy workshop's discount on upgrades is invisible to the model; it is bought as an enabler.
        await game.eval(() => {
            FrozenCookies.autoReindeer = 1;
            FrozenCookies.autoBuy = 1;
            FCStart();
        });
        await game.advanceSeconds(10);
        const enablers = await game.eval(() => window.__logged.filter((line) => line.includes('(enabler)')));
        assert.ok(enablers.some((line) => line.includes('Toy workshop')), enablers.join(' | '));
        assert.ok(!enablers.some((line) => line.includes('Weighted sleighs')), enablers.join(' | '));
    }));

test('a Valentine visit collects the hearts that pay, then settles in Christmas', { skip }, () =>
    withMod(async (game) => {
        await bakery(game, { hoursIn: 4 });
        await game.advanceSeconds(180);
        const out = await game.eval(() => ({
            season: Game.season,
            uses: Game.seasonUses,
            hearts: Game.heartDrops.filter((n) => Game.Has(n)).length,
            report: MushieCookies.seasons.report(),
            status: MushieCookies.status(),
        }));
        assert.ok(out.hearts >= 2, `${out.hearts} hearts bought; plan ${JSON.stringify(out.report.plan)}`);
        assert.equal(out.season, 'christmas');
        assert.equal(out.uses, 2, 'Valentine\'s first, then Christmas: two switches, not three');
        assert.deepEqual(failures(out.status), []);
    }));

test('stays in the calendar season while it still has drops to give', { skip }, () =>
    withMod(async (game) => {
        // Four hours in: the first egg, over an hour away at this golden cookie rate, is expected
        // before the run ends.
        await bakery(game, { hoursIn: 4 });
        await game.eval(() => {
            // Fixture: the calendar says Easter, and golden cookies (the eggs' source) are on.
            Game.baseSeason = 'easter';
            Game.season = 'easter';
            Game.shimmerTypes.golden.spawnConditions = () => true;
            FrozenCookies.autoGC = 1;
        });
        await game.advanceSeconds(60);
        const out = await game.eval(() => ({ season: Game.season, uses: Game.seasonUses, plan: MushieCookies.seasons.report().plan }));
        assert.equal(out.season, 'easter', JSON.stringify(out.plan));
        assert.equal(out.uses, 0);
    }));
