import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

async function withMarket(run) {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e15);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank']) Game.Objects[name].buy(50);
            Game.Objects['Bank'].level = 3;
            Game.LoadMinigames();
        });
        await game.waitFor(() => !!(Game.Objects['Bank'].minigame && Game.Objects['Bank'].minigame.goodsById));
        return await run(game);
    } finally {
        await game.close();
    }
}

test('the ported price model matches the game tick for tick, from the same random draws', { skip }, () =>
    withMarket(async (game) => {
        const out = await game.eval(() => {
            const M = Game.Objects['Bank'].minigame;
            const copy = () => M.goodsById.map((g) => ({ id: g.id, val: g.val, d: g.d, mode: g.mode, dur: g.dur }));
            const mismatches = [];
            let ticks = 0;
            for (let round = 0; round < 300; round++) {
                const mine = copy();
                const seed = 'market-check-' + round;
                Math.seedrandom(seed);
                M.tick();
                Math.seedrandom(seed);
                MushieCookies.tickMarket(mine, { bankLevel: Game.Objects['Bank'].level, dragonBoost: Game.auraMult('Supreme Intellect') }, Math.random);
                Math.seedrandom();
                M.goodsById.forEach((g, i) => {
                    const m = mine[i];
                    if (g.val !== m.val || g.d !== m.d || g.mode !== m.mode || g.dur !== m.dur) mismatches.push({ round, good: i, game: [g.val, g.d, g.mode, g.dur], port: [m.val, m.d, m.mode, m.dur] });
                });
                ticks++;
            }
            const modes = new Set();
            M.goodsById.forEach((g) => modes.add(g.mode));
            return { ticks, goods: M.goodsById.length, mismatches: mismatches.slice(0, 3), count: mismatches.length };
        });
        assert.equal(out.goods, 18);
        assert.equal(out.ticks, 300);
        assert.equal(out.count, 0, JSON.stringify(out.mismatches));
    }));

const failures = (status) =>
    Object.entries(status)
        .filter(([, s]) => s.failures > 0)
        .map(([name, s]) => `${name}: ${s.lastError}`);

// Storage needs no test of its own: buyGood clamps every order to the free room
// (minigameMarket.js:215-216), whatever the mod asks for.
test('auto trading buys low and sells high', { skip }, () =>
    withMarket(async (game) => {
        await game.eval(() => {
            FrozenCookies.autoMarket = 1;
            FrozenCookies.autoBuy = 0; // trading alone
            Game.cookies = 1e15;
        });
        await game.advanceSeconds(12 * 3600);
        const out = await game.eval(() => ({ report: MushieCookies.market.report(), status: MushieCookies.status() }));
        assert.ok(out.report.buys > 0, 'should have bought');
        assert.ok(out.report.sells > 0, 'should have sold');
        assert.ok(out.report.profit > 0, `realised profit should be positive, got ${out.report.profit}`);
        assert.deepEqual(failures(out.status), []);
        assert.deepEqual(game.errors, []);
    }));

// The bank is the mod's to guard: the market may spend only what the buyer is not holding.
test('auto trading never spends the reserve the buyer holds', { skip }, () =>
    withMarket(async (game) => {
        await game.eval(() => {
            // Record the bank around every purchase the market makes. Only the market buys stock.
            const M = Game.Objects['Bank'].minigame;
            const buyGood = M.buyGood;
            window.__buys = [];
            M.buyGood = function (id, n) {
                const good = M.goodsById[id];
                const before = Game.cookies;
                const reserve = MushieCookies.buyer.reserve();
                const room = M.getGoodMaxStock(good) - good.stock;
                const bought = buyGood.call(M, id, n);
                if (bought) window.__buys.push({ before, after: Game.cookies, reserve, n, room });
                return bought;
            };
            // Buying on, with a reserve the buyer always holds (the "hold bank" option, 30 minutes
            // of CpS), and a bank a little above it, so buying and trading compete for the rest.
            FrozenCookies.autoBuy = 1;
            FrozenCookies.holdManBank = 1;
            FrozenCookies.manBankMins = 30;
            FrozenCookies.autoMarket = 1;
            Game.cookies = Game.unbuffedCps * 60 * 45;
        });
        // Three game hours: 180 price ticks and about 10,000 trading ticks.
        await game.advanceSeconds(3 * 3600);
        const out = await game.eval(() => ({ buys: window.__buys, status: MushieCookies.status() }));
        assert.ok(out.buys.every((b) => b.reserve > 0), 'the buyer should have held a reserve at every purchase');
        // Allows the last bit of rounding: the game prices an order as cps × price × overhead × n.
        const intoReserve = out.buys.filter((b) => b.after < b.reserve * (1 - 1e-9));
        assert.equal(intoReserve.length, 0, `${intoReserve.length} of ${out.buys.length} purchases spent the reserve: ${JSON.stringify(intoReserve.slice(0, 3))}`);
        // The claim is only tested when the bank, not the free room, limited a purchase.
        const limited = out.buys.filter((b) => b.n < b.room);
        assert.ok(limited.length >= 10, `only ${limited.length} of ${out.buys.length} purchases were limited by the bank`);
        assert.deepEqual(failures(out.status), []);
        assert.deepEqual(game.errors, []);
    }));
