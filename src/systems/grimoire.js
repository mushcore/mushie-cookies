// Casts Force the Hand of Fate at the right moment: the next outcome is forecast, bad ones are
// burnt with the cheapest spell, good ones wait for a buff to land on unless mana is full.
import { forecastFate } from '../game/fate.js';
import { decideCast } from '../core/grimoire.js';
import { readState } from '../game/measure.js';

const TICK_EVERY = 15; // frames
const FATE = 'hand of fate';
const SKIP = "haggler's charm"; // the cheapest spell; its backfire is a mild price rise on upgrades

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings   autoFate, plus the inherited casting settings it must not fight
 * @param {object} deps.loop
 * @param {(what: string) => void} [deps.log]
 */
export function createGrimoire({ game, settings, loop, log = () => {} }) {
    const state = { last: null, casts: 0, skips: 0, decision: null };

    // The inherited casting modes cast on their own; running both would double-cast.
    const inheritedCasting = () => settings.autoCasting != 0 || settings.autoFTHOFCombo == 1 || settings.auto100ConsistencyCombo == 1;

    function buffContext() {
        let cpsMult = 1;
        let secondsLeft = Infinity;
        for (const buff of Object.values(game.buffs)) {
            if (buff.multCpS && buff.multCpS !== 1) {
                cpsMult *= buff.multCpS;
                if (buff.multCpS > 1) secondsLeft = Math.min(secondsLeft, buff.time / game.fps);
            }
        }
        return { cpsMult, buffSecondsLeft: Number.isFinite(secondsLeft) ? secondsLeft : 0 };
    }

    function tick() {
        const grimoire = game.Objects['Wizard tower'].minigame;
        if (!grimoire || !grimoire.spells || game.OnAscend) return;
        const now = readState(game, settings);
        const ctx = {
            passive: now.cps,
            click: now.clicksPerSecond * now.clickPower,
            clicksPerSecond: now.clicksPerSecond,
            bank: game.cookies,
            durationMult: now.golden.durationMult,
            buildingSpecialMean: now.golden.buildingSpecialMean,
            ...buffContext(),
        };
        const next = forecastFate(game, grimoire, 0);
        const decision = decideCast({
            next,
            mana: grimoire.magic,
            maxMana: grimoire.magicM,
            fateCost: grimoire.getSpellCost(grimoire.spells[FATE]),
            skipCost: grimoire.getSpellCost(grimoire.spells[SKIP]),
            ctx,
        });
        state.decision = { ...decision, next: next.outcome };
        if (decision.action === 'wait') return;

        if (decision.action === 'skip') {
            if (grimoire.castSpell(grimoire.spells[SKIP])) {
                state.skips++;
                log(`skipped a ${next.outcome} with Haggler's Charm`);
            }
            return;
        }
        const before = new Set(game.shimmers);
        if (!grimoire.castSpell(grimoire.spells[FATE])) return;
        state.casts++;
        state.last = { outcome: next.outcome, reason: decision.reason };
        log(`cast Force the Hand of Fate: ${decision.reason}`);
        // Click the cookie the spell made, as a player would.
        const made = game.shimmers.find((s) => !before.has(s));
        if (made) made.pop();
    }

    loop.add('grimoire', tick, { everyFrames: TICK_EVERY, enabled: () => settings.autoFate == 1 && !inheritedCasting() });

    return {
        report() {
            return { casts: state.casts, skips: state.skips, last: state.last, decision: state.decision };
        },
    };
}
