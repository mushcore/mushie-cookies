// Casts Force the Hand of Fate at the right moment: the next outcome is forecast, bad ones are
// burnt with a harmless spell, good ones wait out a debuff that ends soon enough, and wait for a
// buff to land on unless mana is full. With Double Cast on, a cast whose next outcome is worth
// much more on this one's buff is followed at once by that second cast, paid for by selling
// Wizard towers between the two and buying them back (src/core/doublecast.js).
import { forecastFate } from '../game/fate.js';
import { decideCast } from '../core/grimoire.js';
import { decideDouble, planSale, fateOdds, magicMax, regenSeconds, contextAt } from '../core/doublecast.js';
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
// Max magic follows a sale on the game's next fifth frame (minigameGrimoire.js:485); if it has
// not after three of those, something else changed the towers and the second cast is dropped.
const RECOMPUTE_FRAMES = 15;
// A double cast the bank cannot yet pay for is waited for when the shortfall is this many
// seconds of income or less; mana is full by then, so each second waited is regeneration lost.
const BANK_WAIT_SECONDS = 60;
const HOLDER = 'grimoire';

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings   autoFate and autoFTHOFCombo, plus the inherited casting settings it must not fight
 * @param {object} deps.loop
 * @param {object} [deps.buyer]    held while towers are sold; asked to keep the cookies the buy-back needs
 * @param {(what: string) => void} [deps.log]
 */
export function createGrimoire({ game, settings, loop, buyer = null, log = () => {} }) {
    const state = {
        last: null,
        casts: 0,
        skips: 0,
        decision: null,
        doubles: 0,
        aborted: 0,
        lastDouble: null,
        double: null,
        sequence: null, // a double cast under way
        bankWait: null, // frame a double cast began waiting for the bank
    };

    // The inherited casting modes and the 100% combo cast on their own; running both would
    // double-cast. The inherited double-cast combo is gone: its setting turns on double casting here.
    const inheritedCasting = () => settings.autoCasting != 0 || settings.auto100ConsistencyCombo == 1;
    const doubling = () => settings.autoFTHOFCombo == 1;
    const tower = () => game.Objects['Wizard tower'];

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
    // 10 or more, picked at random, for 1 + amount/10 (main.js:5496-5512). `towersLeft` counts the
    // Wizard towers as a sale would leave them.
    const buildingSpecials = (towersLeft) =>
        game.ObjectsById.map((b) => ({ b, amount: towersLeft !== undefined && b === tower() ? towersLeft : b.amount }))
            .filter((x) => x.amount >= 10)
            .map(({ b, amount }) => ({ name: game.goldenCookieBuildingBuffs[b.name][0], mult: amount / 10 + 1 }));

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

    /** Casts Force the Hand of Fate and clicks the cookie it made, as a player would. */
    function castFate(grimoire) {
        const before = new Set(game.shimmers);
        if (!grimoire.castSpell(grimoire.spells[FATE])) return null;
        state.casts++;
        const made = game.shimmers.find((s) => !before.has(s));
        // Popping clears the forced outcome (main.js:5452): read it first.
        const force = made ? made.force : null;
        if (made) made.pop();
        return { force };
    }

    /**
     * The double cast to follow `next` with, valued as if cast with `magic` in the bar. The second
     * cast's fail chance is today's: the first cast's cookie is clicked before it (each golden
     * cookie on screen adds 15%, minigameGrimoire.js:44-47), and a double cast starts only with
     * none on screen, since one clicked at an unknown moment would change the second forecast.
     */
    function planDouble(grimoire, next, ctx, magic) {
        const spell = grimoire.spells[FATE];
        const t = tower();
        const costFirst = grimoire.getSpellCost(spell);
        const sale = planSale({ towers: t.amount, level: t.level, left: magic - costFirst, spell, intellect: game.auraMult('Supreme Intellect') });
        const sold = sale ? sale.sell : 0;
        const failChance = grimoire.getFailChance(spell);
        const second = forecastFate(game, grimoire, 1, { failChance, buildingsOwned: game.BuildingsOwned - sold });
        // A sale refunds a quarter of the price (main.js:7818-7824) and the buy-back pays it all.
        const refund = sold ? t.getReverseSumPrice(sold) : 0;
        const rebuyLoss = sold ? refund / t.getSellMultiplier() - refund : 0;
        // What this system asked the buyer to keep is its own to spend.
        const mine = buyer ? buyer.kept(HOLDER) : 0;
        const decision = decideDouble({
            first: next,
            second,
            ctx,
            ctxSecond: sale ? { ...ctx, bank: ctx.bank + refund, buildingSpecials: buildingSpecials(sale.keep) } : ctx,
            odds: fateOdds({ failChance, dragonflight: !!game.hasBuff('Dragonflight'), buildingsOwned: game.BuildingsOwned }),
            mana: { now: magic, max: grimoire.magicM, costFirst },
            sale,
            rebuyLoss,
            spendable: game.cookies - (buyer ? buyer.reserve() - mine : 0),
        });
        return { ...decision, sale, second, rebuyLoss };
    }

    /**
     * Keeps the cookies a coming double cast will need, from the moment its pair is forecast, so
     * the buyer does not spend them while mana fills.
     */
    function keepForDouble(grimoire, next, ctx, action) {
        if (!buyer) return;
        let amount = 0;
        if (doubling() && action !== 'skip') {
            // A pair waiting for mana is cast once the bar is full at the latest (decideCast), on
            // the buffs still running then: a Frenzy that ends first is no reason to keep anything.
            const seconds = action === 'cast' ? 0 : regenSeconds(grimoire.magic, grimoire.magicM, grimoire.magicM);
            const plan = planDouble(grimoire, next, contextAt(ctx, seconds), grimoire.magicM);
            if (plan.gain > 0) amount = plan.rebuyLoss;
        }
        buyer.keep(HOLDER, amount);
    }

    function tick(frame) {
        const grimoire = tower().minigame;
        if (state.sequence) return step(grimoire);
        if (frame % TICK_EVERY) return;
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
        keepForDouble(grimoire, next, ctx, decision.action);
        if (decision.action === 'wait') return;

        if (decision.action === 'skip') {
            if (grimoire.castSpell(grimoire.spells[SKIP])) {
                state.skips++;
                log(`skipped a ${next.outcome} with Haggler's Charm`);
            }
            return;
        }

        if (doubling() && Number.isFinite(decision.value) && game.shimmerTypes.golden.n === 0) {
            const plan = planDouble(grimoire, next, ctx, grimoire.magic);
            state.double = { action: plan.action, reason: plan.reason, gain: plan.gain, second: plan.second.outcome };
            if (plan.action === 'double') {
                state.bankWait = null;
                return startDouble(grimoire, next, plan, decision);
            }
            // The bank is short of the buy-back by a few seconds of income: wait for it, a while.
            if (plan.short > 0) {
                if (state.bankWait === null) state.bankWait = frame;
                const waited = (frame - state.bankWait) / game.fps;
                if (waited + plan.short / (ctx.passive + ctx.click) <= BANK_WAIT_SECONDS) {
                    state.decision = { ...state.decision, action: 'wait', reason: `the bank for a double cast of ${plan.second.outcome}` };
                    return;
                }
            }
        }
        state.bankWait = null;

        const made = castFate(grimoire);
        if (!made) return;
        state.last = { outcome: next.outcome, reason: decision.reason };
        log(`cast Force the Hand of Fate: ${decision.reason}`);
    }

    function startDouble(grimoire, next, plan, decision) {
        const made = castFate(grimoire);
        if (!made) return;
        state.last = { outcome: next.outcome, reason: decision.reason };
        log(`cast Force the Hand of Fate: ${decision.reason}, then ${plan.reason}`);
        // Only the pair that was valued is worth the towers.
        if (made.force !== next.outcome) return;
        const t = tower();
        const amount = t.amount;
        if (buyer) buyer.hold(HOLDER);
        if (plan.sale.sell) t.sell(plan.sale.sell);
        const sold = amount - t.amount;
        // The refund is in the bank now. Until the towers are back, their whole price is spoken
        // for (main.js:7797-7806), or another spender could take the refund and leave the
        // buy-back short.
        if (buyer && sold > 0) buyer.keep(HOLDER, t.getSumPrice(sold));
        state.sequence = { first: next.outcome, second: plan.second, amount, sold, gain: plan.gain, frames: 0 };
        // With nothing sold, max magic already fits and the second cast can follow now.
        step(grimoire);
    }

    /** The rest of a double cast, one frame at a time: the second cast once max magic has followed the sale. */
    function step(grimoire) {
        const seq = state.sequence;
        seq.frames++;
        try {
            if (!grimoire || game.OnAscend || game.AscendTimer) return finish(seq, 'an ascension began', false);
            const t = tower();
            if (grimoire.magicM !== magicMax(t.amount, t.level)) {
                if (seq.frames < RECOMPUTE_FRAMES) return;
                return finish(seq, 'max magic did not follow the sale');
            }
            const now = forecastFate(game, grimoire, 0);
            if (now.outcome !== seq.second.outcome || now.success !== seq.second.success) {
                return finish(seq, `the second cast would now be ${now.outcome}`);
            }
            const made = castFate(grimoire);
            if (!made) return finish(seq, 'the second cast could not be made');
            return finish(seq, null);
        } catch (error) {
            if (state.sequence === seq) finish(seq, `failed: ${error.message}`);
            throw error;
        }
    }

    function finish(seq, failure, buyBack = true) {
        state.sequence = null;
        try {
            if (buyBack) restore(seq);
        } finally {
            // The towers are back, so the buyer's ranking still holds and it carries on from it.
            if (buyer) {
                buyer.release(HOLDER);
                buyer.keep(HOLDER, 0);
            }
        }
        if (failure) {
            state.aborted++;
            log(`double cast dropped: ${failure}`);
            return;
        }
        state.doubles++;
        state.lastDouble = { first: seq.first, second: seq.second.outcome, sold: seq.sold, gain: seq.gain };
        log(`double cast ${seq.second.outcome} on ${seq.first}; bought back ${seq.sold} Wizard towers`);
    }

    /** Buys back what the sale sold; the game's buy() sells in sell mode (main.js:7828), so buy mode is set. */
    function restore(seq) {
        const t = tower();
        const missing = Math.min(seq.sold, seq.amount - t.amount);
        if (missing <= 0) return;
        const mode = game.buyMode;
        game.buyMode = 1;
        try {
            t.buy(missing);
        } finally {
            game.buyMode = mode;
        }
    }

    // Every frame, since the second cast of a double follows the first within a few; the
    // decisions themselves are made every TICK_EVERY frames. A double cast under way finishes even
    // if the setting is switched off meanwhile, so the towers are never left sold.
    loop.add('grimoire', tick, { enabled: () => !!state.sequence || ((settings.autoFate == 1 || doubling()) && !inheritedCasting()) });

    return {
        report() {
            return {
                casts: state.casts,
                skips: state.skips,
                last: state.last,
                decision: state.decision,
                doubles: state.doubles,
                aborted: state.aborted,
                lastDouble: state.lastDouble,
                double: state.double,
            };
        },
        context,
    };
}
