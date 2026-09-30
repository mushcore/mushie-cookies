// Casts Force the Hand of Fate at the right moment: the next outcome is forecast, bad ones are
// burnt with a harmless spell, good ones wait out a debuff that ends soon enough, and wait for a
// buff to land on unless mana is full.
import { forecastFate } from '../game/fate.js';
import { decideCast } from '../core/grimoire.js';
import { readState } from '../game/measure.js';

const TICK_EVERY = 15; // frames
const FATE = 'hand of fate';
// A skip only moves the spell count on, which reseeds the next cast (minigameGrimoire.js:312).
// It draws the same first number as the cast it replaces (:313), so skipping a backfire makes the
// skip backfire too, unless golden cookies on screen raised the fate spell's chance. Haggler's
// Charm is harmless either way: upgrades 2% cheaper for a minute, or 2% dearer for an hour that
// does not stack (:149-168, main.js:14022-14031). The spells that can cost less are not:
// Gambler's Fever Dream casts a random spell a second later at 50% or more to backfire, Force the
// Hand of Fate and Spontaneous Edifice among them (:189-216); below 27, 20 and 50 max magic,
// Conjure Baked Goods, Stretch Time and Diminish Ineptitude backfire into a 15-minute clot,
// running buffs cut by a fifth, or five times the backfires for 10 minutes (:27-34, 99-111, 251-256).
const SKIP = "haggler's charm";

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
            fps: now.golden.fps,
            gainMult: now.golden.gainMult,
            stormReach: now.golden.stormReach,
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
