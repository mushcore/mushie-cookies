import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

// Gods the system must never slot (src/systems/gods.js). The game's gods carry no key of their
// own; the key is their name in the minigame's `gods` table.
const SKIPPED_GODS = ['asceticism', 'ruin', 'ages', 'order'];

/** Buys sixty of each building named and opens the Pantheon. */
async function openTemple(game, names = ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple']) {
    await game.eval((list) => {
        Game.Earn(1e15);
        for (const name of list) Game.Objects[name].buy(60);
        Game.Objects['Temple'].level = 1;
        Game.LoadMinigames();
    }, names);
    await game.waitFor(() => !!(Game.Objects['Temple'].minigame && Game.Objects['Temple'].minigame.godsById && document.getElementById('templeSlot0')));
}

/**
 * Buildings for a dragon test. The highest building is a single Temple: its price is a few
 * minutes of income, as for a building the buyer actually bought. (Sixty of every building and
 * no upgrades makes the sixtieth Bank a 44-day payback, a state no player reaches.)
 */
function dragonBakery(aura) {
    Game.Earn(1e15);
    for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank']) Game.Objects[name].buy(60);
    Game.Objects['Temple'].buy(1);
    Game.dragonLevel = 20; // auras 0 to 16 (Dragon's Fortune) can be chosen: level >= id + 4
    Game.dragonAura = aura;
    Game.CalculateGains();
}

test('slots gods by measured income, one swap at a time, the way a player drags them', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await openTemple(game);
        const before = await game.eval((skipped) => {
            // Clicking with one mouse upgrade, and a small bank so that golden cookie payouts do
            // not swamp the gods: at the first decision Muridal is worth a swap but Jeremy is
            // worth more, and after Jeremy, Muridal still is. Taking the first god found worth a
            // swap, or making every swap at once, would show here.
            Game.Upgrades['Plastic mouse'].earn();
            Game.Spend(Game.cookies - 1e8);
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            const M = Game.Objects['Temple'].minigame;
            const keyOf = (god) => Object.keys(M.gods).find((k) => M.gods[k] === god);
            const income = () => MushieCookies.estimateIncome(MushieCookies.readState(Game, FrozenCookies)).total;
            const measure = (god, slot) => {
                const slots = M.slot.slice();
                const gods = M.godsById.map((g) => g.slot);
                return MushieCookies.simulate(Game, {
                    apply: () => M.slotGod(god, slot),
                    measure: income,
                    revert() {
                        M.slot = slots;
                        M.godsById.forEach((g, i) => (g.slot = gods[i]));
                    },
                });
            };
            // Every drag is checked against an independent measurement of every move, taken at
            // the moment the god is picked up.
            window.__drops = [];
            let gains = null;
            const drag = M.dragGod;
            const drop = M.dropGod;
            M.dragGod = function (god) {
                const now = MushieCookies.simulate(Game, { apply() {}, measure: income });
                gains = { best: -Infinity };
                for (const g of M.godsById) {
                    for (let slot = 0; slot < 3; slot++) {
                        if (g.slot === slot) continue;
                        const gain = measure(g, slot) / now - 1;
                        gains[`${keyOf(g)}:${slot}`] = gain;
                        if (!skipped.includes(keyOf(g)) && gain > gains.best) gains.best = gain;
                    }
                }
                return drag.apply(this, arguments);
            };
            M.dropGod = function () {
                const key = keyOf(M.dragging);
                window.__drops.push({ key, slot: M.slotHovered, gain: gains[`${key}:${M.slotHovered}`], best: gains.best, t: Date.now() });
                return drop.apply(this, arguments);
            };
            FrozenCookies.autoGods = 1;
            FrozenCookies.autoWorshipToggle = 0;
            return { swaps: M.swaps, slots: M.slot.slice() };
        }, SKIPPED_GODS);
        await game.advanceSeconds(20 * 60);
        const out = await game.eval(() => {
            const M = Game.Objects['Temple'].minigame;
            const keyOf = (god) => Object.keys(M.gods).find((k) => M.gods[k] === god);
            return {
                swaps: M.swaps,
                keys: M.slot.map((id) => (id === -1 ? null : keyOf(M.godsById[id]))),
                drops: window.__drops,
                report: MushieCookies.gods.report(),
                consistent: M.godsById.every((g) => g.slot === -1 || M.slot[g.slot] === g.id),
            };
        });
        assert.deepEqual(before.slots, [-1, -1, -1]);
        assert.ok(out.drops.length >= 1, 'should have slotted at least one god');
        for (const d of out.drops) {
            assert.ok(!SKIPPED_GODS.includes(d.key), `dragged ${d.key}, which is never to be slotted`);
            assert.ok(d.best > 0.01, `nothing was worth a swap (best +${(d.best * 100).toFixed(2)}%)`);
            assert.ok(d.gain >= d.best - 1e-9, `dragged ${d.key} to slot ${d.slot} (+${(d.gain * 100).toFixed(2)}%), best was +${(d.best * 100).toFixed(2)}%`);
        }
        for (let i = 1; i < out.drops.length; i++) {
            assert.ok(out.drops[i].t - out.drops[i - 1].t >= 299 * 1000, 'one swap per decision, five minutes apart');
        }
        assert.equal(out.report.swaps, out.drops.length);
        assert.equal(before.swaps - out.swaps, out.drops.length, 'each slotting spends one swap, as dragging does');
        assert.ok(!out.keys.some((k) => SKIPPED_GODS.includes(k)), `slotted ${out.keys.join(', ')}`);
        assert.equal(out.consistent, true, 'the game\'s slot table and the gods agree');
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('with the inherited worship option on, the Pantheon is left alone', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e15);
            Game.Objects['Temple'].buy(60);
            Game.Objects['Temple'].level = 1;
            Game.LoadMinigames();
        });
        await game.waitFor(() => !!(Game.Objects['Temple'].minigame && Game.Objects['Temple'].minigame.godsById && document.getElementById('templeSlot0')));
        await game.eval(() => {
            FrozenCookies.autoGods = 1;
            FrozenCookies.autoWorshipToggle = 1;
            FrozenCookies.autoWorship0 = 0;
            FrozenCookies.autoWorship1 = 0;
            FrozenCookies.autoWorship2 = 0;
        });
        await game.advanceSeconds(20 * 60);
        assert.equal(await game.eval(() => MushieCookies.gods.report().swaps), 0);
    } finally {
        await game.close();
    }
});

test('stands aside while an inherited combo that swaps gods and auras is running', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await openTemple(game);
        await game.eval(() => {
            Game.Objects['Wizard tower'].buy(1); // the highest building, cheap to sacrifice
            Game.dragonLevel = 20;
            Game.dragonAura = 0;
            FrozenCookies.autoGods = 1;
            // Mid-combo, the 100% consistency combo has switched the inherited pantheon and aura
            // options off (fc_spells.js:1334-1347) and swaps gods and auras itself.
            FrozenCookies.auto100ConsistencyCombo = 1;
            FrozenCookies.autoWorshipToggle = 0;
            FrozenCookies.autoDragonToggle = 0;
        });
        await game.advanceSeconds(6 * 60);
        const during = await game.eval(() => ({ report: MushieCookies.gods.report(), aura: Game.dragonAura, slots: Game.Objects['Temple'].minigame.slot.slice() }));
        assert.deepEqual([during.report.swaps, during.report.auraChanges], [0, 0], JSON.stringify(during.report));
        assert.deepEqual(during.slots, [-1, -1, -1]);
        assert.equal(during.aura, 0);

        // The same state with the combo off is one the system acts on.
        await game.eval(() => {
            FrozenCookies.auto100ConsistencyCombo = 0;
        });
        await game.advanceSeconds(5 * 60);
        const after = await game.eval(() => MushieCookies.gods.report());
        assert.ok(after.swaps >= 1 && after.auraChanges >= 1, JSON.stringify(after));
    } finally {
        await game.close();
    }
});

/** Runs in the page: the system's report, the gods in the three slots by key, the running buffs. */
function godsNow() {
    const M = Game.Objects['Temple'].minigame;
    return {
        report: MushieCookies.gods.report(),
        keys: M.slot.map((id) => (id === -1 ? null : Object.keys(M.gods)[id])),
        swaps: M.swaps,
        buffs: Object.keys(Game.buffs),
    };
}

/**
 * Two mouse upgrades and clicking: each click adds 2% of CpS, and the game reads the buffed CpS
 * (main.js:4692-4693), so a CpS buff raises what clicking earns. With no buff Jeremy is the best
 * god here and Muridal the next; valued under a x1.5 CpS buff, Muridal is the best.
 */
function clickingBakery() {
    Game.Upgrades['Plastic mouse'].earn();
    Game.Upgrades['Iron mouse'].earn();
    FrozenCookies.autoClick = 1;
    FrozenCookies.cookieClickSpeed = 35;
    FrozenCookies.autoWorshipToggle = 0;
    FrozenCookies.autoDragonToggle = 0;
}

test('a CpS buff does not make a clicking god look worth a swap', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await openTemple(game);
        await game.eval(clickingBakery);
        await game.eval(() => {
            FrozenCookies.autoGods = 1;
            Game.gainBuff('frenzy', 20 * 60, 7);
        });
        await game.advanceSeconds(6 * 60);
        const during = await game.eval(godsNow);
        assert.equal(during.report.swaps, 1, `the decision is made during the Frenzy: ${JSON.stringify(during.report)}`);
        assert.deepEqual(during.keys, ['industry', null, null], 'and it is the best god between buffs');

        await game.eval(() => {
            Game.buffs['Frenzy'].time = 0;
        });
        await game.advanceSeconds(60);
        const after = await game.eval(godsNow);
        assert.equal(after.report.swaps, 1, JSON.stringify(after.report));
        assert.deepEqual(after.keys, ['industry', null, null], 'nothing to undo once the buff is over');
    } finally {
        await game.close();
    }
});

test('a long CpS buff changes neither what gods and auras are worth nor which god is chosen', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await openTemple(game);
        await game.eval(clickingBakery);
        const plans = await game.eval(() => {
            Game.dragonLevel = 20; // auras 0 to 16 (Dragon's Fortune) can be chosen: level >= id + 4
            const plain = MushieCookies.gods.plan();
            // A modest loan: x1.5 CpS for two hours (minigameMarket.js:350, 376), longer than
            // anything worth waiting out.
            Game.gainBuff('loan 1', 2 * 60 * 60, 1.5);
            const loaned = MushieCookies.gods.plan();
            // The what-ifs put the buffs back: the loan still multiplies CpS.
            const restored = !!Game.hasBuff('Loan 1') && Math.abs(Game.cookiesPs / Game.unbuffedCps - 1.5) < 1e-9;
            FrozenCookies.autoGods = 1;
            return { plain, loaned, restored };
        });
        assert.equal(plans.restored, true, 'the buffs are restored after the what-ifs');
        // A payback is Infinity (null here) for an aura that adds nothing once the building is rebought.
        const close = (a, b) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
        assert.ok(plans.plain.gods.length > 0 && plans.plain.auras.length > 0, 'gods and auras are measured');
        for (const m of plans.plain.gods) {
            const l = plans.loaned.gods.find((x) => x.god === m.god && x.slot === m.slot);
            assert.ok(l && close(l.gain, m.gain), `${m.god} in slot ${m.slot}: +${(m.gain * 100).toFixed(3)}% with no buff, +${l && (l.gain * 100).toFixed(3)}% under the loan`);
        }
        for (const m of plans.plain.auras) {
            const l = plans.loaned.auras.find((x) => x.id === m.id && x.slot === m.slot);
            assert.ok(l && close(l.gain, m.gain) && close(l.payback, m.payback), `${m.name}: ${JSON.stringify(m)} with no buff, ${JSON.stringify(l)} under the loan`);
        }
        const best = plans.plain.gods.reduce((a, b) => (b.gain > a.gain ? b : a));
        assert.ok(best.gain > 0.01, 'a god is worth a swap');

        await game.advanceSeconds(6 * 60);
        const after = await game.eval(godsNow);
        assert.ok(after.buffs.includes('Loan 1'), 'the loan is still running');
        const expected = [null, null, null];
        expected[best.slot] = best.god;
        assert.deepEqual(after.keys, expected, `chose ${after.report.last}; the best with no buff is ${best.god} in slot ${best.slot}`);
    } finally {
        await game.close();
    }
});

test('a CpS debuff does not hold decisions back', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await openTemple(game);
        await game.eval(clickingBakery);
        await game.eval(() => {
            FrozenCookies.autoGods = 1;
            // A pawnshop loan's interest: x0.1 CpS for 40 minutes (minigameMarket.js:351, 380).
            Game.gainBuff('loan 2 interest', 40 * 60, 0.1);
        });
        await game.advanceSeconds(6 * 60);
        const after = await game.eval(godsNow);
        assert.ok(after.buffs.includes('Loan 2 (interest)'), 'the interest is still being paid');
        assert.equal(after.report.swaps, 1, `no decision while the interest ran: ${JSON.stringify(after.report)}`);
        assert.deepEqual(after.keys, ['industry', null, null], 'the best god with no buff or debuff');
    } finally {
        await game.close();
    }
});

test('picks the dragon aura that adds the most income and pays the game\'s price for it', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(dragonBakery, 0);
        const out = await game.eval(() => {
            FrozenCookies.autoGods = 1;
            FrozenCookies.autoDragonToggle = 0;
            return { temples: Game.Objects['Temple'].amount, owned: Game.BuildingsOwned };
        });
        await game.advanceSeconds(6 * 60);
        const after = await game.eval(() => ({
            aura: Game.dragonAura,
            name: Game.dragonAuras[Game.dragonAura].name,
            temples: Game.Objects['Temple'].amount,
            owned: Game.BuildingsOwned,
            report: MushieCookies.gods.report(),
            prompt: !!Game.promptOn,
        }));
        assert.equal(after.name, 'Radiant Appetite', `chose ${after.name}`);
        assert.equal(after.temples, out.temples - 1, 'the highest building is sacrificed, as the game charges');
        assert.equal(after.owned, out.owned - 1, 'and only that one');
        assert.equal(after.report.auraChanges, 1);
        assert.equal(after.prompt, false, 'no prompt is left open');
    } finally {
        await game.close();
    }
});

test('a golden cookie on screen does not make Dragon\'s Fortune look worth a building', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(dragonBakery, 15); // Radiant Appetite
        const start = await game.eval(() => {
            // A golden cookie that stays on screen. Each one multiplies CpS by 2.23 under
            // Dragon's Fortune (main.js:5108-5110), but only while it is on screen.
            const spawn = () => {
                const cookie = new Game.shimmer('golden');
                cookie.dur = 3600;
                cookie.life = Math.ceil(Game.fps * cookie.dur);
            };
            const fortune = () => MushieCookies.gods.plan().auras.find((m) => m.name === "Dragon's Fortune");
            spawn();
            const onScreen = fortune();
            for (const s of Game.shimmers.slice()) s.die();
            const none = fortune();
            spawn();
            FrozenCookies.autoGods = 1;
            FrozenCookies.autoDragonToggle = 0;
            return { owned: Game.BuildingsOwned, onScreen, none };
        });
        await game.advanceSeconds(6 * 60);
        await game.eval(() => {
            for (const s of Game.shimmers.slice()) s.die();
        });
        await game.advanceSeconds(5 * 60);
        const after = await game.eval(() => ({ aura: Game.dragonAura, owned: Game.BuildingsOwned, report: MushieCookies.gods.report() }));
        assert.equal(after.aura, 15, `switched to ${after.aura}: ${after.report.last}`);
        assert.equal(after.owned, start.owned, 'no building was sacrificed');
        assert.equal(after.report.auraChanges, 0);
        // The valuation does not depend on the golden cookie being there.
        assert.ok(start.onScreen && start.none, 'Dragon\'s Fortune is a candidate');
        const pct = (m) => `${(m.gain * 100).toFixed(2)}%`;
        assert.ok(Math.abs(start.onScreen.gain - start.none.gain) < 1e-9, `valued at ${pct(start.onScreen)} with a golden cookie on screen, ${pct(start.none)} without`);
    } finally {
        await game.close();
    }
});

test('an aura the player chose that the model cannot value is left in place', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(dragonBakery, 5); // Earth Shatterer: its worth is in selling buildings, not income
        const owned = await game.eval(() => {
            FrozenCookies.autoGods = 1;
            FrozenCookies.autoDragonToggle = 0;
            return Game.BuildingsOwned;
        });
        await game.advanceSeconds(6 * 60);
        const after = await game.eval(() => ({ aura: Game.dragonAura, owned: Game.BuildingsOwned, report: MushieCookies.gods.report() }));
        assert.equal(after.aura, 5, `replaced with ${after.aura}: ${after.report.last}`);
        assert.equal(after.owned, owned);
    } finally {
        await game.close();
    }
});
