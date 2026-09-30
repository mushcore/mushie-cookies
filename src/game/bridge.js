// The one place that reads the legacy globals the new systems still need: the settings object
// `FrozenCookies`, the blacklist presets, and the extra-reserve helpers.
import { createBuyer } from '../systems/buyer.js';
import { createAscension } from '../systems/ascension.js';
import { createLumps } from '../systems/lumps.js';
import { createGrimoire } from '../systems/grimoire.js';
import { createGarden } from '../systems/garden.js';
import { createMarket } from '../systems/market.js';
import { createGods } from '../systems/gods.js';
import { createCombos } from '../systems/combos.js';
import { createHeavenly } from '../systems/heavenly.js';
import { createDragon } from '../systems/dragon.js';
import { createShimmers } from '../systems/shimmers.js';
import { createClicker } from '../systems/clicker.js';
import { createWrinklers } from '../systems/wrinklers.js';
import { createSeasons } from '../systems/seasons.js';

const CHAIN_REACH = 15;

/** Which buildings and upgrades the settings exclude, and whether wrinklers are popped, read live. */
export function policyFrom(game, settings, presets, prerequisites) {
    const preset = (presets && presets[settings.blacklist]) || { upgrades: [], buildings: [] };
    const excludedUpgrades = preset.upgrades === true ? 'all' : new Set(preset.upgrades);
    // A purchase that pops wrinklers (the elder plan, src/game/candidates.js) waits while the
    // wrinkler system leaves them be.
    const popsWrinklers = Number(settings.autoWrinkler) > 0;
    if (preset.buildings === true) return { excludedBuildings: 'all', excludedUpgrades, chainReach: CHAIN_REACH, prerequisites, popsWrinklers };

    const excludedBuildings = new Set(preset.buildings);
    // limits: building id -> the most the settings allow. At the limit the building is excluded;
    // below it, bulk buys and chains are capped to the room left.
    const limits = {};
    const limit = (name, max) => {
        const id = game.Objects[name].id;
        limits[id] = Math.min(limits[id] === undefined ? Infinity : limits[id], max);
        if (game.Objects[name].amount >= limits[id]) excludedBuildings.add(id);
    };
    const grimoire = game.Objects['Wizard tower'].minigame;
    if (grimoire && settings.autoCasting == 5) limit('You', 399);
    if (grimoire && settings.towerLimit && grimoire.magicM >= settings.manaMax) excludedBuildings.add(game.Objects['Wizard tower'].id);
    if (settings.mineLimit) limit('Mine', settings.mineMax);
    if (settings.factoryLimit) limit('Factory', settings.factoryMax);
    if (settings.autoDragonOrbs && settings.orbLimit) limit('You', settings.orbMax);
    return { excludedBuildings, excludedUpgrades, chainReach: CHAIN_REACH, prerequisites, limits, popsWrinklers };
}

/** Bank the settings ask to hold beyond the golden cookie reserve, from the legacy helpers. */
export function extraReserveFrom(settings, helpers) {
    let reserve = 0;
    if (settings.autoCasting == 5 || settings.holdSEBank) reserve = Math.max(reserve, helpers.edificeBank());
    if (settings.setHarvestBankPlant) reserve = Math.max(reserve, helpers.harvestBank());
    if (settings.holdManBank) reserve = Math.max(reserve, helpers.manualBank());
    return reserve;
}

/** Starts the new systems once the legacy code has started. Returns them by name. */
export function startSystems({ game, loop, legacy, log, guard }) {
    const settings = legacy.settings;
    // First on the loop: a shimmer is popped in the frame it appears, before any system reads the
    // screen (see src/systems/shimmers.js).
    const shimmers = createShimmers({
        game,
        settings,
        loop,
        log,
        // Asked from the loop only, once `ascension` below exists.
        ascensionImminent: () => {
            if (settings.autoAscendToggle != 1) return false;
            // Only a verdict on this run: the ended run's says "ascend" until the ascension's next
            // tick after a reincarnation, as lumps.js's frenzy check allows for too.
            const verdict = ascension.currentVerdict();
            return ascension.phase() !== 'playing' || !!(verdict && verdict.ascend);
        },
    });
    const clicker = createClicker({ game, settings, loop, log, guard });
    let lumps = null; // created below; the buyer keeps the bank a golden lump is timed to pay on
    const collectLumpNow = () => lumps && lumps.collectBeforeAscension();
    const collectLump = guard ? guard('lumpHarvest', collectLumpNow) : collectLumpNow;
    let market = null; // created below; it offers the bank office and brokers to the buyer
    let combos = null; // created below; holds what the Golden switch needs while it is on for a combo
    const buyer = createBuyer({
        game,
        settings,
        loop,
        log,
        policy: () => policyFrom(game, settings, legacy.blacklistPresets, legacy.prerequisites),
        extraReserve: () => Math.max(extraReserveFrom(settings, legacy), lumps ? lumps.hold() : 0, combos ? combos.hold() : 0),
        extraCandidates: (policy) => (market ? market.candidates(policy) : []),
    });
    const wrinklers = createWrinklers({ game, settings, loop, log, buyer });
    const heavenly = createHeavenly({ game, settings, loop });
    const ascension = createAscension({
        game,
        settings,
        loop,
        log,
        buyer,
        extras: () => wrinklers.held() + legacy.chocolateValue(),
        collect: () => wrinklers.collect(),
        heavenly,
        // The lump system collects a golden lump inside the routine, before the buildings are
        // sold (see fc_main.js prepareForAscension); a failure there must not stop the sales.
        prepare: () => legacy.prepareForAscension(collectLump),
    });
    lumps = createLumps({
        game,
        settings,
        loop,
        log,
        buyer,
        // The ascension's growth verdict times Sugar frenzy; while its verdict is not yet known the
        // growth reads as unknown, and with it off nothing ends the run.
        run: () => (settings.autoAscendToggle == 1 ? ascension.verdict() || { instantRate: Infinity, averageRate: 0, rated: false } : null),
        // From the wrinkler pop on: the ascension collects a golden lump itself from here.
        ascending: () => settings.autoAscendToggle == 1 && ascension.phase() !== 'playing',
    });
    const grimoire = createGrimoire({ game, settings, loop, log });
    const garden = createGarden({ game, settings, loop, log, reserve: () => buyer.reserve() });
    market = createMarket({ game, settings, loop, log, reserve: () => buyer.reserve(), buyer, ascension });
    // The dragon trains before the gods pick auras; `dragon` tells them when a level is gained.
    // The dragon's horizon is the run as played, on the ascension's clock.
    const dragon = createDragon({ game, settings, loop, log, buyer, reserve: () => buyer.reserve(), runSeconds: () => ascension.runSeconds() });
    // The gods are judged with the Golden switch as it will be once a click buff it is on for is over.
    const gods = createGods({ game, settings, loop, log, buyer, dragon, passingSwitch: () => (combos ? combos.switchPassing() : false) });
    // Halloween cookies and eggs drop from popped wrinklers: the season system asks the wrinkler
    // system to hunt them, and the wrinkler system weighs each hunt against what it forfeits.
    const seasons = createSeasons({ game, settings, loop, log, buyer, wrinklers });
    // Leaving the Golden switch on for good is judged over the run's expected length, as played.
    combos = createCombos({ game, settings, loop, log, buyer, runSeconds: () => ascension.runSeconds() });
    return { buyer, ascension, lumps, grimoire, garden, market, gods, dragon, shimmers, clicker, wrinklers, heavenly, seasons, combos };
}
