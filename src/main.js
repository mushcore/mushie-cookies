/* global __MUSHIE_VERSION__, __MUSHIE_LEGACY__ */
import { createGuard } from './core/guard.js';
import { createLoop } from './core/loop.js';
import { register } from './game/boot.js';
import { startSystems } from './game/bridge.js';

export { simulate, simulateEach, takeSnapshot, diffSnapshots } from './core/sim.js';
export { readState, measureCandidates, clicksPerSecond } from './game/measure.js';
import { readState as readStateNow } from './game/measure.js';
import { estimateIncome as estimateNow } from './core/income.js';

/** Income now, with the wrinkler count or the bank overridden: for the legacy popping logic. */
export function incomeWith({ wrinklerCount, bank } = {}) {
    const state = readStateNow(window.Game, window.FrozenCookies);
    if (wrinklerCount !== undefined && wrinklerCount !== null) state.wrinklers = { ...state.wrinklers, count: wrinklerCount };
    if (bank !== undefined && bank !== null) state.bank = bank;
    return estimateNow(state).total;
}
export { awardForBuildings, awardForUpgrades } from './game/awards.js';
export { listCandidates, NEVER_BUY } from './game/candidates.js';
export { estimateIncome } from './core/income.js';
export { rankCandidates, chooseReserve, decide } from './core/buyer.js';
export { shouldAscend } from './core/ascension.js';
export {
    KINDS as BUFF_KINDS,
    BUFF_TYPES,
    classifyBuff,
    classifyBuffs,
    cpsMultOf,
    clickMultOf,
    incomeSpikeRunning,
    longestSpikeSecondsLeft,
    unbuffedFactors,
    worthFinishing,
} from './core/buffs.js';
export { nextLevelUp } from './core/lumps.js';
export { forecastFate, forecastMany } from './game/fate.js';
export { outcomeValue, decideCast } from './core/grimoire.js';
export { optimizeLayout } from './core/garden.js';
export { tickMarket, restingValue, tradeDecision } from './core/market.js';
export { levelCost, rebuyCost, trainableChain, chooseTarget, magicCap } from './core/dragon.js';
export { gardenOf, plotTiles, chanceFunction, findRecipe, findRecipes } from './game/garden.js';
export { planChips, planTree, rankSlots } from './core/heavenly.js';
export { AUTOPILOT, applyAutopilot, isAutopilotSetting } from './core/autopilot.js';
export { planSeason } from './core/seasons.js';
export { planHeavenly, slotCandidates, fillPermanentSlots, rankPermanentSlots, assignPermanentSlots } from './game/prestige.js';
export { payoutOf as wrinklerPayout, heldValue as wrinklerHeld } from './game/wrinklers.js';

export const version = __MUSHIE_VERSION__;

const report = (message) => console.error(`[Mushie Cookies] ${message}`);
const log = (message) => console.log(`[Mushie Cookies] ${message}`);

/** The new systems, by name, once the mod has started. */
export let buyer = null;
export let ascension = null;
export let lumps = null;
export let grimoire = null;
export let garden = null;
export let market = null;
export let gods = null;
export let heavenly = null;
export let dragon = null;
export let shimmers = null;
export let clicker = null;
export let wrinklers = null;
export let seasons = null;

const MINUTE = 60 * 30; // logic frames: Game.fps is 30 (main.js:1971)
const RETRY_FRAMES = [1 * MINUTE, 5 * MINUTE, 30 * MINUTE];

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const minutes = (frames) => `${frames / MINUTE} minute${frames === MINUTE ? '' : 's'}`;

/**
 * The one notice a player sees when a system is switched off: the console, where every failure is
 * reported, is out of sight on Steam. Game.Notify with no `quick` stays until closed
 * (main.js:6260-6269, 6164-6173), for a player who comes back to an unattended game.
 */
function noticeSwitchedOff(name, error, retryFrames) {
    const game = typeof window !== 'undefined' ? window.Game : null;
    if (!game || typeof game.Notify !== 'function') return;
    const next = retryFrames.length
        ? `It will be tried again after ${retryFrames.map(minutes).join(', then ')} of play, and left off if it keeps failing.`
        : 'It stays off until the game is reloaded.';
    game.Notify('Mushie Cookies: ' + escapeHtml(name) + ' switched off', 'It failed repeatedly: ' + escapeHtml(error.message) + '.<br>' + next, '');
}

// `loop` is read when a failure happens, by then long defined: the guard's clock is the frame the
// loop last ran, which stops while the machine sleeps, so a back-off is always play time.
const guards = createGuard({
    maxFailures: 5,
    retryFrames: RETRY_FRAMES,
    // An hour up after a try: the fault is taken as over, and a new one starts at the first back-off.
    forgiveFrames: 60 * MINUTE,
    clock: () => loop.frame(),
    onError(name, error, disabled) {
        report(`${name} failed: ${error.message}` + (disabled ? ' (switched off after repeated failures)' : ''));
    },
    onSwitchedOff: noticeSwitchedOff,
});

export const guard = guards.guard;
export const status = guards.status;
export const revive = guards.revive;
export const loop = createLoop(guards);

// The legacy files are plain global scripts. They are carried as text and evaluated as one
// script element, which gives their declarations the global scope they were written for.
const runtime = {
    evaluate() {
        const script = document.createElement('script');
        script.text = __MUSHIE_LEGACY__ + '\n//# sourceURL=mushie-cookies-legacy.js';
        document.head.appendChild(script);
        script.remove();
        if (typeof window.legacyStart !== 'function') throw new Error('legacy code did not evaluate');
    },
    start(data) {
        window.legacyStart(data);
        const systems = startSystems({
            game: window.Game,
            loop,
            log,
            guard,
            legacy: {
                settings: window.FrozenCookies,
                blacklistPresets: window.blacklist,
                prerequisites: window.upgradeJson,
                edificeBank: () => window.edificeBank(),
                harvestBank: () => window.harvestBank(),
                manualBank: () => window.manualBank(),
                wrinklerValue: () => window.wrinklerValue(),
                prepareForAscension: (beforeSelling) => window.prepareForAscension(beforeSelling),
                chocolateValue: () => window.chocolateValue(),
            },
        });
        buyer = systems.buyer;
        ascension = systems.ascension;
        lumps = systems.lumps;
        grimoire = systems.grimoire;
        garden = systems.garden;
        market = systems.market;
        gods = systems.gods;
        heavenly = systems.heavenly;
        dragon = systems.dragon;
        shimmers = systems.shimmers;
        clicker = systems.clicker;
        wrinklers = systems.wrinklers;
        seasons = systems.seasons;
    },
    save: () => window.saveFCData(),
    load: (data) => window.setOverrides(data),
};

const booted =
    typeof window !== 'undefined' && window.Game && typeof window.Game.registerMod === 'function'
        ? register(window.Game, {
              id: 'mushie_cookies',
              runtime,
              loop,
              onError: (error, what) => report(`${what} failed: ${error.message}`),
          })
        : null;

export const started = () => !!booted && booted.started();
