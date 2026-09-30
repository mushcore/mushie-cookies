import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

const HEAVENLY = ['Heavenly chip secret', 'Heavenly cookie stand', 'Heavenly bakery', 'Heavenly confectionery', 'Heavenly key'];
const MICE = [
    'Plastic mouse', 'Iron mouse', 'Titanium mouse', 'Adamantium mouse', 'Unobtainium mouse', 'Eludium mouse', 'Wishalloy mouse', 'Fantasteel mouse',
    'Nevercrack mouse', 'Armythril mouse', 'Technobsidian mouse', 'Plasmarble mouse', 'Miraculite mouse', 'Aetherice mouse', 'Omniplast mouse',
];

/**
 * A late-run bakery with 400 Wizard towers at level 1 (max magic 90, enough for two casts once
 * towers are sold), no natural golden cookies, and prestige standing in for a late run's
 * multipliers: CpS is large enough that a Wizard tower costs a fraction of a second of it, as the
 * towers a buyer bought do, and every click is worth a share of CpS through the mouse upgrades.
 */
async function withLateBakery(run) {
    const game = await launchWithMod();
    try {
        await game.eval((s) => {
            Game.shimmerTypes.golden.spawnConditions = () => false;
            Game.prestige = 1e30;
            for (const name of s.upgrades) Game.Upgrades[name].earn();
            Game.Earn(1e36);
            Game.Objects['Wizard tower'].buy(400);
            Game.Objects['Wizard tower'].level = 1;
            Game.LoadMinigames();
        }, { upgrades: HEAVENLY.concat(MICE) });
        await game.waitFor(() => !!(Game.Objects['Wizard tower'].minigame && Game.Objects['Wizard tower'].minigame.spells));
        await game.eval(() => {
            Game.Objects['Wizard tower'].minigame.computeMagicM();
            Game.CalculateGains();
        });
        return await run(game);
    } finally {
        await game.close();
    }
}

/** Burns casts with Haggler's Charm until the next two Force the Hand of Fate outcomes are `pair`. */
const burnTo = (pair) => {
    const M = Game.Objects['Wizard tower'].minigame;
    const next = (i) => MushieCookies.forecastFate(Game, M, i).outcome;
    for (let i = 0; i < 600 && !(next(0) === pair[0] && next(1) === pair[1]); i++) {
        M.magic = M.magicM;
        M.castSpell(M.spells["haggler's charm"]);
    }
    Game.killBuffs();
    M.magic = M.magicM;
    return [next(0), next(1)];
};

/**
 * Records, by game frame, every spell cast (with the cookie it made and whether that cookie was
 * popped), every Wizard tower sale and every purchase of a building or upgrade.
 */
const instrument = () => {
    const M = Game.Objects['Wizard tower'].minigame;
    const towers = Game.Objects['Wizard tower'];
    const log = (window.__log = []);
    const castSpell = M.castSpell;
    M.castSpell = function (spell, obj) {
        const entry = { kind: 'cast', T: Game.T, spell: spell === M.spells['hand of fate'] ? 'fate' : spell.name, towers: towers.amount, magicM: M.magicM };
        const before = new Set(Game.shimmers);
        const cast = castSpell.call(this, spell, obj);
        if (!cast) return cast;
        const made = Game.shimmers.find((s) => !before.has(s));
        entry.made = made ? made.force : null;
        entry.popped = false;
        if (made) {
            const pop = made.pop;
            made.pop = function () {
                entry.popped = true;
                return pop.apply(this, arguments);
            };
        }
        log.push(entry);
        return cast;
    };
    const sell = towers.sell;
    towers.sell = function (amount, bypass) {
        const before = towers.amount;
        const out = sell.call(this, amount, bypass);
        log.push({ kind: 'sell', T: Game.T, before, after: towers.amount });
        return out;
    };
    for (const building of Game.ObjectsById) {
        const buy = building.buy;
        building.buy = function (amount) {
            const before = building.amount;
            const out = buy.call(this, amount);
            if (building.amount !== before) log.push({ kind: 'buy', T: Game.T, name: building.name, before, after: building.amount });
            return out;
        };
    }
    const buyUpgrade = Game.Upgrade.prototype.buy;
    Game.Upgrade.prototype.buy = function (bypass) {
        const had = this.bought;
        const out = buyUpgrade.call(this, bypass);
        if (this.bought && !had) log.push({ kind: 'buy', T: Game.T, name: this.name });
        return out;
    };
};

const settings = (over) => {
    Object.assign(
        FrozenCookies,
        { autoFate: 1, autoFTHOFCombo: 1, autoCasting: 0, auto100ConsistencyCombo: 0, autoClick: 1, cookieClickSpeed: 50, autoBuy: 0 },
        over
    );
};

/** Steps one frame at a time until `fn` holds, at most `limit` frames. */
async function stepUntil(game, fn, limit) {
    for (let i = 0; i < limit; i++) {
        if (await game.eval(fn)) return true;
        await game.advance(1);
    }
    return game.eval(fn);
}

const read = (game) =>
    game.eval(() => ({
        log: window.__log,
        report: MushieCookies.grimoire.report(),
        towers: Game.Objects['Wizard tower'].amount,
        buffs: Object.keys(Game.buffs),
        held: MushieCookies.buyer.held ? MushieCookies.buyer.held() : null,
        status: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`),
    }));

test('a forecast frenzy then click frenzy is double-cast: towers sold between the casts, both cookies popped, towers bought back', { skip }, () =>
    withLateBakery(async (game) => {
        const pair = await game.eval(burnTo, ['frenzy', 'click frenzy']);
        assert.deepEqual(pair, ['frenzy', 'click frenzy']);
        await game.eval(instrument);
        await game.eval(settings, {});
        await game.advance(45);
        const out = await read(game);
        const fate = out.log.filter((e) => e.kind === 'cast' && e.spell === 'fate');
        assert.deepEqual(fate.map((c) => c.made), ['frenzy', 'click frenzy'], JSON.stringify(out.report));
        assert.deepEqual(fate.map((c) => c.popped), [true, true], 'each cookie a cast makes is popped');
        const [first, second] = fate;
        // Max magic follows the sale on the game's next fifth frame (minigameGrimoire.js:485).
        assert.ok(second.T - first.T >= 1 && second.T - first.T <= 5, `${second.T - first.T} frames between the casts`);
        const sales = out.log.filter((e) => e.kind === 'sell');
        assert.equal(sales.length, 1);
        assert.equal(sales[0].T, first.T, 'the towers are sold right after the first cast');
        assert.equal(sales[0].before, first.towers);
        assert.equal(second.towers, sales[0].after);
        assert.ok(second.magicM < first.magicM, `the second cast is priced at the lower max magic: ${first.magicM} then ${second.magicM}`);
        // Everything sold is bought back in the frame of the second cast, and nothing else is bought.
        const buys = out.log.filter((e) => e.kind === 'buy');
        assert.deepEqual(buys, [{ kind: 'buy', T: second.T, name: 'Wizard tower', before: sales[0].after, after: first.towers }]);
        assert.equal(out.towers, first.towers);
        // The click frenzy runs on the frenzy.
        assert.ok(out.buffs.includes('Frenzy') && out.buffs.includes('Click frenzy'), out.buffs.join(', '));
        assert.equal(out.report.doubles, 1);
        assert.equal(out.report.casts, 2);
        assert.equal(out.held, false, 'the buyer is released');
        assert.deepEqual(out.status, []);
        assert.deepEqual(game.errors, []);
    }));

test('if the second cast cannot be made, the towers are bought back at once', { skip }, () =>
    withLateBakery(async (game) => {
        await game.eval(burnTo, ['frenzy', 'click frenzy']);
        await game.eval(instrument);
        await game.eval(settings, {});
        const cast = await stepUntil(game, () => window.__log.some((e) => e.kind === 'cast'), 45);
        assert.ok(cast, 'the first cast should have been made');
        // Nothing left to cast with.
        const mid = await game.eval(() => {
            Game.Objects['Wizard tower'].minigame.magic = 0;
            return { held: MushieCookies.buyer.held(), towers: Game.Objects['Wizard tower'].amount };
        });
        assert.equal(mid.held, true, 'the buyer is held while the towers are sold');
        assert.ok(mid.towers < 400);
        await game.advance(30);
        const out = await read(game);
        assert.equal(out.log.filter((e) => e.kind === 'cast').length, 1);
        assert.equal(out.towers, 400, 'the towers are bought back');
        assert.equal(out.report.doubles, 0);
        assert.equal(out.report.aborted, 1);
        assert.equal(out.held, false);
        assert.deepEqual(out.status, []);
        assert.deepEqual(game.errors, []);
    }));

test('the buyer buys nothing between the sale and the buy-back, and buys again after', { skip }, () =>
    withLateBakery(async (game) => {
        await game.eval(burnTo, ['frenzy', 'click frenzy']);
        await game.eval(instrument);
        await game.eval(settings, { autoBuy: 1 });
        const cast = await stepUntil(game, () => window.__log.some((e) => e.kind === 'cast'), 60);
        assert.ok(cast, 'the first cast should have been made');
        // Hold max magic where it was for six frames, so the sequence spans two of the buyer's ticks.
        await game.eval(() => {
            const M = Game.Objects['Wizard tower'].minigame;
            window.__compute = M.computeMagicM;
            M.computeMagicM = () => {};
        });
        await game.advance(6);
        await game.eval(() => {
            Game.Objects['Wizard tower'].minigame.computeMagicM = window.__compute;
        });
        await game.advance(40);
        // The second cast is a click frenzy, which the buyer stands aside for (src/systems/buyer.js):
        // 13 s here, with no duration upgrades (main.js:5561).
        await game.advanceSeconds(15);
        const out = await read(game);
        const fate = out.log.filter((e) => e.kind === 'cast' && e.spell === 'fate');
        assert.equal(fate.length, 2, JSON.stringify(out.report));
        const [first, second] = fate;
        assert.ok(second.T - first.T >= 7, `the window should span the buyer's ticks: ${second.T - first.T} frames`);
        const buys = out.log.filter((e) => e.kind === 'buy');
        assert.deepEqual(buys.filter((b) => b.T > first.T && b.T < second.T), [], 'bought while held');
        const atSecond = buys.filter((b) => b.T === second.T);
        assert.equal(atSecond.length, 1);
        assert.equal(atSecond[0].name, 'Wizard tower');
        assert.equal(atSecond[0].after, first.towers);
        assert.ok(buys.some((b) => b.T < first.T), 'the buyer was buying before');
        assert.ok(buys.some((b) => b.T > second.T), 'and buys again after');
        assert.equal(out.report.doubles, 1);
        assert.equal(out.held, false);
        assert.deepEqual(out.status, []);
        assert.deepEqual(game.errors, []);
    }));

test('while the towers are sold, every spender is kept off the whole buy-back, the refund included', { skip }, () =>
    withLateBakery(async (game) => {
        await game.eval(burnTo, ['frenzy', 'click frenzy']);
        await game.eval(instrument);
        await game.eval(settings, {});
        const cast = await stepUntil(game, () => window.__log.some((e) => e.kind === 'cast'), 45);
        assert.ok(cast, 'the first cast should have been made');
        // Hold max magic where it was, so the towers stay sold for a few frames.
        await game.eval(() => {
            const M = Game.Objects['Wizard tower'].minigame;
            window.__compute = M.computeMagicM;
            M.computeMagicM = () => {};
        });
        await game.advance(3);
        const mid = await game.eval(() => {
            const t = Game.Objects['Wizard tower'];
            const sale = window.__log.find((e) => e.kind === 'sell');
            return {
                sold: sale.before - sale.after,
                towers: t.amount,
                // What buying them back costs now (main.js:7797-7806).
                price: t.getSumPrice(sale.before - sale.after),
                kept: MushieCookies.buyer.kept('grimoire'),
                reserve: MushieCookies.buyer.reserve(),
            };
        });
        assert.ok(mid.sold > 0 && mid.towers === 400 - mid.sold, JSON.stringify(mid));
        // The sale's refund is in the bank: keeping only what the round trip loses would let another
        // spender (garden, market, dragon) take the refund, and the buy-back would come up short.
        assert.ok(mid.kept >= mid.price, `kept ${mid.kept}, buying back costs ${mid.price}`);
        assert.ok(mid.reserve >= mid.kept);
        await game.eval(() => {
            Game.Objects['Wizard tower'].minigame.computeMagicM = window.__compute;
        });
        const done = await stepUntil(game, () => MushieCookies.grimoire.report().doubles === 1, 10);
        const out = await read(game);
        assert.ok(done, JSON.stringify(out.report));
        assert.equal(out.towers, 400);
        assert.equal(await game.eval(() => MushieCookies.buyer.kept('grimoire')), 0, 'let go once the towers are back');
        assert.deepEqual(out.status, []);
        assert.deepEqual(game.errors, []);
    }));

test('while a double cast is forecast and mana fills, the buyer keeps the cookies the buy-back needs', { skip }, () =>
    withLateBakery(async (game) => {
        await game.eval(burnTo, ['frenzy', 'click frenzy']);
        const loss = await game.eval(() => {
            const M = Game.Objects['Wizard tower'].minigame;
            // Enough for the cast, not full: forecast casting holds the frenzy for a buff.
            M.magic = M.magicM - 5;
            Object.assign(FrozenCookies, { autoFate: 1, autoFTHOFCombo: 1, autoCasting: 0, auto100ConsistencyCombo: 0, autoClick: 1, cookieClickSpeed: 50, autoBuy: 0 });
            // 400 towers at level 1 keep 31 (test/unit/doublecast.test.mjs); a sale refunds a quarter.
            const refund = Game.Objects['Wizard tower'].getReverseSumPrice(369);
            return refund * 3;
        });
        await game.advance(16);
        const during = await game.eval(() => ({
            kept: MushieCookies.buyer.kept('grimoire'),
            reserve: MushieCookies.buyer.reserve(),
            casts: MushieCookies.grimoire.report().casts,
            decision: MushieCookies.grimoire.report().decision,
        }));
        assert.equal(during.casts, 0, JSON.stringify(during.decision));
        assert.ok(Math.abs(during.kept - loss) <= 1e-9 * loss, `kept ${during.kept}, the buy-back loses ${loss}`);
        assert.ok(during.reserve >= during.kept, 'what is kept counts in the reserve every spender respects');
        await game.eval(() => {
            FrozenCookies.autoFTHOFCombo = 0;
        });
        await game.advance(16);
        assert.equal(await game.eval(() => MushieCookies.buyer.kept('grimoire')), 0, 'let go once double casting is off');
        assert.deepEqual(game.errors, []);
    }));

test('nothing is kept for a pair whose worth rests on a buff that ends before mana is full', { skip }, () =>
    withLateBakery(async (game) => {
        // A Lucky, then a click frenzy: worth doubling only on a running Frenzy.
        const pair = await game.eval(burnTo, ['multiply cookies', 'click frenzy']);
        assert.deepEqual(pair, ['multiply cookies', 'click frenzy']);
        await game.eval(() => {
            Object.assign(FrozenCookies, { autoFate: 1, autoFTHOFCombo: 1, autoCasting: 0, auto100ConsistencyCombo: 0, autoClick: 1, cookieClickSpeed: 50, autoBuy: 0 });
            // Test fixture: a Frenzy with 60 s left, and mana about twenty minutes from full
            // (30 of 90, minigameGrimoire.js:486-488).
            Game.gainBuff('frenzy', 60, 7);
            Game.Objects['Wizard tower'].minigame.magic = 30;
        });
        await game.advance(16);
        const report = () =>
            game.eval(() => ({
                kept: MushieCookies.buyer.kept('grimoire'),
                decision: MushieCookies.grimoire.report().decision,
                casts: MushieCookies.grimoire.report().casts,
            }));
        const short = await report();
        assert.equal(short.casts, 0);
        assert.equal(short.kept, 0, `kept ${short.kept} for a pair castable only after the Frenzy: ${JSON.stringify(short.decision)}`);
        // The same pair while a Frenzy will still run once mana is full: its buy-back is kept.
        await game.eval(() => Game.gainBuff('frenzy', 3000, 7)); // adds to the running one (main.js:13765-13771)
        await game.advance(16);
        const long = await report();
        assert.equal(long.casts, 0);
        assert.ok(long.kept > 0, JSON.stringify(long.decision));
        assert.deepEqual(game.errors, []);
    }));

test('with golden cookies clicked as they spawn, a click frenzy natural boosts would carry anyway is not double-cast', { skip }, () =>
    withLateBakery(async (game) => {
        const pair = await game.eval(burnTo, ['frenzy', 'click frenzy']);
        assert.deepEqual(pair, ['frenzy', 'click frenzy']);
        await game.eval(instrument);
        await game.eval(() => {
            // Test fixture: golden cookies spawning about every two minutes (main.js:5231-5260),
            // their timer reset so none spawns during the test. The late bakery's only building
            // at 10 or more is its 400 Wizard towers, so a building special is a ×41 Manabloom.
            for (const name of ['Lucky day', 'Serendipity', 'Golden goose egg', 'Heavenly luck']) Game.Upgrades[name].earn();
            Game.shimmerTypes.golden.spawnConditions = () => true;
            Game.shimmerTypes.golden.time = 0;
            const M = Game.Objects['Wizard tower'].minigame;
            // Enough for the cast, not full: forecast casting holds the frenzy for a buff.
            M.magic = M.magicM - 5;
            Object.assign(FrozenCookies, { autoFate: 1, autoFTHOFCombo: 1, autoCasting: 0, auto100ConsistencyCombo: 0, autoClick: 1, cookieClickSpeed: 50, autoBuy: 0, autoGC: 0 });
        });
        const kept = () => game.eval(() => ({ kept: MushieCookies.buyer.kept('grimoire'), casts: MushieCookies.grimoire.report().casts }));
        await game.advance(16);
        // Left on screen, natural golden cookies give the click frenzy nothing to land on.
        const unclicked = await kept();
        assert.equal(unclicked.casts, 0);
        assert.ok(unclicked.kept > 0, 'the buy-back is kept while golden cookies are not clicked');
        await game.eval(() => {
            FrozenCookies.autoGC = 1;
        });
        await game.advance(16);
        const clicked = await kept();
        assert.equal(clicked.casts, 0);
        assert.equal(clicked.kept, 0, 'nothing is kept once they are clicked');
        // At a full bar the frenzy is cast, alone.
        await game.eval(() => {
            const M = Game.Objects['Wizard tower'].minigame;
            M.magic = M.magicM;
        });
        await game.advance(16);
        const out = await read(game);
        const fate = out.log.filter((e) => e.kind === 'cast' && e.spell === 'fate');
        assert.deepEqual(fate.map((c) => c.made), ['frenzy'], JSON.stringify(out.report));
        assert.equal(out.log.filter((e) => e.kind === 'sell').length, 0);
        assert.equal(out.report.double.action, 'single', out.report.double.reason);
        assert.deepEqual(out.status, []);
        assert.deepEqual(game.errors, []);
    }));

test('Double Cast FTHOF runs forecast casting with double casts; the inherited combo casts nothing', { skip }, () =>
    withLateBakery(async (game) => {
        // A good outcome next, one that pairs with nothing: the inherited combo would cast Haggler's
        // Charm at the full bar instead (fc_spells.js:790-807).
        const pair = await game.eval(burnTo, ['multiply cookies', 'multiply cookies']);
        assert.deepEqual(pair, ['multiply cookies', 'multiply cookies']);
        await game.eval(instrument);
        await game.eval(() => {
            Object.assign(FrozenCookies, { autoFate: 0, autoFTHOFCombo: 1, autoCasting: 0, auto100ConsistencyCombo: 0, autoClick: 0, autoBuy: 0 });
            FCStart();
        });
        await game.advanceSeconds(20);
        const out = await read(game);
        const casts = out.log.filter((e) => e.kind === 'cast');
        assert.deepEqual(casts.map((c) => [c.spell, c.made]), [['fate', 'multiply cookies']], JSON.stringify(out.report));
        assert.equal(out.report.casts, 1);
        assert.equal(out.log.filter((e) => e.kind === 'sell').length, 0, 'a Lucky before a Lucky is not worth selling towers for');
        assert.deepEqual(out.status, []);
        assert.deepEqual(game.errors, []);
    }));
