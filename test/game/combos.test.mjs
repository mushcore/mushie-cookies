import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

// Each mouse upgrade adds 1% of CpS to a click (main.js:4692-4706).
const MICE = [
    'Plastic mouse', 'Iron mouse', 'Titanium mouse', 'Adamantium mouse', 'Unobtainium mouse',
    'Eludium mouse', 'Wishalloy mouse', 'Fantasteel mouse', 'Nevercrack mouse', 'Armythril mouse',
];

/** Sixty of each of the first eight buildings, a bank to spare, and the Pantheon open. */
async function openBakery(game) {
    await game.eval(() => {
        Game.Earn(1e15);
        for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(60);
        Game.Objects['Temple'].level = 1;
        Game.LoadMinigames();
    });
    await game.waitFor(() => !!(Game.Objects['Temple'].minigame && Game.Objects['Temple'].minigame.godsById && document.getElementById('templeSlot0')));
}

/** Runs in the page: clicking at the game's cap with the mouse upgrades named, nothing bought. */
function clicking(mice) {
    for (const name of mice) if (!Game.Upgrades[name].bought) Game.Upgrades[name].earn();
    FrozenCookies.autoClick = 1;
    FrozenCookies.cookieClickSpeed = 50;
    FrozenCookies.autoBuy = 0;
    FrozenCookies.autoGods = 0;
    Game.CalculateGains();
}

/** Runs in the page: drags Godzamok into a slot the way a player does. */
function slotGodzamok(slot) {
    const M = Game.Objects['Temple'].minigame;
    M.dragGod(M.gods['ruin']);
    M.slotHovered = slot;
    M.dropGod();
    M.slotHovered = -1;
    Game.CalculateGains();
}

/** Runs in the page: records every sale as the game sees it. */
function recordSales() {
    window.__sales = [];
    for (const b of Game.ObjectsById) {
        const sell = b.sell;
        b.sell = function (amount) {
            window.__sales.push({ id: this.id, name: this.name, amount, before: this.amount, frame: Game.T });
            return sell.apply(this, arguments);
        };
    }
}

/** Runs in the page. */
function bakeryNow() {
    return {
        amounts: Game.ObjectsById.map((b) => b.amount),
        upgrades: Game.UpgradesOwned,
        cookies: Game.cookies,
        devastation: Game.hasBuff('Devastation') ? Game.buffs['Devastation'].multClick : 0,
        report: MushieCookies.combos.report(),
        sales: window.__sales || [],
        frame: Game.T,
    };
}

test('during a click buff, sells the buildings with the most Devastation per cookie lost and buys each straight back', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await openBakery(game);
        await game.eval(clicking, MICE);
        await game.eval(slotGodzamok, 0);
        await game.eval(recordSales);
        const start = await game.eval(() => {
            FrozenCookies.autoGodzamok = 1;
            // Cheapest Devastation first, by the game's own prices.
            const order = MushieCookies.saleOptions(MushieCookies.sellableBuildings(Game)).map((o) => o.id);
            Game.gainBuff('click frenzy', 26, 777);
            return { amounts: Game.ObjectsById.map((b) => b.amount), upgrades: Game.UpgradesOwned, order, frame: Game.T };
        });
        await game.advanceSeconds(3);
        const during = await game.eval(bakeryNow);
        assert.ok(during.sales.length > 0, `nothing sold: ${JSON.stringify(during.report)}`);
        assert.deepEqual(during.amounts, start.amounts, 'every building sold is bought straight back');
        assert.equal(during.upgrades, start.upgrades, 'and no upgrade is lost');
        // Devastation: +1% click power per building sold in the diamond slot (main.js:7891, 7897).
        const sold = during.sales.reduce((n, s) => n + s.amount, 0);
        assert.ok(Math.abs(during.devastation - (1 + 0.01 * sold)) < 1e-9, `Devastation ×${during.devastation} after ${sold} sold`);
        assert.ok(during.report.cycles >= 2, `sales stack while the buff runs: ${JSON.stringify(during.report)}`);
        for (const s of during.sales) {
            assert.notEqual(s.name, 'Wizard tower', 'towers hold the grimoire\'s magic');
            assert.ok(s.amount <= s.before - 1, `${s.name}: sold ${s.amount} of ${s.before}; one of each is kept`);
        }
        // The first cycle sells a prefix of the cheapest-first order.
        const first = during.sales.filter((s) => s.frame === during.sales[0].frame).map((s) => s.id);
        assert.deepEqual(first, start.order.slice(0, first.length), `sold ${first} of order ${start.order}`);
        // Cycles are a player's pace apart.
        const frames = [...new Set(during.sales.map((s) => s.frame))];
        for (let i = 1; i < frames.length; i++) assert.ok(frames[i] - frames[i - 1] >= 15, `cycles at frames ${frames}`);

        await game.advanceSeconds(40);
        const after = await game.eval(bakeryNow);
        const end = start.frame + 26 * 30;
        assert.ok(after.sales.every((s) => s.frame <= end), 'nothing is sold once the click buff is over');
        assert.deepEqual(after.amounts, start.amounts);
        assert.equal(after.devastation, 0, 'Devastation has run out');
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('sells nothing without a click buff, without clicking, under a Cursed finger, or with Godzamok unslotted', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await openBakery(game);
        await game.eval(clicking, MICE);
        await game.eval(slotGodzamok, 0);
        await game.eval(recordSales);
        await game.eval(() => {
            FrozenCookies.autoGodzamok = 1;
        });
        const endBuffs = () => {
            for (const b of Object.values(Game.buffs)) b.time = 0;
        };
        await game.advanceSeconds(5);
        assert.equal((await game.eval(bakeryNow)).sales.length, 0, 'no click buff');

        await game.eval(() => {
            FrozenCookies.autoClick = 0;
            Game.gainBuff('click frenzy', 26, 777);
        });
        await game.advanceSeconds(3);
        assert.equal((await game.eval(bakeryNow)).sales.length, 0, 'not clicking');
        await game.eval(endBuffs);
        await game.advanceSeconds(1);

        // A Cursed finger sets what a click earns, whatever multiplies it (main.js:4744).
        await game.eval(() => {
            FrozenCookies.autoClick = 1;
            Game.gainBuff('cursed finger', 10, Game.cookiesPs * 10);
            Game.gainBuff('click frenzy', 10, 777);
        });
        await game.advanceSeconds(3);
        assert.equal((await game.eval(bakeryNow)).sales.length, 0, 'Cursed finger');
        await game.eval(endBuffs);
        await game.advanceSeconds(1);

        await game.eval(slotGodzamok, -1);
        await game.eval(() => Game.gainBuff('click frenzy', 26, 777));
        await game.advanceSeconds(3);
        assert.equal((await game.eval(bakeryNow)).sales.length, 0, 'Godzamok unslotted');

        // The same click buff with him slotted is one it plays.
        await game.eval(slotGodzamok, 1);
        await game.advanceSeconds(3);
        const played = await game.eval(bakeryNow);
        assert.ok(played.sales.length > 0, 'played once he is slotted');
        // In the ruby slot, +0.5% per building (main.js:7892, 7898).
        const sold = played.sales.reduce((n, s) => n + s.amount, 0);
        assert.ok(Math.abs(played.devastation - (1 + 0.005 * sold)) < 1e-9, `×${played.devastation} after ${sold}`);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('spends only what the buyer is not holding', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await openBakery(game);
        await game.eval(clicking, MICE);
        await game.eval(slotGodzamok, 0);
        await game.eval(recordSales);
        // The buyer holds every cookie.
        await game.eval(() => {
            window.__reserve = MushieCookies.buyer.reserve;
            MushieCookies.buyer.reserve = () => Game.cookies + 1;
            FrozenCookies.autoGodzamok = 1;
            Game.gainBuff('click frenzy', 26, 777);
        });
        await game.advanceSeconds(3);
        assert.equal((await game.eval(bakeryNow)).sales.length, 0, 'the whole bank is held');

        // It holds all but a sliver: what a cycle loses never reaches into the reserve.
        const out = await game.eval(() => {
            const held = Game.cookies - 1e9;
            MushieCookies.buyer.reserve = () => held;
            window.__low = Infinity;
            const buy = Game.ObjectsById.map((b) => b.buy);
            Game.ObjectsById.forEach((b, i) => {
                b.buy = function () {
                    const r = buy[i].apply(this, arguments);
                    window.__low = Math.min(window.__low, Game.cookies);
                    return r;
                };
            });
            return { held };
        });
        await game.advanceSeconds(3);
        const after = await game.eval(() => ({ low: window.__low, now: Game.cookies, report: MushieCookies.combos.report(), sales: window.__sales.length }));
        assert.ok(after.sales > 0, `a sliver buys some Devastation: ${JSON.stringify(after.report)}`);
        assert.ok(after.low >= out.held, `the bank fell to ${after.low}, below the ${out.held} held`);
        await game.eval(() => {
            MushieCookies.buyer.reserve = window.__reserve;
        });
    } finally {
        await game.close();
    }
});

test('the inherited Godzamok and Golden switch code is gone', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const out = await game.eval(() => {
            FrozenCookies.autoGS = 1;
            FrozenCookies.autoGodzamok = 1;
            FCStart();
            return {
                functions: [typeof window.autoGSBuy, typeof window.autoGodzamokAction],
                intervals: [!!FrozenCookies.autoGSBot, !!FrozenCookies.autoGodzamokBot],
            };
        });
        assert.deepEqual(out.functions, ['undefined', 'undefined']);
        assert.deepEqual(out.intervals, [false, false]);
    } finally {
        await game.close();
    }
});

test('the Pantheon system slots Godzamok once the combo system sells for him and his Devastation is worth most', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await openBakery(game);
        await game.eval(clicking, MICE);
        const before = await game.eval(() => {
            FrozenCookies.autoGodzamok = 1;
            FrozenCookies.autoWorshipToggle = 0;
            FrozenCookies.autoGods = 1;
            const plan = MushieCookies.gods.plan().gods;
            const best = plan.reduce((a, b) => (b.gain > a.gain ? b : a));
            return { best, ruin: plan.filter((m) => m.god === 'ruin') };
        });
        assert.equal(before.ruin.length, 3, 'Godzamok is measured in each slot');
        assert.equal(before.best.god, 'ruin', `the best move is ${JSON.stringify(before.best)}`);
        await game.advanceSeconds(6 * 60);
        const keys = await game.eval(() => {
            const M = Game.Objects['Temple'].minigame;
            return M.slot.map((id) => (id === -1 ? null : Object.keys(M.gods)[id]));
        });
        assert.equal(keys[before.best.slot], 'ruin', `slots now ${keys.join(', ')}`);
    } finally {
        await game.close();
    }
});

/**
 * Runs in the page: the Golden switch heavenly upgrade owned, so the switch is in the store, and
 * golden cookies clicked as they appear, twice as often with Lucky day (main.js:5683): what the
 * switch stops is worth more than what it adds, so it is never worth leaving on for good here.
 */
function goldenSwitch() {
    Game.Upgrades['Golden switch'].earn();
    Game.Unlock('Golden switch [off]');
    Game.Upgrades['Lucky day'].earn();
    FrozenCookies.autoGC = 1;
}

/** Runs in the page. */
function switchNow() {
    return {
        on: !!Game.Has('Golden switch [off]'),
        cookies: Game.cookies,
        cps: Game.cookiesPs,
        report: MushieCookies.combos.report(),
        reserve: MushieCookies.buyer.reserve(),
        buffs: Object.keys(Game.buffs),
    };
}

test('turns the Golden switch on for a click buff that pays for it, and off once the Frenzy under it is over', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await openBakery(game);
        await game.eval(clicking, MICE);
        await game.eval(goldenSwitch);
        const start = await game.eval(() => {
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoGS = 1;
            return { reserve: MushieCookies.buyer.reserve() };
        });
        await game.advanceSeconds(2);
        const before = await game.eval(() => {
            Game.gainBuff('frenzy', 154, 7);
            Game.gainBuff('click frenzy', 26, 777);
            return { reserve: MushieCookies.buyer.reserve(), price: Game.Upgrades['Golden switch [off]'].getPrice() };
        });
        await game.advanceSeconds(1);
        const on = await game.eval(switchNow);
        assert.equal(on.on, true, `left off: ${JSON.stringify(on.report)}`);
        assert.equal(on.report.switchedOn, 1);

        // The Click frenzy is over, the Frenzy is not: turning off now would cost 7 times more.
        await game.advanceSeconds(40);
        const waiting = await game.eval(switchNow);
        assert.equal(waiting.on, true, `turned off during the Frenzy: ${JSON.stringify(waiting.report)}`);
        assert.ok(!waiting.buffs.includes('Click frenzy') && waiting.buffs.includes('Frenzy'));
        // No golden cookie spawns while it is on, yet the buyer keeps its reserve, and the price
        // of turning the switch off on top.
        assert.ok(waiting.reserve >= before.reserve, `reserve ${waiting.reserve} fell below ${before.reserve}`);
        // (The buyer re-reads the hold when it re-ranks; the hold grows with every building it buys.)
        assert.ok(waiting.report.hold > 0 && waiting.reserve >= 0.9 * waiting.report.hold, JSON.stringify(waiting));
        assert.ok(waiting.cookies >= waiting.report.hold);

        await game.eval(() => {
            Game.buffs['Frenzy'].time = 0;
        });
        await game.advanceSeconds(2);
        const off = await game.eval(switchNow);
        assert.equal(off.on, false, JSON.stringify(off.report));
        assert.equal(off.report.switchedOff, 1);
        assert.equal(off.report.hold, 0);
        assert.ok(start.reserve >= 0);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('leaves the Golden switch off when the click buff does not pay for it, and turns it off at once beside a long buff', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await openBakery(game);
        // One mouse upgrade: the switch adds half a percent of CpS to a click.
        await game.eval(clicking, MICE.slice(0, 1));
        await game.eval(goldenSwitch);
        await game.eval(() => {
            FrozenCookies.autoGS = 1;
            Game.gainBuff('click frenzy', 26, 777);
        });
        await game.advanceSeconds(30);
        const poor = await game.eval(switchNow);
        assert.equal(poor.on, false, JSON.stringify(poor.report));
        assert.equal(poor.report.switchedOn, 0);

        // Ten: it pays, and with only a retirement loan's x1.2 for two days under it
        // (minigameMarket.js:352), it goes off as soon as the Click frenzy ends.
        await game.eval(clicking, MICE);
        await game.eval(() => {
            Game.gainBuff('loan 3', 2 * 24 * 60 * 60, 1.2);
            Game.gainBuff('click frenzy', 26, 777);
        });
        await game.advanceSeconds(1);
        assert.equal((await game.eval(switchNow)).on, true);
        await game.advanceSeconds(28);
        const after = await game.eval(switchNow);
        assert.equal(after.on, false, JSON.stringify(after.report));
        assert.ok(after.buffs.includes('Loan 3'));
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});
