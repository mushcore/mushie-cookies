import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('spends lumps on the minigames first, then Farm 9, and unlocks the minigames', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e12);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(10);
            Game.lumpsTotal = 20; // past the first-unlock reset, which zeroes the jar
            Game.lumps = 20;
            Game.prefs.askLumps = 1; // the player's own "confirm before spending lumps" setting
            FrozenCookies.autoLumps = 1;
        });
        await game.advanceSeconds(30);
        const out = await game.eval(() => ({
            levels: Object.fromEntries(['Wizard tower', 'Temple', 'Farm', 'Bank', 'Cursor'].map((n) => [n, Game.Objects[n].level])),
            lumps: Game.lumps,
            ask: Game.prefs.askLumps,
            prompt: Game.promptOn,
        }));
        // 4 lumps unlock the minigames, then Farm 2..5 costs 2+3+4+5 = 14: 18 spent, 2 left, Farm 6 needs 6.
        assert.deepEqual(out.levels, { 'Wizard tower': 1, Temple: 1, Farm: 5, Bank: 1, Cursor: 0 });
        assert.equal(out.lumps, 2);
        assert.equal(out.ask, 1, 'the player\'s setting is restored');
        assert.ok(!out.prompt, 'no confirmation prompt is left open');
        await game.waitFor(() => !!Game.Objects['Farm'].minigame);
        await game.waitFor(() => !!Game.Objects['Wizard tower'].minigame);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('with Sugar baking owned, a hundred lumps stay in the jar', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const out = await game.eval(() => {
            Game.Earn(1e12);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(10);
            for (const name of ['Wizard tower', 'Temple', 'Bank']) Game.Objects[name].level = 1;
            Game.Objects['Farm'].level = 9;
            Game.Objects['Cursor'].level = 12;
            Game.Upgrades['Sugar baking'].earn();
            Game.lumpsTotal = 103;
            Game.lumps = 103;
            FrozenCookies.autoLumps = 1;
            return null;
        });
        await game.advanceSeconds(30);
        const lumps = await game.eval(() => Game.lumps);
        assert.ok(lumps >= 100 && lumps < 103, `${lumps} lumps left`);
    } finally {
        await game.close();
    }
});

test('with the setting off, no lump is spent', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e12);
            Game.Objects['Wizard tower'].buy(10);
            Game.lumpsTotal = 20; // past the first-unlock reset, which zeroes the jar
            Game.lumps = 20;
            FrozenCookies.autoLumps = 0;
        });
        await game.advanceSeconds(30);
        assert.equal(await game.eval(() => Game.lumps), 20);
    } finally {
        await game.close();
    }
});
