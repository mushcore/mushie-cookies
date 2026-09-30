// The Autopilot: one switch (off by default, like every option) that automates everything. It
// sets every playing option to the configuration that plays best with no one at the keyboard.
// Display options (number format, infobox, frame rate, logging) are the player's and are never
// touched.

/** Setting name → value under Autopilot. */
export const AUTOPILOT = Object.freeze({
    // Clicking. The game ignores a click less than 20 ms after the last one it counted
    // (main.js Game.ClickCookie). On real, jittery timers a 50-a-second clicker loses every click
    // that lands at 19 ms; calling at 250 a second (4 ms, the browser's timer floor) lands each one
    // within a few ms of the window opening. Frenzy clicking adds nothing beyond that.
    autoClick: 1,
    cookieClickSpeed: 250,
    autoFrenzy: 0,
    autoGC: 1,
    autoReindeer: 1,
    autoFortune: 1,

    // Buying and ascending: the measured buyer and ascension systems.
    autoBuy: 1,
    autoBlacklistOff: 0,
    blacklist: 0,
    mineLimit: 0,
    factoryLimit: 0,
    autoBulk: 0,
    autoAscendToggle: 1,

    // Wrinklers.
    autoWrinkler: 1,
    shinyPop: 0,

    // Sugar lumps: harvest when ripe, spend with the lump system. Rigidel and aura swaps around
    // the harvest would fight the pantheon and aura system, so they stay off.
    autoSL: 1,
    dragonsCurve: 0,
    sugarBakingGuard: 1,
    autoLumps: 1,

    // Minigames: the new systems, and every inherited system that acts on the same thing off.
    autoFate: 1,
    autoGarden: 1,
    autoMarket: 1,
    autoGods: 1,
    autoCasting: 0,
    towerLimit: 0,
    autoFTHOFCombo: 0,
    auto100ConsistencyCombo: 0,
    autoSugarFrenzy: 0,
    autoWorshipToggle: 0,
    autoWorship0: 0,
    autoWorship1: 0,
    autoWorship2: 0,
    autoCyclius: 0,
    autoDragonToggle: 0,
    autoDragonAura0: 0,
    autoDragonAura1: 0,
    autoDragonOrbs: 0,
    orbLimit: 0,

    // Combos the new systems do not model yet stay off until measured.
    autoGS: 0,
    autoGodzamok: 0,
    autoLoan: 0,
    autoBank: 0,
    autoBroker: 0,

    // Dragon. The inherited petting reseeds the game's generator every second, so it stays off
    // until the dragon system pets with a private forecast.
    autoDragon: 1,
    petDragon: 0,

    // Seasons and Santa: the season planner, the only owner of the season.
    autoSeasons: 1,

    // Banks the inherited code held back for manual combos.
    holdManBank: 0,
    holdSEBank: 0,
    setHarvestBankPlant: 0,
    setHarvestBankType: 0, // only read when a harvest bank plant is chosen
    simulatedGCPercent: 1,
});

/** Sets every Autopilot value on `settings`; returns the names that changed. */
export function applyAutopilot(settings) {
    const changed = [];
    for (const name of Object.keys(AUTOPILOT)) {
        if (settings[name] !== AUTOPILOT[name]) {
            settings[name] = AUTOPILOT[name];
            changed.push(name);
        }
    }
    return changed;
}

/** True when changing `name` by hand means the player is taking over from the Autopilot. */
export function isAutopilotSetting(name) {
    return Object.prototype.hasOwnProperty.call(AUTOPILOT, name);
}
