import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { gameAppDir } from '../../tools/localConfig.mjs';
import { startServer } from '../harness/server.mjs';
import { prepareRuntime, launchRuntime } from '../harness/runtime.mjs';
import { BUILT_MOD, skipReason } from '../harness/game.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const skip = skipReason() || (process.platform !== 'win32' && 'the runtime test needs the Windows build of the game');

test("the mod starts and buys inside the game's own runtime", { skip }, async () => {
    const app = gameAppDir(root);
    const server = await startServer(app, [BUILT_MOD]);
    const runtime = await launchRuntime(prepareRuntime(app));
    try {
        const chrome = await runtime.eval('navigator.userAgent.match(/Chrome\\/(\\d+)/)[1]');
        assert.equal(chrome, '87', 'this test must run on the Chrome the game ships with');

        // Same order as Steam: mod files first, then the game launches.
        await runtime.send('Page.addScriptToEvaluateOnNewDocument', {
            source: `
                try { localStorage.setItem('CookieClickerLang', 'EN'); } catch (e) {}
                window.__harnessLoadMods = function (launch) {
                    Game.LoadMod(${JSON.stringify(server.modUrls[0])}, launch, launch);
                };`,
        });
        await runtime.send('Page.navigate', { url: server.origin + '/src/index.html' });
        await runtime.waitFor('window.Game && Game.ready && Game.T > 0');
        await runtime.eval('Game.HardReset(2)');
        await runtime.waitFor('window.MushieCookies && MushieCookies.started()');

        await runtime.eval(`
            Game.Earn(1e6);
            FrozenCookies.autoBuy = 1;
            FCStart();
        `);
        await runtime.waitFor('Game.BuildingsOwned > 20', 30000);

        const state = JSON.parse(
            await runtime.eval(`JSON.stringify({
                version: MushieCookies.version,
                button: document.getElementById('fcButton').textContent,
                failed: Object.entries(MushieCookies.status()).filter(([, s]) => s.failures > 0).map(([n, s]) => n + ': ' + s.lastError),
            })`)
        );
        assert.match(state.version, /^\d+\.\d+\.\d+$/);
        assert.equal(state.button, 'MushieCookies');
        assert.deepEqual(state.failed, []);
        const ours = runtime.errors.filter((e) => e.startsWith('exception') || e.includes('Mushie Cookies'));
        assert.deepEqual(ours, []);
    } finally {
        await runtime.close();
        await server.close();
    }
});
