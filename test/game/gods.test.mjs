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

test('a CpS buff does not make a clicking god look worth a swap', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await openTemple(game);
        await game.eval(() => {
            // One mouse upgrade: each click adds 1% of CpS, and the game reads the buffed CpS
            // (main.js:4692). Between buffs Jeremy is the best god here; under a Frenzy the model
            // sees seven times the clicking and Muridal wins.
            Game.Upgrades['Plastic mouse'].earn();
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            FrozenCookies.autoGods = 1;
            FrozenCookies.autoWorshipToggle = 0;
            Game.gainBuff('frenzy', 20 * 60, 7);
        });
        await game.advanceSeconds(6 * 60);
        const during = await game.eval(() => MushieCookies.gods.report());
        assert.equal(during.swaps, 0, `swapped during the Frenzy: ${during.last}`);

        await game.eval(() => {
            Game.buffs['Frenzy'].time = 0;
        });
        await game.advanceSeconds(60);
        const after = await game.eval(() => {
            const M = Game.Objects['Temple'].minigame;
            return { report: MushieCookies.gods.report(), keys: M.slot.map((id) => (id === -1 ? null : Object.keys(M.gods)[id])) };
        });
        assert.equal(after.report.swaps, 1, JSON.stringify(after.report));
        assert.deepEqual(after.keys, ['industry', null, null], 'once the buff is over, the best god between buffs');
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
