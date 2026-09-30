// The one place that reads the legacy globals the new systems still need: the settings object
// `FrozenCookies`, the blacklist presets, and the extra-reserve helpers.
import { createBuyer } from '../systems/buyer.js';
import { createAscension } from '../systems/ascension.js';
import { createLumps } from '../systems/lumps.js';
import { createGrimoire } from '../systems/grimoire.js';

const CHAIN_REACH = 15;

/** Which buildings and upgrades the settings exclude, read live. */
export function policyFrom(game, settings, presets, prerequisites) {
    const preset = (presets && presets[settings.blacklist]) || { upgrades: [], buildings: [] };
    const excludedUpgrades = preset.upgrades === true ? 'all' : new Set(preset.upgrades);
    if (preset.buildings === true) return { excludedBuildings: 'all', excludedUpgrades, chainReach: CHAIN_REACH, prerequisites };

    const excludedBuildings = new Set(preset.buildings);
    const exclude = (name) => excludedBuildings.add(game.Objects[name].id);
    const grimoire = game.Objects['Wizard tower'].minigame;
    const you = game.Objects['You'];
    if (grimoire && settings.autoCasting == 5 && you.amount >= 399) exclude('You');
    if (grimoire && settings.towerLimit && grimoire.magicM >= settings.manaMax) exclude('Wizard tower');
    if (settings.mineLimit && game.Objects['Mine'].amount >= settings.mineMax) exclude('Mine');
    if (settings.factoryLimit && game.Objects['Factory'].amount >= settings.factoryMax) exclude('Factory');
    if (settings.autoDragonOrbs && settings.orbLimit && you.amount >= settings.orbMax) exclude('You');
    return { excludedBuildings, excludedUpgrades, chainReach: CHAIN_REACH, prerequisites };
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
    });
    const lumps = createLumps({ game, settings, loop, log });
    const grimoire = createGrimoire({ game, settings, loop, log });
    return { buyer, ascension, lumps, grimoire };
}
