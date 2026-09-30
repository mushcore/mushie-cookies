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

    /** Every running buff, by name, since an outcome only lengthens a buff of its own name. */
    function runningBuffs() {
        return Object.values(game.buffs).map((buff) => ({
            name: buff.name,
            multCpS: buff.multCpS === undefined ? 1 : buff.multCpS,
            multClick: buff.multClick === undefined ? 1 : buff.multClick,
            secondsLeft: buff.time / game.fps,
            power: buff.power,
        }));
    }

    // The spell's cookie is never wrath, so a building special is always a buff: one building with
    // 10 or more, picked at random, for 1 + amount/10 (main.js:5496-5512).
    const buildingSpecials = () =>
        game.ObjectsById.filter((b) => b.amount >= 10).map((b) => ({ name: game.goldenCookieBuildingBuffs[b.name][0], mult: b.amount / 10 + 1 }));

    /** What an outcome landing now is valued against (see outcomeValue). */
    function context() {
        const now = readState(game, settings);
        return {
            passive: now.cps,
            click: now.clicksPerSecond * now.clickPower,
            clicksPerSecond: now.clicksPerSecond,
            bank: game.cookies,
            durationMult: now.golden.durationMult,
            buildingSpecials: buildingSpecials(),
            buffs: runningBuffs(),
        };
    }

    function tick() {
        const grimoire = game.Objects['Wizard tower'].minigame;
        if (!grimoire || !grimoire.spells || game.OnAscend) return;
        const ctx = context();
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
        context,
    };
}
