import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchGame, launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('mod loads where Steam loads it, and runs with the network blocked', { skip }, async () => {
    const bare = await launchGame();
    const baseline = bare.bootBlocked.slice().sort();
    await bare.close();

    const game = await launchWithMod();
    try {
        assert.deepEqual(game.bootBlocked.slice().sort(), baseline, 'the mod reached for the network while loading');
        await game.advanceSeconds(120);
        assert.deepEqual(game.blocked, [], 'the mod reached for the network while running');
        assert.deepEqual(game.errors, []);
        const state = await game.eval(() => ({
            version: MushieCookies.version,
            legacy: typeof FrozenCookies === 'object' && typeof autoCookie === 'function',
            thirdParty: Game.Achievements['Third-party'].won,
            button: document.getElementById('fcButton') ? document.getElementById('fcButton').textContent : null,
            registered: Object.keys(Game.mods),
        }));
        assert.match(state.version, /^\d+\.\d+\.\d+$/);
        assert.equal(state.legacy, true);
        assert.equal(state.button, 'MushieCookies', 'the menu button should exist and carry the mod name');
        assert.equal(state.thirdParty, 0, 'the mod must not award achievements itself');
        assert.deepEqual(state.registered, ['mushie_cookies']);
    } finally {
        await game.close();
    }
});

test('settings survive a save and a reload of the save', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const out = await game.eval(() => {
            FrozenCookies.autoBuy = 1;
            FrozenCookies.cookieClickSpeed = 42;
            const save = Game.WriteSave(1);
            FrozenCookies.autoBuy = 0;
            FrozenCookies.cookieClickSpeed = 7;
            Game.LoadSave(save);
            return { autoBuy: FrozenCookies.autoBuy, speed: FrozenCookies.cookieClickSpeed };
        });
        assert.deepEqual(out, { autoBuy: 1, speed: 42 });
        await game.advanceSeconds(5);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});
