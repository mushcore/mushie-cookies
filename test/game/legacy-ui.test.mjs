// The legacy menu and the Grimoire forecast tooltip, on the game itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('the Mushie menu keeps other mods\' wrappers, refreshes its figures on frames and rebuilds its options only when one changes', { skip }, async () => {
    const game = await launchWithMod();
    try {
        // Another mod wraps the menu after Mushie Cookies has started, as mods do to add content.
        await game.eval(() => {
            window.__otherMod = 0;
            const inner = Game.UpdateMenu;
            Game.UpdateMenu = function () {
                window.__otherMod++;
                return inner.apply(this, arguments);
            };
        });
        const reachesOtherMod = () =>
            game.eval(() => {
                const before = window.__otherMod;
                Game.UpdateMenu();
                return window.__otherMod - before;
            });
        assert.equal(await reachesOtherMod(), 1);
        await game.eval(() => setPreferenceDirect('logging', FrozenCookies.logging));
        assert.equal(await reachesOtherMod(), 1, 'choosing an option (even the current one) keeps the other mod\'s wrapper');
        await game.eval(() => setPreferenceDirect('numberDisplay', 2));
        await game.eval(() => setPreferenceDirect('numberDisplay', 1));
        assert.equal(await reachesOtherMod(), 1, 'so does changing a display option');

        // Open the menu and mark what it shows.
        await game.eval(() => {
            Game.ShowMenu('fc_menu');
            const section = (title) =>
                [...document.querySelectorAll('#menu .subsection')].find((s) => {
                    const t = s.querySelector('.title');
                    return t && t.textContent === title;
                });
            window.__section = section;
            section('Buying').__marked = true;
            document.getElementById('autoBuyButton_0').__marked = true;
        });
        await game.advanceSeconds(2);
        const refreshed = await game.eval(() => ({
            buyingRefreshed: !window.__section('Buying').__marked,
            optionsKept: !!document.getElementById('autoBuyButton_0').__marked,
            nodes: document.querySelectorAll('#menu *').length,
        }));
        assert.equal(refreshed.buyingRefreshed, true, 'the figures are refreshed while the menu is open');
        assert.equal(refreshed.optionsKept, true, 'the options are not rebuilt every second');

        // Choosing an option shows at once.
        const chosen = await game.eval(() => {
            document.getElementById('autoBuyButton_1').click();
            return {
                autoBuy: FrozenCookies.autoBuy,
                selected: document.getElementById('autoBuyButton_1').classList.contains('selected'),
                unselected: !document.getElementById('autoBuyButton_0').classList.contains('selected'),
            };
        });
        assert.deepEqual(chosen, { autoBuy: 1, selected: true, unselected: true });

        await game.eval(() => Game.ShowMenu(''));
        await game.advanceSeconds(2);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

/** Runs in the page: hovers Force the Hand of Fate, reads the tooltip it asks for, and checks the legacy M. */
const readGrimoire = () => {
    const tower = Game.Objects['Wizard tower'];
    const spell = document.getElementById('grimoireSpell1');
    let text = '';
    const draw = Game.tooltip.draw;
    Game.tooltip.draw = (from, content) => {
        text = String(content);
    };
    try {
        spell.onmouseover.call(spell);
    } finally {
        Game.tooltip.draw = draw;
    }
    return { current: window.M === tower.minigame, forecast: text.includes('First Spell') && text.includes('Fourth Spell') };
};

test('the Force the Hand of Fate forecast and the legacy Grimoire handle follow the Grimoire when it loads after the mod', { skip }, async () => {
    let checkpoint;
    let game = await launchWithMod();
    try {
        // Unlocked mid-session: the Grimoire loads after the legacy code has started.
        await game.eval(() => {
            Game.Earn(1e15);
            Game.Objects['Wizard tower'].buy(10);
            Game.Objects['Wizard tower'].level = 1;
            Game.LoadMinigames();
        });
        await game.waitFor(() => !!(Game.Objects['Wizard tower'].minigame && Game.Objects['Wizard tower'].minigame.spells));
        await game.advance(2);
        assert.deepEqual(await game.eval(readGrimoire), { current: true, forecast: true }, 'after the first unlock');
        checkpoint = await game.takeCheckpoint();
    } finally {
        await game.close();
    }

    // A Steam start from a save that has the Grimoire: it loads after the save, asynchronously.
    game = await launchWithMod({ checkpoint });
    try {
        await game.waitFor(() => !!Game.Objects['Wizard tower'].minigameLoaded);
        await game.advance(2);
        assert.deepEqual(await game.eval(readGrimoire), { current: true, forecast: true }, 'after a start from a save');
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});
