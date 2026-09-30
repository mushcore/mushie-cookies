// The one place that reads the legacy globals the new systems still need: the settings object
// `FrozenCookies`, the blacklist presets, and the extra-reserve helpers.
import { createBuyer } from '../systems/buyer.js';
import { createAscension } from '../systems/ascension.js';
import { createLumps } from '../systems/lumps.js';
import { createGrimoire } from '../systems/grimoire.js';
import { createGarden } from '../systems/garden.js';
import { createMarket } from '../systems/market.js';
import { createGods } from '../systems/gods.js';

const CHAIN_REACH = 15;

/** Which buildings and upgrades the settings exclude, read live. */
export function policyFrom(game, settings, presets, prerequisites) {
    const preset = (presets && presets[settings.blacklist]) || { upgrades: [], buildings: [] };
    const excludedUpgrades = preset.upgrades === true ? 'all' : new Set(preset.upgrades);
    if (preset.buildings === true) return { excludedBuildings: 'all', excludedUpgrades, chainReach: CHAIN_REACH, prerequisites };

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
    return { excludedBuildings, excludedUpgrades, chainReach: CHAIN_REACH, prerequisites, limits };
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
export function startSystems({ game, loop, legacy, log }) {
    const settings = legacy.settings;
    const buyer = createBuyer({
        game,
        settings,
        loop,
        log,
        policy: () => policyFrom(game, settings, legacy.blacklistPresets, legacy.prerequisites),
        extraReserve: () => extraReserveFrom(settings, legacy),
    });
    const ascension = createAscension({
        game,
        settings,
        loop,
        log,
        buyer,
        extras: () => legacy.wrinklerValue() + legacy.chocolateValue(),
        prepare: () => legacy.prepareForAscension(),
    });
    const lumps = createLumps({ game, settings, loop, log });
    const grimoire = createGrimoire({ game, settings, loop, log, buyer });
    const garden = createGarden({ game, settings, loop, log, reserve: () => buyer.reserve() });
    const market = createMarket({ game, settings, loop, log, reserve: () => buyer.reserve() });
    const gods = createGods({ game, settings, loop, log, buyer });
    return { buyer, ascension, lumps, grimoire, garden, market, gods };
}
