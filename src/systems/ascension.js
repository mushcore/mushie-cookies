// Ascension: ends a run when its prestige growth has slowed, plans the heavenly upgrades and
// permanent slots while the bakery still exists to measure against, collects what an ascension
// would otherwise lose, then ascends, buys and reincarnates. Only an ascension this system
// started is ever finished by it.
import { shouldAscend } from '../core/ascension.js';
import { planHeavenly, rankPermanentSlots, assignPermanentSlots } from '../game/prestige.js';

const TICK_EVERY = 30; // frames
const SAMPLE_SECONDS = 60; // one history sample a minute
const HISTORY_LIMIT = 60 * 24; // a day of samples
const SETTLE_TICKS = 2; // what prepare() collects settles over the next logic frames
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
 * @param {() => void} [deps.collect]  pops the wrinklers, a tick before prepare: they pay on later logic frames
 * @param {() => void} deps.prepare    collects the rest: sells stock, harvests, the chocolate egg
 * @param {{invalidate(): void}} [deps.buyer]
 * @param {(what: string) => void} [deps.log]
 */
export function createAscension({ game, settings, loop, extras = () => 0, collect = () => {}, prepare = () => {}, buyer = null, log = () => {} }) {
    // 'rate' is the rule this system is built on; 'double' (ascend once prestige would double,
    // the inherited rule) is kept so the two can be compared in the harness. `firstTarget`
    // overrides the first ascension's prestige target (null: the starter set's price).
    const options = { rule: 'rate', firstTarget: null };
    const state = {
        phase: 'playing', // then 'collecting' (wrinklers), 'settling' (the rest), then 'ascending'
        run: null, // { resets, startDate, start: {t, projected} }
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
    const runSeconds = () => Math.max(0, (Date.now() - game.startDate) / 1000);

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

    /** A run is a stretch between reincarnations; the game counts them and dates their start. */
    function trackRun() {
        const current = { resets: game.resets, startDate: game.startDate };
        if (state.run && state.run.resets === current.resets && state.run.startDate === current.startDate) return;
        // The run began at the prestige its reset left: measured from there even when the mod
        // starts mid-run, the average is not understated and the ascension not put off.
        state.run = { ...current, start: { t: 0, projected: game.HowMuchPrestige(game.cookiesReset) } };
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
        // Wrinklers first: they pay on the next logic frame, and the chocolate egg in prepare()
        // pays 5% of the bank, which should include them (main.js:10398-10403, 14457-14513).
        collect();
        state.phase = 'collecting';
    }

    function afterCollecting() {
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

    function tick() {
        if (state.phase === 'collecting') return afterCollecting();
        if (state.phase === 'settling') return ascend();
        if (state.phase === 'ascending') return finish();
        // An ascension the mod did not start is left to the player.
        if (game.OnAscend || game.AscendTimer) return;
        trackRun();
        sample();
        decide();
    }

    loop.add('ascension', tick, { everyFrames: TICK_EVERY, enabled: () => settings.autoAscendToggle == 1 });

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
