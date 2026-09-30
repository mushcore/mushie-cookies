// The market's bank: office upgrades, brokers and loans, and the cash the market may spend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

/** A mid-game bakery with the stock market open at bank level 3. */
async function withBank(run) {
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

const failures = (status) =>
    Object.entries(status)
        .filter(([, s]) => s.failures > 0)
        .map(([name, s]) => `${name}: ${s.lastError}`);

// M12: the inherited office upgrade rebought the sacrificed cursors with safeBuy, which buys while
// the bank covers the price (main.js:7834-7853) and so spent the buyer's reserve.
test('an office upgrade and the rebuy of its cursors never spend the reserve the buyer holds', { skip }, () =>
    withBank(async (game) => {
        // Half an hour of buying first, so the bakery's CpS is where an office pays.
        await game.eval(() => {
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoMarket = 1;
            FrozenCookies.holdManBank = 1; // a reserve the buyer always holds
            FrozenCookies.manBankMins = 30;
            FCStart();
        });
        await game.advanceSeconds(30 * 60);
        const setup = await game.eval(() => {
            const M = Game.Objects['Bank'].minigame;
            const cursor = Game.Objects['Cursor'];
            // 150 cursors: the first office sacrifices the top 100 (minigameMarket.js:291, 542-552).
            if (cursor.amount > 150) cursor.sell(cursor.amount - 150);
            else if (cursor.amount < 150) cursor.buy(150 - cursor.amount);
            cursor.level = 2;
            window.__cursorBuys = [];
            const buy = cursor.buy;
            cursor.buy = function () {
                const before = Game.cookies;
                const reserve = MushieCookies.buyer.reserve();
                const office = M.officeLevel;
                const out = buy.apply(this, arguments);
                window.__cursorBuys.push({ before, after: Game.cookies, reserve, office });
                return out;
            };
            FrozenCookies.autoBank = 1;
            FCStart();
            // A bank above the reserve by half of what buying the top 100 cursors back costs: a
            // rebuy that ignores the reserve must go into it.
            let rebuy = 0;
            for (let i = 50; i < 150; i++) rebuy += cursor.basePrice * Math.pow(Game.priceIncrease, Math.max(0, i - cursor.free));
            rebuy = Game.modifyBuildingPrice(cursor, rebuy);
            const reserve = Math.max(MushieCookies.buyer.reserve(), manualBank());
            Game.cookies = reserve + rebuy / 2;
            return { rebuy, reserve, cps: Game.unbuffedCps };
        });
        assert.ok(setup.rebuy > 5 * setup.cps, `the rebuy should cost well over a second of CpS: ${JSON.stringify(setup)}`);
        await game.advanceSeconds(30 * 60);
        const out = await game.eval(() => ({
            buys: window.__cursorBuys,
            level: Game.Objects['Bank'].minigame.officeLevel,
            cursors: Game.Objects['Cursor'].amount,
            report: MushieCookies.market.report(),
            status: MushieCookies.status(),
        }));
        assert.ok(out.level >= 1, `the office should have been upgraded (still level ${out.level}): ${JSON.stringify(out.report.office)}`);
        const intoReserve = out.buys.filter((b) => b.after < b.reserve * (1 - 1e-9));
        assert.deepEqual(intoReserve.slice(0, 3), [], `${intoReserve.length} of ${out.buys.length} cursor purchases spent the reserve`);
        assert.ok(out.cursors >= 150, `the sacrificed cursors should be bought back, have ${out.cursors}`);
        assert.deepEqual(failures(out.status), []);
        assert.deepEqual(game.errors, []);
    }));

// M8: the market's budget was the bank less the reserve, so it traded away what the buyer was
// saving for its next purchase.
test('the market never spends what the buyer is saving for, unless the trade returns more', { skip }, () =>
    withBank(async (game) => {
        await game.eval(() => {
            const M = Game.Objects['Bank'].minigame;
            const buyGood = M.buyGood;
            window.__trades = [];
            M.buyGood = function (id, n) {
                const before = Game.cookies;
                const reserve = MushieCookies.buyer.reserve();
                const next = MushieCookies.buyer.ranking().find((c) => Number.isFinite(c.payback));
                const allocation = MushieCookies.market.allocation ? MushieCookies.market.allocation() : null;
                const ok = buyGood.call(M, id, n);
                if (ok) window.__trades.push({ before, after: Game.cookies, reserve, committed: next ? next.price : 0, allocation });
                return ok;
            };
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoMarket = 1;
            FrozenCookies.holdManBank = 1;
            FrozenCookies.manBankMins = 30;
            FCStart();
            Game.cookies = manualBank() * 1.5;
        });
        await game.advanceSeconds(3 * 3600);
        const out = await game.eval(() => ({ trades: window.__trades, report: MushieCookies.market.report(), status: MushieCookies.status() }));
        const intoSaving = out.trades.filter(
            (t) => t.after < (t.reserve + t.committed) * (1 - 1e-9) && !(t.allocation && t.allocation.tradeReturn > t.allocation.buyerReturn)
        );
        assert.deepEqual(intoSaving.slice(0, 3), [], `${intoSaving.length} of ${out.trades.length} purchases spent what the buyer was saving`);
        // The claim is only tested if the saving held the market back at least once.
        assert.ok(out.report.heldForBuyer > 0, `the saving never held the market back: ${JSON.stringify(out.report)}`);
        assert.deepEqual(failures(out.status), []);
        assert.deepEqual(game.errors, []);
    }));

// The inherited broker hiring took every broker it could afford above the reserve while the next
// purchase was a building, with no test that the overhead saved would repay the price before
// brokers are dismissed at the ascension.
test('brokers are hired only when they repay before the run is expected to end', { skip }, () =>
    withBank(async (game) => {
        await game.eval(() => {
            FrozenCookies.autoBuy = 1;
            FrozenCookies.blacklist = 2; // buildings only, so the next purchase is always a building
            FrozenCookies.autoMarket = 1;
            FrozenCookies.autoBroker = 1;
            FCStart();
        });
        // Two hours into a fresh run: the run is expected to last another two, and a broker costs
        // 20 minutes of CpS to save 1% of the trading (minigameMarket.js:212, 324).
        await game.advanceSeconds(2 * 3600);
        const out = await game.eval(() => {
            const M = Game.Objects['Bank'].minigame;
            return { brokers: M.brokers, max: M.getMaxBrokers(), report: MushieCookies.market.report(), status: MushieCookies.status() };
        });
        assert.ok(out.max > 0, 'brokers could be hired');
        assert.ok(out.report.buys > 0, 'the market traded, so a broker had something to save');
        assert.ok(!(out.report.brokerPayback <= out.report.runLeft), `a broker would repay in time, so the claim is not tested: ${JSON.stringify(out.report)}`);
        assert.equal(out.brokers, 0, `hired ${out.brokers} brokers that cannot repay: ${JSON.stringify(out.report)}`);

        // The run is timed by play, on the ascension's clock: the game makes nothing while the
        // machine sleeps (it catches up at most 5 s, main.js:16788), so eight hours asleep must
        // not make the run look ten hours old and a broker look as if it had ten more to repay in.
        await game.machineSleep(8 * 3600);
        await game.advanceSeconds(60);
        const woken = await game.eval(() => ({ report: MushieCookies.market.report(), played: MushieCookies.ascension.report().runSeconds }));
        assert.ok(woken.played < 3 * 3600, `the premise: the ascension's clock counts play, ${woken.played} s`);
        assert.ok(Math.abs(woken.report.runLeft - woken.played) < 60, `brokers are judged over ${woken.report.runLeft} s left, the run has been played ${woken.played} s`);
        assert.deepEqual(failures(out.status), []);
        assert.deepEqual(game.errors, []);
    }));

// The inherited loans took loans 1 and 2 at once on any big enough buff, each downpayment a share
// of the whole bank (minigameMarket.js:375), reserve included.
test('a loan is taken only on a combo it pays for, and its downpayment never touches the reserve', { skip }, () =>
    withBank(async (game) => {
        await game.eval(() => {
            const M = Game.Objects['Bank'].minigame;
            M.officeLevel = 4; // loans 1 and 2 show (minigameMarket.js:1090-1093)
            window.__loans = [];
            const takeLoan = M.takeLoan;
            M.takeLoan = function (id, interest) {
                const before = Game.cookies;
                const reserve = MushieCookies.buyer.reserve();
                const ok = takeLoan.apply(M, arguments);
                if (ok && !interest) window.__loans.push({ id, before, after: Game.cookies, reserve, T: Game.T });
                return ok;
            };
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoMarket = 1;
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            FrozenCookies.autoLoan = 1;
            FrozenCookies.holdManBank = 1;
            FrozenCookies.manBankMins = 30;
            FCStart();
            Game.cookies = manualBank() * 3;
        });
        // Ordinary income: no loan pays.
        await game.advanceSeconds(10 * 60);
        const quiet = await game.eval(() => window.__loans.length);
        assert.equal(quiet, 0, 'no loan on ordinary income');

        // A long boost is no combo (the shared classifier, src/core/buffs.js): Sugar frenzy's hour
        // at x3 is not looked at as one, where reading the buff raw valued every loan on it once
        // a second for the hour.
        await game.eval(() => Game.gainBuff('sugar frenzy', 3600, 3));
        await game.advanceSeconds(5);
        const long = await game.eval(() => ({ loans: window.__loans.length, loan: MushieCookies.market.report().loan }));
        assert.equal(long.loans, 0, 'no loan on a long boost');
        assert.match(String(long.loan && long.loan.reason), /no combo/, `a long boost read as a combo: ${JSON.stringify(long.loan)}`);
        await game.eval(() => Game.killBuff('Sugar frenzy')); // test fixture: its hour is up
        await game.advanceSeconds(1);

        // A combo worth the pawnshop loan, with a bank whose free part is smaller than either
        // downpayment: no loan. The combo pays by CpS alone, clicking off: with clicks in a Click
        // frenzy the bank rises past any downpayment within a second while the buyer stands aside
        // (src/systems/buyer.js), and the reserve then rightly stops nothing. Test fixture: an
        // Elder frenzy of 40 s on a Frenzy (x4662), and a Click frenzy of 40 s only so the buyer
        // stands aside. The reserve is 1,400 minutes of CpS (84,000 s), the bank 1.1 of it, and
        // one second is played: one market tick. The free part is then at most 8,400 + 4,662 s of
        // CpS, under loan 1's downpayment (0.2 of the bank, 19,400) and loan 2's (38,800), while
        // 39 s of the combo doubled are worth 182,000.
        await game.eval(() => {
            FrozenCookies.autoClick = 0;
            FrozenCookies.manBankMins = 1400;
            MushieCookies.buyer.invalidate();
        });
        await game.advanceSeconds(2); // the buyer ranks, holding the new reserve
        await game.eval(() => {
            Game.gainBuff('frenzy', 77, 7);
            Game.gainBuff('blood frenzy', 40, 666);
            Game.gainBuff('click frenzy', 40, 777);
            Game.cookies = MushieCookies.buyer.reserve() * 1.1;
        });
        await game.advanceSeconds(1);
        const tight = await game.eval(() => ({ loans: window.__loans.slice(), loan: MushieCookies.market.report().loan }));

        // The same combo, fresh, with room above the reserve: the pawnshop loan's 40 s double it.
        // Gaining a buff that is running can prolong it (main.js:13765-13771), so the first combo is ended.
        await game.eval(() => ['Frenzy', 'Elder frenzy', 'Click frenzy'].forEach((name) => Game.killBuff(name)));
        await game.advanceSeconds(1);
        await game.eval(() => {
            Game.gainBuff('frenzy', 77, 7);
            Game.gainBuff('blood frenzy', 40, 666);
            Game.gainBuff('click frenzy', 40, 777);
            Game.cookies = MushieCookies.buyer.reserve() * 1.8; // loan 2's downpayment fits: 0.72 of 0.8 free
        });
        await game.advanceSeconds(1);
        const out = await game.eval(() => ({ loans: window.__loans, report: MushieCookies.market.report(), status: MushieCookies.status() }));
        const share = { 1: 0.2, 2: 0.4, 3: 0.5 };
        const intoReserve = out.loans.filter((l) => share[l.id] * l.before > l.before - l.reserve + 1e-9 * l.before);
        assert.deepEqual(intoReserve, [], 'a downpayment took part of the reserve');
        assert.deepEqual(tight.loans, [], `no downpayment fits above the reserve: ${JSON.stringify(tight.loan)}`);
        // Each loan is judged on the bank the last one left: never two downpayments in one go.
        const ticks = out.loans.map((l) => l.T);
        assert.equal(new Set(ticks).size, ticks.length, `two loans were taken in the same frame: ${JSON.stringify(out.loans)}`);
        assert.ok(out.loans.some((l) => l.id === 2), `the pawnshop loan should pay on this combo, so only the reserve stopped it before: ${JSON.stringify(out.report.loan)}`);
        assert.deepEqual(failures(out.status), []);
        assert.deepEqual(game.errors, []);
    }));
