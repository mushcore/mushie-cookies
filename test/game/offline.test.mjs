import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launchGame, skipReason } from '../harness/game.mjs';

const skip = skipReason();
const MOD = path.resolve(import.meta.dirname, '..', '..', 'dist', 'MushieCookies', 'main.js');

test('mod loads and runs with the network blocked', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.loadMod(MOD, 'mushie_cookies');
        await game.advanceSeconds(120);
        assert.deepEqual(game.blocked, [], 'the mod tried to reach the network');
        assert.deepEqual(game.errors, []);
        const state = await game.eval(() => ({
            version: MushieCookies.version,
            legacy: typeof FrozenCookies === 'object' && typeof autoCookie === 'function',
            thirdParty: Game.Achievements['Third-party'].won,
            button: document.getElementById('fcButton') ? document.getElementById('fcButton').textContent : null,
        }));
        assert.match(state.version, /^\d+\.\d+\.\d+$/);
        assert.equal(state.legacy, true);
        assert.equal(state.button, 'MushieCookies', 'the menu button should exist and carry the mod name');
        assert.equal(state.thirdParty, 1, 'in web mode the game itself awards this when any mod registers');
    } finally {
        await game.close();
    }
});
