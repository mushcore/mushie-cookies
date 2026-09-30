// Godzamok and the Golden switch, played by expected value (src/core/combos.js).
//
// Godzamok: while a click buff runs and he is slotted, sell the buildings that give the most
// Devastation per cookie lost and buy each straight back, as a player does with the store's sell
// and buy buttons; again every half second while a sale still pays. The bakery is left as it was,
// less the cookies lost, and the buff stays.
//
// Golden switch: turned on during a click buff when what it adds until the cheapest moment to turn
// it off beats both toggles and the golden cookies it stops; turned off at that moment. Left on for
// good only when that out-earns golden cookies.
//
// Both spend only what the buyer is not holding. While the switch is on for a combo, the buyer
// keeps the reserve it held before, which the model would otherwise drop since no golden cookie
// can spawn (src/game/measure.js), and the price of turning the switch off on top.
import { simulate } from '../core/sim.js';
import { estimateIncome } from '../core/income.js';
import { classifyBuffs, unbuffedFactors, KINDS } from '../core/buffs.js';
import {
    planSale,
    saleOptions,
    devastationPerBuilding,
    devastationGainPerUnit,
    godzamokOn,
    goldenSwitchOn,
    switchPlan,
    offPlan,
    renewedDevastation,
    keepStanding,
    turnOnStanding,
    DEVASTATION_SECONDS,
} from '../core/combos.js';
import { goldenCookiesClicked, lindyHorizon } from '../core/gods.js';
import { readState, clicksPerSecond } from '../game/measure.js';
import { sellableBuildings, godzamokLevel, CYCLE_FRAMES } from '../game/combos.js';

const TICK_EVERY = 3; // frames
const MEASURE_EVERY = 150; // frames a measurement of the switch is reused while nothing changes
const REMEASURE_FRAMES = 30; // and at least this long when the bakery changed
const STANDING_EVERY = 30 * 60; // frames between checks of leaving the switch on for good
// Bought, 'Golden switch [off]' turns the switch on; 'Golden switch [on]' turns it off again
// (main.js:10677-10678, 10692-10693, 9557-9561).
const SWITCH_ON = 'Golden switch [off]';
const SWITCH_OFF = 'Golden switch [on]';

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings  autoGodzamok, autoGS, autoClick, cookieClickSpeed, and the inherited combos
 * @param {object} deps.loop
 * @param {object} [deps.buyer]   for its reserve, and to re-rank after a toggle
 * @param {() => number} [deps.runSeconds]  how long the run has been played (the ascension
 *   system's clock); by default its age by the wall clock
 * @param {(what: string) => void} [deps.log]
 */
export function createCombos({ game, settings, loop, buyer = null, runSeconds = null, log = () => {} }) {
    // - cycleFrames: frames between sales.
    // - rebuy: 'now' buys each building sold straight back; 'buyer' leaves it to the buyer, one
    //   sale per Devastation window (kept to measure one against the other).
    const options = { cycleFrames: CYCLE_FRAMES, rebuy: 'now' };
    const state = {
        cycles: 0,
        units: 0,
        lost: 0,
        lastCycle: -Infinity,
        windows: 0,
        switchedOn: 0,
        switchedOff: 0,
        spentOnSwitch: 0,
        freshMult: 1, // Devastation after a window's first sale in the running click buff
        mode: null, // 'combo' | 'standing' while the switch is on
        heldBefore: 0,
        hold: 0,
        standingAt: 0,
        plan: null,
        last: null,
    };
    const measured = { at: -Infinity, stamp: '', value: null };

    const invalidate = () => buyer && buyer.invalidate();
    const reserve = () => Math.max(buyer ? buyer.reserve() : 0, state.hold);
    const free = () => game.cookies - reserve();
    // The run's length as played: the game makes nothing while the machine sleeps or the loop
    // stalls, and the wall clock would count that as run.
    const played = runSeconds || (() => Math.max(0, (Date.now() - game.startDate) / 1000));

    /** Every running buff as the shared classifier sees it, in the shape the pure decisions take. */
    function runningBuffs() {
        return classifyBuffs(game.buffs, { fps: game.fps }).map((c) => ({
            name: c.name,
            type: c.type,
            kind: c.kind,
            multCpS: c.cpsMult,
            multClick: c.clickMult,
            fixedClick: c.fixedClick,
            secondsLeft: c.secondsLeft,
        }));
    }
    // Short click spikes (Click frenzy, Dragonflight). Devastation multiplies clicks too, but it
    // is the combo's own doing, not a reason for it.
    const clickBuffsOf = (buffs) => buffs.filter((b) => b.kind === KINDS.SPIKE && b.multClick > 1 && b.type !== 'devastation');
    const devastationOf = (buffs) => buffs.find((b) => b.type === 'devastation') || null;

    // --- Godzamok -----------------------------------------------------------------------------

    /** The sale worth making now, or null. */
    function saleNow(buffs) {
        const perBuilding = devastationPerBuilding(godzamokLevel(game));
        const clicking = clickBuffsOf(buffs);
        // A Cursed finger fixes what a click earns, whatever multiplies it (main.js:4744).
        if (!perBuilding || !clicking.length || buffs.some((b) => b.fixedClick !== null)) return null;
        // The clicker's measured rate (src/systems/clicker.js), as the income model counts it.
        const rate = clicksPerSecond(settings);
        if (!(rate > 0)) return null;
        const devastation = devastationOf(buffs);
        const devMult = devastation ? devastation.multClick : 1;
        const gainPerUnit = devastationGainPerUnit({
            perBuilding,
            clickIncome: (rate * game.computedMouseCps) / devMult,
            buffs: clicking,
            // A sale while the buff runs adds to it without renewing it (main.js:7889-7894).
            windowSeconds: devastation ? devastation.secondsLeft : DEVASTATION_SECONDS,
        });
        const plan = planSale({ options: saleOptions(sellableBuildings(game)), gainPerUnit, budget: free() });
        return plan.units > 0 ? { ...plan, fresh: !devastation, perBuilding } : null;
    }

    function godzamok(frame, buffs) {
        if (frame - state.lastCycle < options.cycleFrames) return;
        const leave = options.rebuy === 'buyer';
        if (leave && devastationOf(buffs)) return;
        const plan = saleNow(buffs);
        if (!plan) return;
        const before = game.cookies;
        const amounts = plan.sales.map((s) => game.ObjectsById[s.id].amount);
        // The game's buy() sells when the store is in sell mode (main.js:7828).
        const mode = game.buyMode;
        game.buyMode = 1;
        try {
            for (const s of plan.sales) game.ObjectsById[s.id].sell(s.units);
            if (!leave) for (const s of plan.sales) game.ObjectsById[s.id].buy(s.units);
        } finally {
            game.buyMode = mode;
        }
        state.lastCycle = frame;
        state.cycles++;
        state.units += plan.units;
        // Left to the buyer, what is lost is the buildings' worth at today's prices, less the refund.
        state.lost += leave ? plan.loss : before - game.cookies;
        const short = plan.sales.filter((s, i) => game.ObjectsById[s.id].amount !== amounts[i]);
        if (leave) invalidate();
        else if (short.length) {
            // Not all bought back: the buyer decides what to buy next.
            invalidate();
            log(`combos: could not buy back every ${short.map((s) => game.ObjectsById[s.id].name).join(', ')}`);
        }
        const devastation = game.hasBuff('Devastation');
        state.last = `sold and bought back ${plan.units} buildings: Devastation x${devastation ? devastation.multClick.toFixed(2) : '?'}`;
        if (plan.fresh) {
            state.windows++;
            if (devastation) state.freshMult = devastation.multClick;
            log(`combos: ${state.last}`);
        }
    }

    // --- Golden switch ------------------------------------------------------------------------

    // Each measurement is taken with no buff and no golden cookie on screen (as src/systems/gods.js
    // does): the pure decisions scale it by the buffs as they run.
    function whatIf(apply, measure) {
        const golden = game.shimmerTypes.golden;
        const onScreen = golden.n;
        const buffs = game.buffs;
        return simulate(game, {
            apply() {
                golden.n = 0;
                game.buffs = {};
                apply();
            },
            measure,
            revert() {
                golden.n = onScreen;
                game.buffs = buffs;
            },
        });
    }

    /**
     * What the switch adds with the bakery as it is, by the game's own calculation: CpS, click
     * power and the price of turning it off, with it on and off; the income model's income either
     * way, and what golden cookies earn, which is nothing unless they are clicked.
     */
    function measureSwitch() {
        const upgrade = game.Upgrades[SWITCH_ON];
        const clicked = goldenCookiesClicked(settings, true);
        const read = () => {
            const s = readState(game, settings);
            const withGolden = estimateIncome(s).total;
            const without = estimateIncome({ ...s, golden: { ...s.golden, meanInterval: Infinity } }).total;
            return {
                cps: game.unbuffedCps,
                click: game.computedMouseCps,
                priceOff: game.Upgrades[SWITCH_OFF].getPrice(),
                income: clicked ? withGolden : without,
                goldenRate: clicked ? withGolden - without : 0,
            };
        };
        const on = whatIf(() => {
            upgrade.bought = 1;
        }, read);
        const off = whatIf(() => {
            upgrade.bought = 0;
        }, read);
        return {
            deltaCps: on.cps - off.cps,
            deltaClick: on.click - off.click,
            priceOffBase: on.priceOff,
            goldenRate: off.goldenRate,
            incomeOn: on.income,
            incomeOff: off.income,
        };
    }

    function switchEffect(frame) {
        const M = game.Objects['Temple'].minigame;
        const stamp = [game.BuildingsOwned, game.UpgradesOwned, game.AchievementsOwned, game.dragonAura, game.dragonAura2, M && M.slot ? M.slot.join(',') : ''].join('|');
        // Two what-ifs a measurement: during a click buff, when the buyer may buy every few frames,
        // a change is picked up within a second rather than at once.
        const age = frame - measured.at;
        if (!measured.value || age >= MEASURE_EVERY || (measured.stamp !== stamp && age >= REMEASURE_FRAMES)) {
            measured.value = measureSwitch();
            measured.stamp = stamp;
            measured.at = frame;
        }
        return measured.value;
    }

    // Each frame the game recalculates CpS (main.js:16274) before it ends the buffs that ran out
    // (main.js:13809-13822), so on the frame a Frenzy ends either toggle's price, an hour of CpS
    // (main.js:10679, 10694), still carries its x7. Game.cookiesPs is Game.unbuffedCps times the
    // buffs it was computed with (main.js:5155-5162); above that times the buffs running now, the
    // price is one the next frame lowers.
    function priceFalling() {
        return game.cookiesPs > game.unbuffedCps * unbuffedFactors(game.buffs).cps * (1 + 1e-9);
    }

    function buySwitch(upgrade) {
        if (priceFalling()) return false;
        const price = upgrade.getPrice();
        if (!upgrade.buy()) return false;
        state.spentOnSwitch += price;
        return true;
    }

    function planArgs(frame, buffs) {
        const m = switchEffect(frame);
        // While Godzamok is played, the switch sees the Devastation the combo keeps renewing.
        const spikeEnd = clickBuffsOf(buffs).reduce((most, b) => Math.max(most, b.secondsLeft), 0);
        const seen = godzamokOn(settings) && godzamokLevel(game) ? renewedDevastation(buffs, state.freshMult, spikeEnd) : buffs;
        return { m, args: { deltaCps: m.deltaCps, deltaClick: m.deltaClick, clicksPerSecond: clicksPerSecond(settings), priceOffBase: m.priceOffBase, goldenRate: m.goldenRate, buffs: seen } };
    }

    function considerOn(frame, buffs, turnOn) {
        if (!clickBuffsOf(buffs).length) return considerStanding(frame, buffs, turnOn);
        const { args } = planArgs(frame, buffs);
        const priceOn = turnOn.getPrice();
        const plan = switchPlan({ ...args, priceOn });
        state.plan = plan;
        // The way back need not be in hand yet: a plan worth making earns more than it costs
        // before the moment it is turned off, and the buyer holds it from now (state.hold).
        if (!(plan.value > 0) || priceOn > free()) return;
        const heldBefore = buyer ? buyer.reserve() : 0;
        if (!buySwitch(turnOn)) return;
        state.mode = 'combo';
        state.heldBefore = heldBefore;
        state.hold = heldBefore + plan.priceOff;
        state.switchedOn++;
        invalidate();
        state.last = `Golden switch on for a click buff: +${plan.gain.toExponential(2)} for ${plan.cost.toExponential(2)}, off in ${Math.round(plan.offAt)} s`;
        log(`combos: ${state.last}`);
    }

    function considerStanding(frame, buffs, turnOn) {
        if (frame < state.standingAt) return;
        state.standingAt = frame + STANDING_EVERY;
        // The price is an hour of the CpS of the moment: never paid on top of a short CpS spike.
        // A long boost (a retirement loan's x1.2 for two days, Sugar frenzy's hour) is not waited
        // out: that would forgo the switch for longer than the part of the price it saves.
        if (buffs.some((b) => b.kind === KINDS.SPIKE && b.multCpS > 1)) return;
        const m = switchEffect(frame);
        const priceOn = turnOn.getPrice();
        const worth = turnOnStanding({ incomeOn: m.incomeOn, incomeOff: m.incomeOff, priceOn, priceOff: m.priceOffBase, horizonSeconds: lindyHorizon(played()) });
        if (!worth || priceOn > free() || !buySwitch(turnOn)) return;
        state.mode = 'standing';
        state.heldBefore = 0;
        state.hold = 0;
        state.switchedOn++;
        invalidate();
        state.last = 'Golden switch on for good: it out-earns golden cookies';
        log(`combos: ${state.last}`);
    }

    function considerOff(frame, buffs, turnOff) {
        const { m, args } = planArgs(frame, buffs);
        if (keepStanding({ incomeOn: m.incomeOn, incomeOff: m.incomeOff })) {
            // Better on for good, whoever turned it on.
            state.mode = 'standing';
            state.heldBefore = 0;
            state.hold = 0;
            return;
        }
        const plan = offPlan(args);
        state.plan = plan;
        const hold = state.heldBefore + plan.priceOff;
        if (hold > state.hold * 1.1) invalidate(); // the buyer re-ranks, and holds it
        state.hold = hold;
        if (plan.offAt > 0) return;
        turnOffNow(turnOff);
    }

    function turnOffNow(turnOff) {
        if (!turnOff.unlocked || turnOff.bought) return;
        if (game.cookies < turnOff.getPrice() || !buySwitch(turnOff)) return;
        state.mode = null;
        state.heldBefore = 0;
        state.hold = 0;
        state.switchedOff++;
        invalidate();
        state.last = 'Golden switch off';
        log(`combos: ${state.last}`);
    }

    // Auto-Golden Switch turned off while the switch is on for a click buff: nothing else would
    // turn it off, and no golden cookie would spawn again (main.js:5673-5676). It goes off as soon
    // as the bank covers it, the buyer holding the way back meanwhile. A switch the player turned
    // on, or one left on for good, stays as it is.
    function releaseSwitch() {
        if (state.mode !== 'combo') {
            state.hold = 0;
            return;
        }
        const turnOff = game.Upgrades[SWITCH_OFF];
        if (!game.Has(SWITCH_ON) || !turnOff) {
            state.mode = null;
            state.heldBefore = 0;
            state.hold = 0;
            return;
        }
        turnOffNow(turnOff);
    }

    function goldenSwitch(frame, buffs) {
        const turnOn = game.Upgrades[SWITCH_ON];
        const turnOff = game.Upgrades[SWITCH_OFF];
        if (!turnOn || !turnOff) return;
        if (game.Has(SWITCH_ON)) return considerOff(frame, buffs, turnOff);
        state.mode = null;
        state.hold = 0;
        // Only what the store offers: buy() alone does not check that (main.js:9549-9556).
        if (turnOn.unlocked && !turnOn.bought) considerOn(frame, buffs, turnOn);
    }

    function tick(frame) {
        if (game.OnAscend || game.AscendTimer) return;
        const buffs = runningBuffs();
        // A new click buff's first window sets its own level.
        if (!clickBuffsOf(buffs).length) state.freshMult = 1;
        // The switch first: what it adds to clicks is what Devastation multiplies.
        if (goldenSwitchOn(settings)) goldenSwitch(frame, buffs);
        else releaseSwitch();
        if (godzamokOn(settings)) godzamok(frame, buffs);
    }

    loop.add('combos', tick, { everyFrames: TICK_EVERY, enabled: () => godzamokOn(settings) || goldenSwitchOn(settings) || state.mode === 'combo' });

    return {
        options,
        /** Cookies the buyer must hold for the switch: what it held before, and the way back. */
        hold() {
            return (goldenSwitchOn(settings) || state.mode === 'combo') && game.Has(SWITCH_ON) ? state.hold : 0;
        },
        /**
         * The switch is on only for a click buff, and this system turns it off once the buff has
         * paid: other systems judge the bakery as it will be then (src/systems/gods.js).
         */
        switchPassing() {
            return state.mode === 'combo' && !!game.Has(SWITCH_ON);
        },
        /** What would be done now, without doing it: for the console and the tests. */
        plan() {
            const buffs = runningBuffs();
            return { sale: saleNow(buffs), switch: state.plan };
        },
        report() {
            return {
                cycles: state.cycles,
                windows: state.windows,
                units: state.units,
                lost: state.lost,
                switchedOn: state.switchedOn,
                switchedOff: state.switchedOff,
                spentOnSwitch: state.spentOnSwitch,
                mode: state.mode,
                hold: this.hold(),
                last: state.last,
            };
        },
    };
}
