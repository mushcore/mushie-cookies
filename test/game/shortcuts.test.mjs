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

test("'b' and 'e' show their text in the game's own prompt on Steam, and Enter then confirms only that", { skip }, async () => {
    const game = await launchWithMod();
    try {
        const shown = () =>
            game.eval(() => {
                const area = document.getElementById('textareaPrompt');
                return {
                    promptOn: !!Game.promptOn,
                    visible: Game.promptAnchorL.style.display !== 'none',
                    text: area ? area.value : null,
                    ascending: Game.AscendTimer > 0 || Game.OnAscend > 0,
                };
            });
        const key = (type, code) =>
            game.eval(([t, c]) => {
                const target = t === 'keydown' ? document.body : window;
                target.dispatchEvent(new KeyboardEvent(t, { keyCode: c, bubbles: true }));
            }, [type, code]);
        await game.eval(() => {
            Game.Earn(1e20);
            setPreferenceDirect('FCshortcuts', 1);
            // What the Steam build (Electron) puts in place of window.prompt.
            window.prompt = () => {
                throw new Error('prompt() is and will not be supported.');
            };
            // The player looked at the ascend confirmation and cancelled it. The game keeps
            // its markup, including the Ascend button, until another prompt replaces it.
            Game.Ascend();
            Game.ClosePrompt();
        });

        await key('keydown', 69); // 'e'
        const exported = await shown();
        assert.equal(exported.promptOn, true, "'e' opens a prompt");
        assert.equal(exported.visible, true, 'that is on screen');
        const save = await game.eval(() => Game.WriteSave(1));
        assert.ok(exported.text && exported.text.slice(0, 40) === save.slice(0, 40), 'holding the export string');

        await key('keyup', 13); // Enter confirms what is on screen: the export closes
        let now = await shown();
        assert.equal(now.promptOn, false, 'Enter closes the export');
        assert.equal(now.ascending, false, 'and does not confirm the cancelled ascension');
        await key('keyup', 13);
        now = await shown();
        assert.equal(now.ascending, false, 'nor does a second Enter');

        await key('keydown', 66); // 'b'
        const spread = await shown();
        assert.equal(spread.visible, true, "'b' opens a prompt on screen");
        assert.equal(spread.text, await game.eval(() => Game.ObjectsById.map((b) => b.amount).join('/')), 'with the building spread');
        await key('keyup', 27); // Esc
        assert.equal((await shown()).promptOn, false, 'Esc closes it');

        await game.advanceSeconds(10);
        assert.equal((await shown()).ascending, false);
        assert.deepEqual(game.errors.filter((e) => e.startsWith('pageerror')), []);
    } finally {
        await game.close();
    }
});
