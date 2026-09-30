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

test('rests in the calendar season while it still has drops to give, visiting Christmas only for the hat', { skip }, () =>
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
        const seen = new Set();
        for (let i = 0; i < 18; i++) {
            await game.advanceSeconds(10);
            seen.add(await game.eval(() => Game.season));
        }
        const out = await game.eval(() => ({
            season: Game.season,
            uses: Game.seasonUses,
            hat: Game.Has('A festive hat'),
            santa: Game.santaLevel,
            hearts: Game.heartDrops.filter((n) => Game.Has(n)).length,
            plan: MushieCookies.seasons.report().plan,
            status: MushieCookies.status(),
        }));
        // A festive hat unlocks within seconds of Christmas and opens Santa in every season: worth a
        // switch, and the way back to Easter is a free cancel. Only Easter is rested in.
        assert.equal(out.hat, 1, `A festive hat: plan ${JSON.stringify(out.plan)}`);
        assert.ok(out.santa > 0, `Santa level ${out.santa}`);
        assert.equal(out.season, 'easter', JSON.stringify(out.plan));
        assert.ok(seen.has('christmas'), [...seen].join());
        // One switch to Christmas, and at most one to Valentine's for hearts; both came back for free.
        assert.ok(out.uses >= 1 && out.uses <= 2, `${out.uses} switches`);
        if (out.uses === 2) assert.ok(out.hearts > 0, 'a switch was paid for without the hearts it was for');
        assert.deepEqual(failures(out.status), []);
    }));

test('with Valentine\'s as the calendar season, hearts are visited for from Christmas for free, then Christmas at the next price', { skip }, () =>
    withMod(async (game) => {
        await bakery(game, { hoursIn: 4 });
        await game.eval(() => {
            // Fixture: the calendar says Valentine's, and the run rests in Christmas, as a switch
            // made earlier left it.
            Game.baseSeason = 'valentines';
            Game.season = 'valentines';
            Game.Upgrades['Festive biscuit'].buy();
        });
        const before = await game.eval(() => ({ season: Game.season, uses: Game.seasonUses }));
        assert.deepEqual(before, { season: 'christmas', uses: 1 }, 'fixture');
        await game.advanceSeconds(180);
        const out = await game.eval(() => ({
            season: Game.season,
            uses: Game.seasonUses,
            hearts: Game.heartDrops.filter((n) => Game.Has(n)).length,
            report: MushieCookies.seasons.report(),
            status: MushieCookies.status(),
        }));
        assert.ok(out.hearts >= 2, `${out.hearts} hearts bought; plan ${JSON.stringify(out.report.plan)}`);
        assert.equal(out.season, 'christmas', JSON.stringify(out.report.plan));
        assert.equal(out.uses, 2, 'the cancel to Valentine\'s is not a use; Christmas after it is one');
        assert.deepEqual(failures(out.status), []);
    }));

test('the last Santa level is taken for Santa\'s dominion once every drop is out', { skip }, () =>
    withMod(async (game) => {
        await bakery(game);
        await game.eval(() => {
            // Fixture: Santa at level 13 with all 14 of his drops found, and a bank for the last level.
            Game.Upgrades['A festive hat'].earn();
            for (const n of Game.santaDrops) Game.Unlock(n);
            Game.santaLevel = 13;
            Game.Earn(1e18);
        });
        await game.advanceSeconds(60);
        const out = await game.eval(() => ({ santa: Game.santaLevel, dominion: Game.Has("Santa's dominion"), offers: MushieCookies.seasons.report().offers }));
        assert.equal(out.santa, 14, JSON.stringify(out.offers));
        assert.equal(out.dominion, 1, 'the buyer buys the dominion the last level unlocks');
    }));

test('with Autobuy off, switches and Santa levels spend only what the buyer is not holding', { skip }, () =>
    withMod(async (game) => {
        await bakery(game);
        await game.eval(() => {
            FrozenCookies.autoBuy = 0;
            // The player asks the buyer to hold a bank far larger than this one.
            FrozenCookies.holdManBank = 1;
            FrozenCookies.manBankMins = 1e12;
            Game.Upgrades['A festive hat'].earn(); // fixture: Santa's Evolve is open, level 1 costs 1 cookie
        });
        await game.advanceSeconds(60);
        const held = await game.eval(() => ({
            season: Game.season,
            uses: Game.seasonUses,
            santa: Game.santaLevel,
            reserve: MushieCookies.buyer.reserve(),
            bank: Game.cookies,
            last: MushieCookies.seasons.report().last,
        }));
        assert.equal(held.season, '', `switched out of the held bank: ${held.last}`);
        assert.equal(held.uses, 0);
        assert.equal(held.santa, 0, `Santa levelled out of the held bank: ${held.last}`);
        assert.ok(held.reserve > held.bank, `the buyer holds ${held.reserve} of a ${held.bank} bank`);
        // Released, the same bank pays for both.
        await game.eval(() => {
            FrozenCookies.holdManBank = 0;
            MushieCookies.buyer.invalidate(); // fixture: re-rank now rather than on the next store change
        });
        await game.advanceSeconds(60);
        const free = await game.eval(() => ({ season: Game.season, santa: Game.santaLevel }));
        assert.equal(free.season, 'christmas');
        assert.ok(free.santa > 0);
    }));

test('a switch is ranked and paid at its live price, never out of the reserve', { skip }, () =>
    withMod(async (game) => {
        await bakery(game);
        // The plan to go to Christmas is made while the bank cannot cover it, so the offer waits.
        const bank = await game.eval(() => {
            const before = Game.cookies;
            Game.cookies = 1e8;
            return before;
        });
        await game.advanceSeconds(12);
        const out = await game.eval((bank) => {
            const offered = MushieCookies.seasons.report().offers.find((o) => / season$/.test(o.name));
            // Fixture: income grows after the plan was priced, and with it the switch price.
            for (let i = 0; i < 12; i++) Game.ObjectsById[i].getFree(100);
            Game.CalculateGains();
            Game.cookies = bank;
            MushieCookies.buyer.invalidate();
            MushieCookies.buyer.next();
            const row = MushieCookies.buyer.ranking().find((c) => c.kind === 'offer' && / season$/.test(c.name));
            const reserve = MushieCookies.buyer.reserve();
            const live = Game.Upgrades['Festive biscuit'].getPrice();
            // The bank covers the reserve and the planned price, but not the live price.
            Game.cookies = reserve + live - 1;
            const bought = row ? row.buy() : null;
            return { planned: offered && offered.price, ranked: row && row.price, live, reserve, bought, season: Game.season, cookies: Game.cookies };
        }, bank);
        assert.ok(out.planned > 0 && out.live > out.planned, `fixture: planned ${out.planned}, live ${out.live}`);
        assert.equal(out.ranked, out.live, 'the buyer ranks the switch at its live price');
        assert.equal(out.season, '', 'the switch was paid out of the reserve');
        assert.ok(out.cookies >= out.reserve);
    }));

test('a Halloween hunt pops wrinklers for drops, and stops once all seven are in; Easter hunts by egg', { skip }, () =>
    withMod(async (game) => {
        // No Season switcher: the calendar's season is kept, so what ends the hunt is not a switch.
        await bakery(game, { switcher: false, hoursIn: 24 });
        await game.eval(() => {
            // Fixture: the calendar says Halloween; a grandmapocalypse with the Wrinkler doormat, so
            // an emptied slot refills at once; Spooky cookies (a drop one pop in five).
            Game.baseSeason = 'halloween';
            Game.season = 'halloween';
            Game.elderWrath = 3;
            Game.Upgrades['Wrinkler doormat'].earn();
            Game.Win('Spooky cookies');
            FrozenCookies.autoWrinkler = 1;
            Game.CalculateGains();
        });
        const read = () =>
            game.eval(() => ({
                season: Game.season,
                found: Game.halloweenDrops.filter((n) => Game.HasUnlocked(n) || Game.Has(n)).length,
                huntPops: MushieCookies.wrinklers.report().huntPops,
                hunting: MushieCookies.wrinklers.report().hunting,
                request: MushieCookies.seasons.report().hunting,
                // Seconds to the next Halloween cookie, as the season planner values the season.
                nextDrop: (MushieCookies.seasons.report().values || { halloween: {} }).halloween.nextDrop,
            }));
        await game.advanceSeconds(30);
        const first = await read();
        assert.equal(first.request && first.request.season, 'halloween', JSON.stringify(first));
        assert.equal(first.hunting, true, 'the wrinkler system hunts what the season system asked for');
        assert.ok(first.huntPops > 0);
        // No wrinkler had been popped before the hunt: the planner values it at the hunt's pop rate.
        assert.ok(first.nextDrop < 60, `next Halloween cookie valued ${first.nextDrop} s away`);
        let out = first;
        for (let i = 0; i < 15 && out.found < 7; i++) {
            await game.advanceSeconds(60);
            out = await read();
        }
        assert.equal(out.found, 7, `${out.found} of 7 after ${out.huntPops} hunting pops`);
        await game.advanceSeconds(10);
        const done = await read();
        await game.advanceSeconds(60);
        const after = await read();
        assert.equal(after.season, 'halloween');
        assert.equal(after.request, null, 'the season system still asks for a hunt');
        assert.equal(after.hunting, false);
        assert.equal(after.huntPops, done.huntPops, 'wrinklers were popped for drops that are all in');

        // Easter: the request values each egg, and the wrinkler system weighs the eggs by it.
        await game.eval(() => {
            Game.baseSeason = 'easter'; // fixture: the calendar turns to Easter
            Game.season = 'easter';
        });
        await game.advanceSeconds(30);
        const easter = await game.eval(() => ({
            request: MushieCookies.seasons.report().hunting,
            verdict: MushieCookies.wrinklers.report().hunt,
            huntPops: MushieCookies.wrinklers.report().huntPops,
            status: MushieCookies.status(),
        }));
        assert.equal(easter.request && easter.request.season, 'easter', JSON.stringify(easter.request));
        assert.ok(easter.verdict && easter.verdict.perPop > 0, `the wrinkler system values a pop at ${easter.verdict && easter.verdict.perPop}`);
        assert.ok(easter.huntPops > after.huntPops, 'no wrinkler was popped for eggs');
        assert.deepEqual(failures(easter.status), []);
        assert.deepEqual(game.errors, []);
    }));

test('a drop is worth the same in any season, and while a hunt runs', { skip }, () =>
    withMod(async (game) => {
        // A drop is kept for the rest of the run, which a switcher can rest in Christmas. Valued on
        // the income of the moment, a Halloween cookie was worth the reindeer's share more from
        // Christmas than from Halloween, and the wrinklers' share more than during a hunt: the
        // planner switched in and straight back out.
        await bakery(game);
        await game.eval(() => {
            // Fixture: a grandmapocalypse whose wrinklers are popped for their cookies, in Christmas.
            // Unholy bait, not the Wrinkler doormat: a slot the hunt empties stays empty for
            // minutes, as it does in a real grandmapocalypse.
            Game.elderWrath = 3;
            Game.Upgrades['Unholy bait'].earn();
            Game.baseSeason = 'christmas';
            Game.season = 'christmas';
            Game.CalculateGains();
            FrozenCookies.autoWrinkler = 1;
            FrozenCookies.autoBuy = 0; // the bakery stays as it is between the two measurements
            FrozenCookies.autoSeasons = 0; // the test moves the season
        });
        // Half an hour: every slot spawns (about 222 s a slot) and attaches.
        await game.advanceSeconds(1800);
        const measure = () =>
            game.eval(() => {
                const s = MushieCookies.readState(Game, FrozenCookies);
                const g = MushieCookies.seasons.gains();
                return {
                    reindeer: !!s.reindeer,
                    hunting: MushieCookies.wrinklers.report().hunting,
                    inPlay: Game.wrinklers.filter((w) => w.phase > 0).length,
                    gains: { santa: g.santa, christmas: g.christmas, halloween: g.halloween, heart: g.heart, egg: g.egg },
                };
            });
        const christmas = await measure();
        assert.equal(christmas.reindeer, true, 'the fixture has reindeer to click');
        assert.equal(christmas.inPlay, 10, 'fixture: every slot is in play before the hunt');
        await game.eval(() => {
            Game.baseSeason = 'halloween'; // fixture: the calendar turns to Halloween
            Game.season = 'halloween';
            Game.CalculateGains();
            MushieCookies.wrinklers.hunt({ season: 'halloween', value: () => 1e30 });
        });
        await game.advanceSeconds(5);
        const halloween = await measure();
        assert.equal(halloween.hunting, true, 'the fixture hunts');
        assert.ok(halloween.inPlay < 3, `fixture: the hunt emptied the slots (${halloween.inPlay} in play)`);
        for (const [name, gain] of Object.entries(christmas.gains)) {
            assert.ok(gain > 0, `${name} is worth something`);
            const other = halloween.gains[name];
            assert.ok(Math.abs(other - gain) <= 0.005 * gain, `${name}: ${gain} in Christmas, ${other} in Halloween while hunting`);
        }
    }));

test('drop values are measured against a recalculated baseline, even right after a purchase', { skip }, () =>
    withMod(async (game) => {
        await bakery(game);
        const out = await game.eval(() => {
            FrozenCookies.autoSeasons = 0;
            FrozenCookies.autoBuy = 0;
            const settled = MushieCookies.seasons.gains();
            // A purchase leaves the game's CpS stale until its next recalculation (Upgrade.buy and
            // Object.buy only set recalculateGains, main.js:9557, 7847): the baseline must not be
            // read from it. Earning Increased merriness (+15%) leaves the same state.
            Game.Upgrades['Increased merriness'].earn();
            const right = MushieCookies.seasons.gains();
            Game.CalculateGains();
            const after = MushieCookies.seasons.gains();
            return { settled: settled.christmas, right: right.christmas, after: after.christmas };
        });
        assert.ok(out.settled > 0);
        assert.ok(Math.abs(out.right - out.after) <= 1e-6 * out.after, `${out.right} right after the purchase, ${out.after} once recalculated`);
    }));
