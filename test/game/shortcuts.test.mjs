// Keyboard shortcuts: off by default; when on, they toggle, ask before ascending, and ignore typing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('shortcuts are off by default, ask before ascending, and never fire while typing', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const press = (key, target) =>
            game.eval(([code, into]) => {
                const el = into ? document.body.appendChild(document.createElement('input')) : document.body;
                el.dispatchEvent(new KeyboardEvent('keydown', { keyCode: code, bubbles: true }));
                if (into) el.remove();
            }, [key, target]);
        await game.eval(() => Game.Earn(1e20));
        await press(65); // 'a' with shortcuts off
        assert.equal(await game.eval(() => FrozenCookies.autoBuy), 0, 'nothing happens while shortcuts are off');

        await game.eval(() => setPreferenceDirect('FCshortcuts', 1));
        await press(65);
        assert.equal(await game.eval(() => FrozenCookies.autoBuy), 1, "'a' switches autobuy on");
        await press(67);
        assert.equal(await game.eval(() => FrozenCookies.autoGC), 1, "'c' switches golden cookie clicking on");
        await press(65, true);
        assert.equal(await game.eval(() => FrozenCookies.autoBuy), 1, 'typing an a in a text box is not a shortcut');

        await press(82); // 'r'
        const after = await game.eval(() => ({ prompt: !!Game.promptOn, resets: Game.resets, onAscend: Game.OnAscend, cookies: Game.cookies }));
        assert.equal(after.prompt, true, "'r' opens the game's ascend confirmation");
        assert.equal(after.onAscend, 0, 'and does not ascend by itself');
        assert.ok(after.cookies >= 1e20, 'nor reset the run');
        assert.deepEqual(game.errors.filter((e) => e.startsWith('pageerror')), []);
    } finally {
        await game.close();
    }
});
