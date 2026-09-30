// Ascension: ends a run when its prestige growth has slowed, plans the heavenly upgrades and
// permanent slots while the bakery still exists to measure against, then ascends, buys and
// reincarnates. Only an ascension this system started is ever finished by it.
import { shouldAscend } from '../core/ascension.js';
import { planHeavenly, fillPermanentSlots } from '../game/prestige.js';

const FPS = 30;
const SAMPLE_EVERY = 60 * FPS; // one history sample a minute
const TICK_EVERY = 30; // frames
const HISTORY_LIMIT = 60 * 24; // a day of samples

/** The starter set the wiki recommends for a first ascension; its price sets the first target. */
const FIRST_SHOPPING_LIST = [
    'Legacy',
    'Heavenly cookies',
    'How to bake your dragon',
    'Box of brand biscuits',
    'Heavenly luck',
    'Permanent upgrade slot I',
    'Twin Gates of Transcendence',
    'Belphegor',
];

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings       the mod's settings (autoAscendToggle)
 * @param {object} deps.loop
 * @param {() => number} deps.extras   cookies an ascension would collect first (wrinklers, chocolate egg)
 * @param {{invalidate(): void}} [deps.buyer]
 * @param {(what: string) => void} [deps.log]
 */
export function createAscension({ game, settings, loop, extras = () => 0, buyer = null, log = () => {} }) {
    // 'rate' is the rule this system is built on; 'double' (ascend once prestige would double,
    // the inherited rule) is kept so the two can be compared in the harness.
    const options = { rule: 'rate' };
    const state = {
        phase: 'playing', // or 'ascending'
        runStartFrame: 0,
        history: [],
        plan: null,
        slots: [],
        verdict: null,
        last: null, // the last ascension, for the menu
        ascensions: 0,
    };

    const projected = () => game.HowMuchPrestige(game.cookiesReset + game.cookiesEarned + extras());

    function firstTarget() {
        let total = 0;
        for (const name of FIRST_SHOPPING_LIST) {
            const upgrade = game.Upgrades[name];
            if (upgrade && typeof upgrade.getPrice === 'function') total += upgrade.getPrice();
        }
        return total || 365;
    }

    function dragonEggWindow() {
        // "A crumbly egg" needs a million cookies earned in the current run; ascending inside that
        // window with the heavenly upgrade owned could keep the dragon locked forever.
        return game.Has('How to bake your dragon') && !game.HasUnlocked('A crumbly egg') && game.cookiesEarned < 1e6;
    }

    function sample(frame) {
        const t = (frame - state.runStartFrame) / FPS;
        state.history.push({ t, projected: projected() });
        if (state.history.length > HISTORY_LIMIT) state.history.shift();
    }

    function beginRun(frame) {
        state.runStartFrame = frame;
        state.history = [];
        sample(frame);
    }

    function decide(frame) {
        const runSeconds = (frame - state.runStartFrame) / FPS;
        state.verdict = shouldAscend({
            prestige: game.prestige,
            projected: projected(),
            history: state.history,
            runSeconds,
            firstTarget: firstTarget(),
        });
        if (options.rule === 'double') {
            const doubled = game.prestige > 0 ? projected() >= 2 * game.prestige : projected() >= firstTarget();
            state.verdict = { ...state.verdict, ascend: doubled, reason: doubled ? 'prestige would double' : 'prestige would not double yet' };
        }
        if (!state.verdict.ascend) return;
        if (dragonEggWindow()) return;
        if (Object.keys(game.buffs).length) return; // a buff is running: let it finish first

        const prestigeAfter = Math.floor(projected());
        const chips = game.heavenlyChips + prestigeAfter - game.prestige;
        state.plan = planHeavenly(game, settings, chips, prestigeAfter);
        state.slots = fillPermanentSlots(game, settings);
        log(
            `ascending: ${state.verdict.reason}. Plan: ${state.plan.buy.map((b) => b.name).join(', ') || 'nothing'}` +
                (state.plan.saving ? `; saving for ${state.plan.saving.name}` : '') +
                (state.slots.length ? `; slots: ${state.slots.map((s) => s.name).join(', ')}` : '')
        );
        state.phase = 'ascending';
        game.ClosePrompt();
        game.Ascend(1);
    }

    function finish(frame) {
        if (!(game.OnAscend && !game.AscendTimer)) return;
        const bought = [];
        for (const item of state.plan ? state.plan.buy : []) {
            const upgrade = game.UpgradesById[item.id];
            if (!upgrade || upgrade.bought) continue;
            const parentsMet = (upgrade.parents || []).every((p) => p === -1 || p.bought);
            if (!parentsMet || game.heavenlyChips < upgrade.getPrice()) continue;
            game.PurchaseHeavenlyUpgrade(upgrade.id);
            if (upgrade.bought) bought.push(upgrade.name);
        }
        state.last = {
            at: Date.now(),
            prestige: game.prestige,
            bought,
            saving: state.plan && state.plan.saving ? state.plan.saving.name : null,
            slots: state.slots.map((s) => s.name),
        };
        state.ascensions++;
        log(`bought ${bought.join(', ') || 'nothing'}; reincarnating at prestige ${game.prestige}`);
        game.ClosePrompt();
        game.Reincarnate(1);
        state.phase = 'playing';
        state.plan = null;
        state.slots = [];
        beginRun(frame);
        if (buyer) buyer.invalidate();
    }

    function tick(frame) {
        if (state.phase === 'ascending') {
            finish(frame);
            return;
        }
        // A reincarnation the mod did not do (a manual one, or a reload) starts a new run.
        if (game.OnAscend || game.AscendTimer) return;
        if (game.cookiesEarned < 1 && state.history.length > 1) beginRun(frame);
        if ((frame - state.runStartFrame) % SAMPLE_EVERY === 0) sample(frame);
        decide(frame);
    }

    loop.add('ascension', tick, { everyFrames: TICK_EVERY, enabled: () => settings.autoAscendToggle == 1 });
    beginRun(0);

    return {
        options,
        report() {
            return {
                phase: state.phase,
                verdict: state.verdict,
                projected: projected(),
                gain: Math.floor(projected()) - game.prestige,
                firstTarget: game.prestige === 0 ? firstTarget() : null,
                runSeconds: state.history.length ? state.history[state.history.length - 1].t : 0,
                last: state.last,
                ascensions: state.ascensions,
            };
        },
        /** For tests: the current history of projected prestige. */
        history: () => state.history.slice(),
    };
}
