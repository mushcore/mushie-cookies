// Shimmers: clicks golden, wrath and storm-drop cookies and reindeer on sight, and the news
// ticker's fortunes when they pay.
//
// Runs on the loop every frame under a guard of its own, registered before every other system:
// shimmers spawn in the frame's updateShimmers (main.js:16524), before the mod's logic hook
// (main.js:16607), so they are gone before a system that reads the screen looks at it. The
// grimoire's fail chance adds 15% for each golden cookie on screen (minigameGrimoire.js:44-47)
// and Dragon's Fortune multiplies CpS by each (main.js:5108-5110). The grimoire pops the cookie
// its own cast makes in the same tick (src/systems/grimoire.js), so the two never hold the same
// shimmer: a popped shimmer leaves the game's list at once (main.js:5244).
import { toPop, fortuneChoice } from '../core/shimmers.js';

const FORTUNE_EVERY = 15; // frames; a fortune stays on the ticker for ten seconds (main.js:7602)

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings  autoGC, autoReindeer, autoFortune
 * @param {object} deps.loop
 * @param {() => boolean} [deps.ascensionImminent]  true when an ascension is about to reset the run
 * @param {(what: string) => void} [deps.log]
 */
export function createShimmers({ game, settings, loop, ascensionImminent = () => false, log = () => {} }) {
    const state = {
        popped: { golden: 0, wrath: 0, drop: 0, reindeer: 0 },
        fortunes: { taken: 0, left: 0 },
        passed: null, // the fortune last left alone, so it is counted once
        lastFortune: null,
    };

    const kindOf = (s) => (s.type === 'reindeer' ? 'reindeer' : s.force === 'cookie storm drop' ? 'drop' : s.wrath ? 'wrath' : 'golden');

    function pop() {
        const list = toPop(game.shimmers, { golden: settings.autoGC == 1, reindeer: settings.autoReindeer == 1 });
        if (!list.length) return;
        // pop() zeroes Game.Click (main.js:5229), which a player's click sets (main.js:4860) for
        // wrinklers and the special tabs to read (main.js:14421, 14721); put back, it still lands.
        const human = game.Click;
        try {
            for (const shimmer of list) {
                if (game.shimmers.indexOf(shimmer) === -1) continue; // gone with an earlier pop
                const kind = kindOf(shimmer); // read first: the pop clears `force` (main.js:5452)
                shimmer.pop(); // what the shimmer's own click listener calls (main.js:5198)
                state.popped[kind]++;
            }
        } finally {
            game.Click = human;
        }
    }

    function fortune() {
        const effect = game.TickerEffect;
        if (!effect || effect.type !== 'fortune') return;
        const cps = effect.sub === 'fortuneCPS';
        const choice = fortuneChoice({
            effect,
            bank: game.cookies,
            cps: game.cookiesPs,
            unbuffedCps: game.unbuffedCps,
            ascensionImminent: cps && ascensionImminent(),
        });
        if (choice.take) {
            game.tickerL.click(); // the ticker's own click listener (main.js:7625)
            state.fortunes.taken++;
            state.lastFortune = choice.reason;
            log(`took a fortune: ${choice.reason}`);
        } else if (state.passed !== effect) {
            state.passed = effect;
            state.fortunes.left++;
            log(`left the hour of CpS on the ticker: ${choice.reason}`);
        }
    }

    function tick(frame) {
        if (game.OnAscend || game.AscendTimer) return;
        pop();
        if (settings.autoFortune == 1 && frame % FORTUNE_EVERY === 0) fortune();
    }

    loop.add('shimmers', tick, { enabled: () => settings.autoGC == 1 || settings.autoReindeer == 1 || settings.autoFortune == 1 });

    return {
        report() {
            return { popped: { ...state.popped }, fortunes: { ...state.fortunes }, lastFortune: state.lastFortune };
        },
    };
}
