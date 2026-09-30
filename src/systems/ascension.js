// Ascension: ends a run when its prestige growth has slowed, plans the heavenly upgrades and
// permanent slots while the bakery still exists to measure against, collects what an ascension
// would otherwise lose, then ascends, buys and reincarnates. Only an ascension this system
// started is ever finished by it.
import { shouldAscend } from '../core/ascension.js';
import { planHeavenly, rankPermanentSlots, assignPermanentSlots } from '../game/prestige.js';

const TICK_EVERY = 30; // frames
const SAMPLE_SECONDS = 60; // one history sample a minute
const HISTORY_LIMIT = 60 * 24; // a day of samples
const SETTLE_TICKS = 2; // popped wrinklers pay out on the next logic frames
const BUFF_WAIT_SECONDS = 10 * 60; // an income buff ending sooner than this is let finish

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
 * @param {() => number} deps.extras   cookies collecting before an ascension would add (wrinklers, chocolate egg)
 * @param {() => void} deps.prepare    collects them: pops wrinklers, sells stock, harvests, the chocolate egg
 * @param {{invalidate(): void}} [deps.buyer]
 * @param {(what: string) => void} [deps.log]
 */
export function createAscension({ game, settings, loop, extras = () => 0, prepare = () => {}, buyer = null, log = () => {} }) {
    // 'rate' is the rule this system is built on; 'double' (ascend once prestige would double,
    // the inherited rule) is kept so the two can be compared in the harness. `firstTarget`
    // overrides the first ascension's prestige target (null: the starter set's price).
    const options = { rule: 'rate', firstTarget: null };
    const state = {
        phase: 'playing', // then 'settling' after collecting, then 'ascending'
        run: null, // { resets, startDate, start: {t, projected}, seconds, frame }
        history: [],
        lastSampleAt: -Infinity,
        settle: 0,
        plan: null,
        slotRanking: [],
        verdict: null,
        last: null, // the last ascension, for the menu
        ascensions: 0,
    };

    const realised = () => game.HowMuchPrestige(game.cookiesReset + game.cookiesEarned);
    const withExtras = () => game.HowMuchPrestige(game.cookiesReset + game.cookiesEarned + extras());
    const wallAge = () => Math.max(0, (Date.now() - game.startDate) / 1000);
    // The run is timed by play. The game makes nothing while the machine sleeps or the loop
    // stalls (it catches up at most 5 s, main.js:16788), and a rate measured across that gap
    // reads as a run that stopped growing. The run-length guard reads this clock too; the first
    // ascension's target is a prestige level and reads no clock.
    const runSeconds = () => (state.run ? state.run.seconds : wallAge());

    function firstTarget() {
        if (options.firstTarget) return options.firstTarget;
        let total = 0;
        for (const name of FIRST_SHOPPING_LIST) {
            const upgrade = game.Upgrades[name];
            if (upgrade && typeof upgrade.getPrice === 'function') total += upgrade.getPrice();
        }
        return total || 365;
    }

    /**
     * A buff worth finishing before ascending: it raises income and ends within minutes. Waiting
     * on every buff would stall a day for a golden lump's Sugar blessing (24 h) and an hour for a
     * backfired spell's misery, and a debuff costs nothing to leave behind.
     */
    function worthFinishing(buff) {
        const raises = (buff.multCpS || 1) > 1 || (buff.multClick || 1) > 1 || (buff.type && buff.type.name === 'cookie storm');
        return raises && buff.time <= BUFF_WAIT_SECONDS * game.fps;
    }

    function dragonEggWindow() {
        // "A crumbly egg" needs a million cookies earned in the current run; ascending inside that
        // window with the heavenly upgrade owned could keep the dragon locked forever.
        return game.Has('How to bake your dragon') && !game.HasUnlocked('A crumbly egg') && game.cookiesEarned < 1e6;
    }

    /**
     * A run is a stretch between reincarnations; the game counts them and dates their start.
     * Its clock advances by the logic frames the mod sees, whether Auto Ascend is on or not.
     */
    function trackRun(frame) {
        const current = { resets: game.resets, startDate: game.startDate };
        if (state.run && state.run.resets === current.resets && state.run.startDate === current.startDate) {
            state.run.seconds += (frame - state.run.frame) / game.fps;
            state.run.frame = frame;
            return;
        }
        // The run began at the prestige its reset left: measured from there even when the mod
        // starts mid-run, the average is not understated and the ascension not put off. What came
        // before the mod saw the run can only be read from the wall clock.
        state.run = { ...current, start: { t: 0, projected: game.HowMuchPrestige(game.cookiesReset) }, seconds: wallAge(), frame };
        state.history = [];
        state.lastSampleAt = -Infinity;
    }

    function sample() {
        const t = runSeconds();
        if (t - state.lastSampleAt < SAMPLE_SECONDS) return;
        state.lastSampleAt = t;
        state.history.push({ t, projected: withExtras() });
        if (state.history.length > HISTORY_LIMIT) state.history.shift();
    }

    function decide() {
        const projected = withExtras();
        state.verdict = {
            ...shouldAscend({
                prestige: game.prestige,
                projected,
                history: state.history,
                start: state.run.start,
                runSeconds: runSeconds(),
                firstTarget: firstTarget(),
            }),
            startDate: game.startDate, // the run it judges, so another system never reads it on the next
        };
        if (options.rule === 'double') {
            const doubled = game.prestige > 0 ? projected >= 2 * game.prestige : projected >= firstTarget();
            state.verdict = { ...state.verdict, ascend: doubled, reason: doubled ? 'prestige would double' : 'prestige would not double yet' };
        }
        if (!state.verdict.ascend) return;
        if (dragonEggWindow()) return;
        if (Object.values(game.buffs).some(worthFinishing)) return;

        // Plan while the bakery still stands: the chocolate egg routine sells every building.
        const prestigeAfter = Math.floor(projected);
        const chips = game.heavenlyChips + prestigeAfter - game.prestige;
        state.plan = planHeavenly(game, settings, chips, prestigeAfter);
        state.slotRanking = rankPermanentSlots(game, settings);
        log(
            `ascending: ${state.verdict.reason}. Plan: ${state.plan.buy.map((b) => b.name).join(', ') || 'nothing'}` +
                (state.plan.saving ? `; saving for ${state.plan.saving.name}` : '')
        );
        // Collect now, so it counts toward this ascension; the game grants chips at the end of
        // the ascend animation, long before the reset that used to do this.
        settings.preparedForAscension = true;
        prepare();
        state.phase = 'settling';
        state.settle = SETTLE_TICKS;
    }

    function ascend() {
        if (--state.settle > 0) return;
        state.phase = 'ascending';
        game.ClosePrompt();
        game.Ascend(1);
    }

    function finish() {
        if (!(game.OnAscend && !game.AscendTimer)) return;
        const bought = [];
        for (const item of state.plan ? state.plan.buy : []) {
            const upgrade = game.UpgradesById[item.id];
            if (!upgrade || upgrade.bought) continue;
            // canBePurchased is the game's own check, made when it builds the heavenly tree:
            // parents owned and the upgrade shown at this prestige.
            if (!upgrade.canBePurchased || game.heavenlyChips < upgrade.getPrice()) continue;
            game.PurchaseHeavenlyUpgrade(upgrade.id);
            if (upgrade.bought) bought.push(upgrade.name);
        }
        // Slots are assigned on this screen, as a player does, so a slot bought just now is used.
        const slots = assignPermanentSlots(game, state.slotRanking);
        state.last = {
            at: Date.now(),
            prestige: game.prestige,
            bought,
            saving: state.plan && state.plan.saving ? state.plan.saving.name : null,
            slots: slots.map((s) => s.name),
        };
        state.ascensions++;
        log(`bought ${bought.join(', ') || 'nothing'}; reincarnating at prestige ${game.prestige}`);
        game.ClosePrompt();
        game.Reincarnate(1);
        state.phase = 'playing';
        state.plan = null;
        state.slotRanking = [];
        if (buyer) buyer.invalidate();
    }

    /**
     * Auto Ascend switched off during the mod's own ascension. While collecting, nothing is started
     * yet and the run goes on; once Game.Ascend has run, the heavenly screen is the player's.
     */
    function release() {
        if (state.phase === 'settling') settings.preparedForAscension = false;
        state.phase = 'playing';
        state.plan = null;
        state.slotRanking = [];
    }

    function tick(frame) {
        trackRun(frame);
        if (settings.autoAscendToggle != 1) {
            if (state.phase !== 'playing') release();
            return;
        }
        if (state.phase === 'settling') return ascend();
        if (state.phase === 'ascending') return finish();
        // An ascension the mod did not start is left to the player.
        if (game.OnAscend || game.AscendTimer) return;
        sample();
        decide();
    }

    // Always ticking: the run clock counts play with Auto Ascend off too, and an ascension of the
    // mod's own is released when it is switched off.
    loop.add('ascension', tick, { everyFrames: TICK_EVERY });

    return {
        options,
        report() {
            const projected = withExtras();
            return {
                phase: state.phase,
                verdict: state.verdict,
                projected,
                realised: realised(),
                gain: Math.floor(projected) - game.prestige,
                firstTarget: game.prestige === 0 ? firstTarget() : null,
                runSeconds: runSeconds(),
                last: state.last,
                ascensions: state.ascensions,
            };
        },
        /** For tests: the current history of projected prestige. */
        history: () => state.history.slice(),
        /** The last growth verdict (shouldAscend), or null before the first; cheap, for other systems. */
        verdict: () => state.verdict,
        /** 'playing', 'settling' (collected, about to ascend) or 'ascending'. */
        phase: () => state.phase,
    };
}
