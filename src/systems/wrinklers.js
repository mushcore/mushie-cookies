// Wrinklers: keeps every slot feeding and pops the fattest ordinary wrinkler only when buying the
// buyer's next purchase sooner is worth more than the feeding its empty slot loses; collects them
// all before an ascension, the player's own included; pops for season drops only while a hunt the
// season system asked for pays. Popping sets a wrinkler's hp to 0, the state change the game's own
// Game.CollectWrinklers makes (main.js:14285-14291) and the result of clicking it (main.js:14430);
// the game's pop code pays it on the next logic frame.
import { decidePops, huntDecision, incomeMultiplier, expectedAttached, halloweenFailRate, halloweenDrops, easterFailRate, easterDrops } from '../core/wrinklers.js';
import { estimateIncome } from '../core/income.js';
import { readState } from '../game/measure.js';
import { telemetry, wrinklerParams, heldValue } from '../game/wrinklers.js';

const TICK_EVERY = 15; // frames: half a second, against respawn gaps of minutes
const POP_RATE_SECONDS = 3600; // the income model's pop rate is smoothed over about an hour
const HUNT_SEASONS = ['halloween', 'easter'];

const god = (game, name) => (game.hasGod ? game.hasGod(name) || 0 : 0);

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings  the mod's settings (autoWrinkler, autoBuy)
 * @param {object} deps.loop
 * @param {{next(): object|null, reserve(): number}} [deps.buyer]
 * @param {(what: string) => void} [deps.log]
 */
export function createWrinklers({ game, settings, loop, buyer = null, log = () => {} }) {
    const state = {
        pops: 0, // for purchases
        huntPops: 0,
        collected: 0,
        lastFrame: null,
        last: null, // the last purchase decision, for the menu
        hunt: null, // what the season system asked for
        huntVerdict: null,
        pendingAscend: false,
    };
    const on = () => Number(settings.autoWrinkler) > 0;

    function pop(ids) {
        for (const w of game.wrinklers) if (ids.includes(w.id)) w.hp = 0;
    }

    function decayPopRate(frame) {
        const seconds = state.lastFrame === null ? 0 : (frame - state.lastFrame) / game.fps;
        state.lastFrame = frame;
        telemetry.popRate *= Math.exp(-seconds / POP_RATE_SECONDS);
    }

    function purchaseTick() {
        const next = buyer ? buyer.next() : null;
        if (!next) {
            state.last = { pop: [], reason: 'nothing to buy' };
            return;
        }
        const reserve = buyer.reserve();
        if (next.price + reserve <= game.cookies) {
            state.last = { pop: [], reason: 'affordable', next: next.name };
            return;
        }
        const p = wrinklerParams(game);
        if (!p.candidates.length) {
            state.last = { pop: [], reason: 'no wrinklers', next: next.name };
            return;
        }
        // What reaches the bank a second without popping: withered CpS, clicks and golden cookies.
        const now = readState(game, settings);
        const liquid = estimateIncome({ ...now, wrinklers: { count: p.attached, returnMult: 0, suckRate: p.suck } }).total;
        const decision = decidePops({
            candidates: p.candidates,
            attached: p.attached,
            payoutSum: p.payoutSum,
            popMult: p.popMult,
            suck: p.suck,
            cps: game.unbuffedCps,
            bank: game.cookies,
            price: next.price,
            reserve,
            deltaIncome: next.deltaIncome,
            liquidIncome: liquid,
            spawnPerSecond: p.spawnPerSecond,
            crawl: p.crawl,
        });
        state.last = { ...decision, next: next.name };
        if (!decision.pop.length) return;
        pop(decision.pop);
        state.pops += decision.pop.length;
        telemetry.popRate += decision.pop.length / POP_RATE_SECONDS;
        log(`popped ${decision.pop.length} wrinkler${decision.pop.length > 1 ? 's' : ''} to buy ${next.name} sooner`);
    }

    /** Chance per pop of each drop of `season` not yet found. */
    function dropsFor(season) {
        const owned = (names) => names.filter((n) => game.Has(n) || game.HasUnlocked(n));
        if (season === 'halloween') {
            const failRate = halloweenFailRate({
                spooky: !!game.HasAchiev('Spooky cookies'),
                starterror: game.Has('Starterror'),
                dropRateMult: game.dropRateMult(),
                selebrak: god(game, 'seasons'),
            });
            return halloweenDrops({ failRate, owned: owned(game.halloweenDrops) });
        }
        if (season === 'easter') {
            const failRate = easterFailRate({
                dropRateMult: game.dropRateMult(),
                hideAndSeek: !!game.HasAchiev('Hide & seek champion'),
                omelette: game.Has('Omelette'),
                starspawn: game.Has('Starspawn'),
                selebrak: god(game, 'seasons'),
            });
            return easterDrops({ failRate, owned: owned(game.easterEggs), eggs: game.eggDrops, rareEggs: game.rareEggDrops });
        }
        return [];
    }

    /** What a hunt of `season` would gain and forfeit a second, at the drop values given. */
    function valueHunt({ season, value }) {
        const p = wrinklerParams(game);
        // Without the hunt the policy keeps its steady-state count attached.
        const kept = expectedAttached({ max: p.max, now: p.max, popRate: telemetry.popRate, spawnPerSecond: p.spawnPerSecond, crawl: p.crawl, horizon: Infinity });
        return huntDecision({
            drops: dropsFor(season),
            value,
            slots: p.max,
            spawnPerSecond: p.spawnPerSecond,
            cps: game.unbuffedCps,
            normalMultiplier: incomeMultiplier({ attached: kept, suck: p.suck, payoutSum: kept * p.popMult }),
            crawl: p.crawl,
        });
    }

    /** Pops for drops while the season system's hunt pays; true while hunting. */
    function huntTick() {
        const request = state.hunt;
        if (!request || game.season !== request.season) {
            state.huntVerdict = null;
            telemetry.hunting = false;
            return false;
        }
        const verdict = valueHunt(request);
        state.huntVerdict = verdict;
        telemetry.hunting = verdict.hunt;
        if (!verdict.hunt) return false;
        // A drop needs a payout above half a cookie (main.js:14480). Shinies are kept.
        const ids = wrinklerParams(game).candidates.filter((c) => !c.shiny && c.payout > 0.5).map((c) => c.id);
        if (ids.length) {
            pop(ids);
            state.huntPops += ids.length;
        }
        return true;
    }

    function tick(frame) {
        decayPopRate(frame);
        if (game.OnAscend || game.AscendTimer) return;
        if (huntTick()) return;
        // Buying sooner is the only reason to pop; with no buyer buying, nothing is bought sooner.
        if (!settings.autoBuy) {
            state.last = { pop: [], reason: 'the buyer is off' };
            return;
        }
        purchaseTick();
    }

    /** Pops every wrinkler in play, shinies too. The payouts land on the next logic frame. */
    function collect() {
        let n = 0;
        for (const w of game.wrinklers) {
            if (w.phase > 0 && w.hp > 0.5) {
                w.hp = 0;
                n++;
            }
        }
        state.collected += n;
        return n;
    }

    // An ascension the player starts. The game grants its chips at the end of the ascend animation
    // (main.js:4094) and stops updating wrinklers as soon as the animation starts (main.js:16165),
    // so a wrinkler popped after Game.Ascend never pays, and the reset wipes it (main.js:3532).
    // They are popped first; the ascension follows on the next logic frame, after the payout.
    const ascendOriginal = game.Ascend;
    const holdsCookies = () => game.wrinklers.some((w) => w.phase > 0 && w.sucked > 0);
    game.Ascend = function (bypass) {
        if (bypass && on() && !game.OnAscend && !game.AscendTimer && holdsCookies()) {
            if (!state.pendingAscend) {
                collect();
                state.pendingAscend = true;
            }
            return;
        }
        return ascendOriginal.apply(this, arguments);
    };
    function ascendTick() {
        if (!state.pendingAscend) return;
        state.pendingAscend = false;
        if (game.OnAscend || game.AscendTimer) return;
        ascendOriginal.call(game, 1);
    }

    loop.add('wrinklers', tick, { everyFrames: TICK_EVERY, enabled: on });
    loop.add('wrinklers:ascend', ascendTick);

    return {
        collect,
        /** Cookies collecting every wrinkler would pay now. */
        held: () => heldValue(game),
        /**
         * For the season system: pop for drops during `season` ('halloween' or 'easter') while
         * the drops expected a second, at `value` cookies per drop (a number, or a function of
         * the drop's name), beat the wrinkler income the hunt forfeits. null stops it. No hunt
         * runs until one is asked for.
         */
        hunt(request) {
            state.hunt = request && HUNT_SEASONS.includes(request.season) ? { season: request.season, value: request.value } : null;
            if (!state.hunt) telemetry.hunting = false;
        },
        /** The same valuation without acting: {hunt, gain, cost, perPop, popsPerSecond}. */
        valueHunt,
        hunting: () => !!telemetry.hunting,
        report() {
            const p = wrinklerParams(game);
            return {
                attached: p.attached,
                max: p.max,
                held: heldValue(game),
                pops: state.pops,
                huntPops: state.huntPops,
                collected: state.collected,
                popsPerHour: telemetry.popRate * 3600,
                hunting: !!telemetry.hunting,
                hunt: state.huntVerdict,
                last: state.last,
            };
        },
    };
}
