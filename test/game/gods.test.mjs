import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('slots gods by measured income, one swap at a time, the way a player drags them', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e15);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple']) Game.Objects[name].buy(60);
            Game.Objects['Temple'].level = 1;
            Game.LoadMinigames();
        });
        await game.waitFor(() => !!(Game.Objects['Temple'].minigame && Game.Objects['Temple'].minigame.godsById && document.getElementById('templeSlot0')));
        const before = await game.eval(() => {
            const M = Game.Objects['Temple'].minigame;
            FrozenCookies.autoGods = 1;
            FrozenCookies.autoWorshipToggle = 0;
            return { swaps: M.swaps, slots: M.slot.slice() };
        });
        await game.advanceSeconds(20 * 60);
        const out = await game.eval(() => {
            const M = Game.Objects['Temple'].minigame;
            return {
                swaps: M.swaps,
                slots: M.slot.slice(),
                keys: M.slot.map((id) => (id === -1 ? null : M.godsById[id].key)),
                report: MushieCookies.gods.report(),
                consistent: M.godsById.every((g) => g.slot === -1 || M.slot[g.slot] === g.id),
            };
        });
        assert.deepEqual(before.slots, [-1, -1, -1]);
        assert.ok(out.report.swaps >= 1, 'should have slotted at least one god');
        assert.ok(out.swaps < before.swaps, 'each slotting spends a swap, as dragging does');
        assert.ok(!out.keys.includes('asceticism') && !out.keys.includes('ruin'), `slotted ${out.keys.join(', ')}`);
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
