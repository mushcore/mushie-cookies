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

test('picks the dragon aura that adds the most income and pays the game\'s price for it', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const out = await game.eval(() => {
            Game.Earn(1e15);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank']) Game.Objects[name].buy(60);
            Game.dragonLevel = 20; // auras up to Radiant Appetite (15) are available
            Game.dragonAura = 0;
            Game.CalculateGains();
            const banksBefore = Game.Objects['Bank'].amount;
            FrozenCookies.autoGods = 1;
            FrozenCookies.autoDragonToggle = 0;
            return { banksBefore };
        });
        await game.advanceSeconds(6 * 60);
        const after = await game.eval(() => ({
            aura: Game.dragonAura,
            name: Game.dragonAuras[Game.dragonAura].name,
            banks: Game.Objects['Bank'].amount,
            report: MushieCookies.gods.report(),
            prompt: !!Game.promptOn,
        }));
        assert.equal(after.name, 'Radiant Appetite', `chose ${after.name}`);
        assert.equal(after.banks, out.banksBefore - 1, 'the highest building is sacrificed, as the game charges');
        assert.equal(after.report.auraChanges, 1);
        assert.equal(after.prompt, false, 'no prompt is left open');
    } finally {
        await game.close();
    }
});
