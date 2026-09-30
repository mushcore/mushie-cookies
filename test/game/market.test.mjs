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

test('auto trading buys low, sells high, and stays inside storage and budget', { skip }, () =>
    withMarket(async (game) => {
        await game.eval(() => {
            FrozenCookies.autoMarket = 1;
            FrozenCookies.autoBuy = 0; // trading alone, so the budget is easy to read
            Game.cookies = 1e15;
        });
        await game.advanceSeconds(12 * 3600);
        const out = await game.eval(() => {
            const M = Game.Objects['Bank'].minigame;
            return {
                report: MushieCookies.market.report(),
                overStock: M.goodsById.filter((g) => g.stock > M.getGoodMaxStock(g)).map((g) => g.name),
                failures: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => `${n}: ${s.lastError}`),
            };
        });
        assert.ok(out.report.buys > 0, 'should have bought');
        assert.ok(out.report.sells > 0, 'should have sold');
        assert.ok(out.report.profit > 0, `realised profit should be positive, got ${out.report.profit}`);
        assert.deepEqual(out.overStock, []);
        assert.deepEqual(out.failures, []);
        assert.deepEqual(game.errors, []);
    }));
