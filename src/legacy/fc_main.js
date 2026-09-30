// Add polyfills:
(function (global) {
    var global_isFinite = global.isFinite;
    Object.defineProperty(Number, "isFinite", {
        value: function isFinite(value) {
            return typeof value === "number" && global_isFinite(value);
        },
        configurable: true,
        enumerable: false,
        writable: true,
    });
})(this);

// Registers the hooks the legacy code relies on and starts it.
// Called once by the boot code, after the game has loaded its save.
function legacyStart(saveData) {
    setOverrides(saveData);
    Game.registerHook("draw", MushieCookies.guard("legacy:drawInfobox", function () {
        drawInfobox();
    }));
    Game.registerHook("reincarnate", MushieCookies.guard("legacy:reincarnate", function () {
        // called when the player has reincarnated after an ascension
        if (!FrozenCookies.autoBulk) return;
        if (FrozenCookies.autoBulk == 1) {
            document.getElementById("storeBulk10").click();
        }
        if (FrozenCookies.autoBulk == 2) {
            document.getElementById("storeBulk100").click();
        }
    }));
    Game.registerHook("ticker", MushieCookies.guard("legacy:ticker", function () {
        // News ticker messages, split between normal and Business Day (April Fools)
        // Todo: add messages for garden and stock market minigames
        if (
            Game.cookiesEarned >= 1000 &&
            Math.random() < 0.3 &&
            Game.season != "fools"
        ) {
            return [
                "News : debate about whether using Mushie Cookies constitutes cheating continues to rage. Violence escalating.",
                "News : Supreme Court rules Mushie Cookies not unauthorized cheating after all.",
                "News : Mushie Cookies described as 'fun, guys'. Pun-haters heard groaning.",
                "News : Scientists baffled as cookies are now measured in 'efficiency' instead of calories.",
                "News : Cookie clickers debate: is it cheating if the bot is more efficient than you?",
            ];
        }
        if (
            bestBank(nextChainedPurchase().efficiency).cost > 0 &&
            Math.random() < 0.3 &&
            Game.season != "fools"
        ) {
            return [
                "You wonder if those " +
                    Beautify(
                        bestBank(nextChainedPurchase().efficiency).cost
                    ) +
                    " banked cookies are still fresh.",
            ];
        }
        if (M && Game.season != "fools") {
            return [
                "News : Local wizards claim they can predict the next golden cookie, while munching on Mushie Cookies.",
            ];
        }
        if (T && Game.season != "fools") {
            return [
                "News : Cookie gods issue statement: 'Stop swapping us so much, we're getting dizzy!'",
            ];
        }
        if (
            nextPurchase().cost > 0 &&
            Math.random() < 0.3 &&
            Game.season != "fools"
        ) {
            return [
                "You should buy " +
                    nextPurchase().purchase.name +
                    " next.",
            ];
        }
        if (Math.random() < 0.3 && Game.season == "fools") {
            return [
                "Investigation into potential cheating with Mushie Cookies is blocked by your lawyers.",
                "Your Mushie Cookies are now available in stores everywhere.",
                "Cookie banks report record deposits, but nobody knows what a 'Lucky Bank' actually is.",
                "Cookie banks now offering 'Harvest Bank' accounts with 0% interest and infinite cookies.",
                "Cookie economy destabilized by mysterious entity known only as 'Mushie Cookies'.",
                "Cookie market analysts confused by sudden spike in 'Purchase Efficiency'.",
            ];
        }
        if (
            bestBank(nextChainedPurchase().efficiency).cost > 0 &&
            Math.random() < 0.3 &&
            Game.season == "fools"
        ) {
            return [
                "You have " +
                    Beautify(
                        bestBank(nextChainedPurchase().efficiency)
                            .cost * 0.08
                    ) +
                    " cookie dollars just sitting in your wallet.",
            ];
        }
        if (M && Game.season == "fools") {
            return [
                "Analyst report: Current bussiness relation between Memes and spells is 'complicated'.",
            ];
        }
        if (T && Game.season == "fools") {
            return [
                "Likes and shares of Cookie Gods' social media accounts are at an all-time high.",
            ];
        }
        if (
            nextPurchase().cost > 0 &&
            nextPurchase().type != "building" &&
            Math.random() < 0.3 &&
            Game.season == "fools"
        ) {
            return [
                "Your next investment: " +
                    nextPurchase().purchase.name +
                    ".",
            ];
        }
        if (
            nextPurchase().cost > 0 &&
            nextPurchase().type == "building" &&
            Math.random() < 0.3 &&
            Game.season == "fools"
        ) {
            return [
                "Your next investment: " +
                    Game.foolObjects[nextPurchase().purchase.name]
                        .name +
                    ".",
            ];
        }
    }));
    Game.registerHook("reset", MushieCookies.guard("legacy:reset", function (hard) {
        // the parameter will be true if it's a hard reset, and false (not passed) if it's just an ascension
        if (hard && MushieCookies.buyer) MushieCookies.buyer.invalidate();
    }));
    MushieCookies.loop.add(
        "infobox",
        function () {
            updateTimers();
        },
        {
            everyFrames: 8,
            enabled: function () {
                return !!FrozenCookies.fancyui;
            },
        }
    );
    // The minigames load after this point, and each minigame script ends by setting the
    // global M to 0; the handles and the Grimoire tooltip are brought up to date every frame.
    MushieCookies.loop.add("legacy:minigames", minigameCheckAction);
    installFCMenu();
    logEvent(
        "Load",
        "Mushie Cookies v " +
            FrozenCookies.branch +
            "." +
            FrozenCookies.version +
            " started."
    );
}

function setOverrides(gameSaveData) {
    // load settings and initialize variables
    // If gameSaveData wasn't passed to this function, it means that there was nothing for this mod in the game save when the mod was loaded
    // In that case, set the "loadedData" var to an empty object. When the loadFCData() function runs and finds no data from the game save,
    // it pulls data from local storage or sets default values
    if (gameSaveData) {
        FrozenCookies.loadedData = JSON.parse(gameSaveData);
    } else {
        FrozenCookies.loadedData = {};
    }
    loadFCData();
    if (FrozenCookies.autopilot) MushieCookies.applyAutopilot(FrozenCookies);
    FrozenCookies.frequency = 100;


    // Force redraw every 10 purchases
    FrozenCookies.autobuyCount = 0;

    // Set default values for calculations
    FrozenCookies.hc_gain = 0;
    FrozenCookies.hc_gain_time = Date.now();
    FrozenCookies.last_gc_state =
        (Game.hasBuff("Frenzy") ? Game.buffs["Frenzy"].multCpS : 1) *
        clickBuffBonus();
    FrozenCookies.last_gc_time = Date.now();

    // Allow autoCookie to run
    FrozenCookies.processing = false;


    // Smart tracking details

    if (!blacklist[FrozenCookies.blacklist]) FrozenCookies.blacklist = 0;

    // Set `App`, on older version of CC it's not set to anything, so default it to `undefined`
    if (!window.App) window.App = undefined;

    // Game.sayTime is left to the game: its callers rely on `detail` and on '' for no time left.
    // The mod's own labels use timeDisplay.
    Beautify = fcBeautify;
    if (typeof Game.tooltip.oldDraw != "function") {
        Game.tooltip.oldDraw = Game.tooltip.draw;
        Game.tooltip.draw = fcDraw;
    }
    if (typeof Game.oldReset != "function") {
        Game.oldReset = Game.Reset;
        Game.Reset = fcReset;
    }
    // Remove the following when turning on tooltip code
    nextPurchase(true);
    Game.RefreshStore();
    Game.RebuildUpgrades();
    beautifyUpgradesAndAchievements();


    function loadFCData() {
        // Set all cycleable preferences
        _.keys(FrozenCookies.preferenceValues).forEach(function (preference) {
            FrozenCookies[preference] = preferenceParse(
                preference,
                FrozenCookies.preferenceValues[preference].default
            );
        });
        // Separate because these are user-input values
        FrozenCookies.cookieClickSpeed = preferenceParse("cookieClickSpeed", 0);
        FrozenCookies.frenzyClickSpeed = preferenceParse("frenzyClickSpeed", 0);
        FrozenCookies.minCpSMult = preferenceParse("minCpSMult", 1);
        FrozenCookies.maxSpecials = preferenceParse("maxSpecials", 1);
        FrozenCookies.minLoanMult = preferenceParse("minLoanMult", 777);
        FrozenCookies.minASFMult = preferenceParse("minASFMult", 1);
        FrozenCookies.manBankMins = preferenceParse("manBankMins", 0);

        // building max values
        FrozenCookies.mineMax = preferenceParse("mineMax", 0);
        FrozenCookies.factoryMax = preferenceParse("factoryMax", 0);
        FrozenCookies.manaMax = preferenceParse("manaMax", 0);
        FrozenCookies.orbMax = preferenceParse("orbMax", 0);

        // "Autopop Wrinklers INSTANTLY" was removed: it kept 1x CpS where popping by value keeps
        // about 5x, and drop hunting belongs to the season hunt now.
        if (FrozenCookies.autoWrinkler > 1) FrozenCookies.autoWrinkler = 1;
        // Restore some possibly broken settings
        // Auto Rigidel (autoSL 2) is gone; a player who chose it still wants the harvest.
        if (FrozenCookies.autoSL == 2) FrozenCookies.autoSL = 1;
        if (
            !FrozenCookies.autoFTHOFCombo &&
            autoFTHOFComboAction.autobuyyes == 1
        ) {
            FrozenCookies.autoBuy = 1;
            autoFTHOFComboAction.autobuyyes = 0;
        }
        if (
            !FrozenCookies.auto100ConsistencyCombo &&
            auto100ConsistencyComboAction.autobuyyes == 1
        ) {
            FrozenCookies.autoBuy = 1;
            auto100ConsistencyComboAction.autobuyyes = 0;
        }
        if (
            !FrozenCookies.auto100ConsistencyCombo &&
            auto100ConsistencyComboAction.autogcyes == 1
        ) {
            FrozenCookies.autoGC = 1;
            auto100ConsistencyComboAction.autogcyes = 0;
        }
        if (
            !FrozenCookies.auto100ConsistencyCombo &&
            auto100ConsistencyComboAction.autogodyes == 1
        ) {
            FrozenCookies.autoGodzamok = 1;
            auto100ConsistencyComboAction.autogodyes = 0;
        }
        if (
            !FrozenCookies.auto100ConsistencyCombo &&
            auto100ConsistencyComboAction.autoworshipyes == 1
        ) {
            FrozenCookies.autoWorshipToggle = 1;
            auto100ConsistencyComboAction.autoworshipyes = 0;
        }
        if (
            !FrozenCookies.auto100ConsistencyCombo &&
            auto100ConsistencyComboAction.autodragonyes == 1
        ) {
            FrozenCookies.autoDragonToggle = 1;
            auto100ConsistencyComboAction.autodragonyes = 0;
        }

        // Get historical data
        FrozenCookies.frenzyTimes =
            JSON.parse(
                FrozenCookies.loadedData["frenzyTimes"] ||
                    localStorage.getItem("frenzyTimes")
            ) || {};
        //  FrozenCookies.non_gc_time = Number(FrozenCookies.loadedData['nonFrenzyTime']) || Number(localStorage.getItem('nonFrenzyTime')) || 0;
        //  FrozenCookies.gc_time = Number(FrozenCookies.loadedData['frenzyTime']) || Number(localStorage.getItem('frenzyTime')) || 0;;
        FrozenCookies.lastHCAmount = preferenceParse("lastHCAmount", 0);
        FrozenCookies.lastHCTime = preferenceParse("lastHCTime", 0);
        FrozenCookies.prevLastHCTime = preferenceParse("prevLastHCTime", 0);
        FrozenCookies.maxHCPercent = preferenceParse("maxHCPercent", 0);
        if (Object.keys(FrozenCookies.loadedData).length > 0) {
            logEvent(
                "Load",
                "Restored Frozen Cookies settings from previous save"
            );
        }
    }

    function preferenceParse(setting, defaultVal) {
        var value = defaultVal;
        if (setting in FrozenCookies.loadedData) {
            // first look in the data from the game save
            value = FrozenCookies.loadedData[setting];
        } else if (localStorage.getItem(setting)) {
            // if the setting isn't there, check localStorage
            value = localStorage.getItem(setting);
        }
        return Number(value); // if not overridden by game save or localStorage, defaultVal is returned
    }
    FCStart();
}

function decodeHtml(html) {
    // used to convert text with an HTML entity (like "&eacute;") into readable text
    var txt = document.createElement("textarea");
    txt.innerHTML = html;
    return txt.value;
}

function fcDraw(from, text, origin) {
    if (typeof text == "string") {
        if (text.includes("Devastation")) {
            text = text.replace(
                /\+\d+\%/,
                "+" +
                    Math.round(
                        (Game.hasBuff("Devastation").multClick - 1) * 100
                    ) +
                    "%"
            );
        }
    }
    Game.tooltip.oldDraw(from, text, origin);
}

function fcReset(hard) {
    // Nothing is collected here. The game calls this from Reincarnate, on the ascension screen,
    // where a player can neither sell nor buy, after the chips are granted (main.js:4094, 4125);
    // popped wrinklers could no longer pay (main.js:16165, 3532). The mod's own ascension collects
    // before Game.Ascend; an ascension the player starts is theirs.
    Game.oldReset(hard);
    FrozenCookies.frenzyTimes = {};
    FrozenCookies.last_gc_state =
        (Game.hasBuff("Frenzy") ? Game.buffs["Frenzy"].multCpS : 1) *
        clickBuffBonus();
    FrozenCookies.last_gc_time = Date.now();
    FrozenCookies.lastHCAmount = Game.HowMuchPrestige(
        Game.cookiesEarned + Game.cookiesReset + wrinklerValue()
    );
    FrozenCookies.lastHCTime = Date.now();
    FrozenCookies.maxHCPercent = 0;
    FrozenCookies.prevLastHCTime = Date.now();
    if (MushieCookies.buyer) MushieCookies.buyer.invalidate();
}

// The last steps of an ascension the mod starts, a tick after the wrinkler system has popped the
// wrinklers, so their payout is already in the bank (they pay on a later logic frame,
// main.js:14513). Only the ascension system calls this, before Game.Ascend.
//
// What each step gains, by the game's code:
// - Selling stock or buildings adds to the bank, not to the cookies baked this run
//   (minigameMarket.js:252-253, main.js:7873-7874), and the reset wipes the bank. The sales count
//   toward prestige only through the Chocolate egg, bought last, which earns 5% of the bank
//   (main.js:10398-10403). A stock sale can also earn a stock market achievement
//   (minigameMarket.js:246-250), which is kept; the market's stock and profit are zeroed at the
//   reset anyway (minigameMarket.js:774-779). Goods bought in the current market minute cannot be
//   sold (minigameMarket.js:243) and are lost with the reset.
// - Harvesting pays each plant's harvest effect (cookies through Game.Earn, which count) and
//   unlocks the seeds of mature plants; the reset clears the plot unharvested. It runs before the
//   buildings are sold, while the CpS that caps the cookie harvests is intact.
// - `beforeSelling` is the lump system's collection of a golden sugar lump, which pays
//   min(CpS x 86400, bank) through Game.Earn (main.js:4492-4496): here the bank holds the stock
//   sale and the CpS still has its buildings. Once they are sold (or one is sacrificed for Earth
//   Shatterer) the next frame recalculates CpS without them (main.js:7879, 16274), and the payout
//   with it. The egg, bought last, then earns 5% of that payout too.
function prepareForAscension(beforeSelling) {
    var market = Game.Objects["Bank"].minigame;
    if (market && market.goodsById) {
        for (let i = 0; i < market.goodsById.length; i++) market.sellGood(i, 10000);
    }
    var garden = Game.Objects["Farm"].minigame;
    if (garden) garden.harvestAll();
    if (beforeSelling) beforeSelling();
    if (
        Game.dragonLevel >= 5 + 4 &&
        !Game.hasAura("Earth Shatterer") &&
        Game.HasUnlocked("Chocolate egg") &&
        !Game.Has("Chocolate egg")
    ) {
        Game.specialTab = "dragon";
        Game.SetDragonAura(5, 0);
        Game.ConfirmPrompt();
        Game.ObjectsById.forEach(function (b) {
            b.sell(-1);
        });
        Game.Upgrades["Chocolate egg"].buy();
    } else if (
        Game.HasUnlocked("Chocolate egg") &&
        !Game.Has("Chocolate egg")
    ) {
        Game.ObjectsById.forEach(function (b) {
            b.sell(-1);
        });
        Game.Upgrades["Chocolate egg"].buy();
    }
}

function saveFCData() {
    var saveString = {};
    _.keys(FrozenCookies.preferenceValues).forEach(function (preference) {
        saveString[preference] = FrozenCookies[preference];
    });
    saveString.frenzyClickSpeed = FrozenCookies.frenzyClickSpeed;
    saveString.cookieClickSpeed = FrozenCookies.cookieClickSpeed;
    saveString.mineMax = FrozenCookies.mineMax;
    saveString.factoryMax = FrozenCookies.factoryMax;
    saveString.minCpSMult = FrozenCookies.minCpSMult;
    saveString.minLoanMult = FrozenCookies.minLoanMult;
    saveString.minASFMult = FrozenCookies.minASFMult;
    saveString.frenzyTimes = JSON.stringify(FrozenCookies.frenzyTimes);
    //  saveString.nonFrenzyTime = FrozenCookies.non_gc_time;
    //  saveString.frenzyTime = FrozenCookies.gc_time;
    saveString.lastHCAmount = FrozenCookies.lastHCAmount;
    saveString.maxHCPercent = FrozenCookies.maxHCPercent;
    saveString.lastHCTime = FrozenCookies.lastHCTime;
    saveString.manaMax = FrozenCookies.manaMax;
    saveString.maxSpecials = FrozenCookies.maxSpecials;
    saveString.orbMax = FrozenCookies.orbMax;
    saveString.manBankMins = FrozenCookies.manBankMins;
    saveString.prevLastHCTime = FrozenCookies.prevLastHCTime;
    saveString.saveVersion = FrozenCookies.version;
    return JSON.stringify(saveString);
}

function divCps(value, cps) {
    var result = 0;
    if (value) {
        if (cps) {
            result = value / cps;
        } else {
            result = Number.POSITIVE_INFINITY;
        }
    }
    return result;
}

function nextHC(tg) {
    var futureHC = Math.ceil(
        Game.HowMuchPrestige(Game.cookiesEarned + Game.cookiesReset)
    );
    var nextHC = Game.HowManyCookiesReset(futureHC);
    var toGo = nextHC - (Game.cookiesEarned + Game.cookiesReset);
    return tg ? toGo : timeDisplay(divCps(toGo, Game.cookiesPs));
}

// Shows text to copy in the game's own prompt, as the game's Export save does (main.js:2608).
// window.prompt throws on Steam, which used to leave Game.promptOn set with nothing on screen,
// so the next Enter confirmed whatever prompt had been shown last.
function copyToClipboard(text) {
    var escaped = String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    Game.Prompt(
        '<h3>Copy to clipboard</h3><div class="block">Press Ctrl+C to copy.</div>' +
            '<div class="block"><textarea id="textareaPrompt" style="width:100%;height:128px;" readonly>' +
            escaped +
            "</textarea></div>",
        ["Done"]
    );
    l("textareaPrompt").focus();
    l("textareaPrompt").select();
}

function getBuildingSpread() {
    return Game.ObjectsById.map(function (a) {
        return a.amount;
    }).join("/");
}

// todo: add bind for autoascend
// Press 'a' to toggle autoBuy.
// Press 'b' to show the building spread, ready to copy.
// Press 'c' to toggle auto-GC
// Press 'e' to show your export string, ready to copy
// Press 'r' to pop up the ascend window (the game's own confirmation)
// Press 's' to do a manual save
// Press 'w' to display a wrinkler-info window
document.addEventListener("keydown", function (event) {
    // Typing in a text box (a prompt, the bakery name) is not a shortcut.
    var target = event.target || {};
    if (target.tagName == "INPUT" || target.tagName == "TEXTAREA" || target.isContentEditable) return;
    if (!Game.promptOn && FrozenCookies.FCshortcuts) {
        if (event.keyCode == 65) setPreferenceDirect("autoBuy", FrozenCookies.autoBuy ? 0 : 1);
        if (event.keyCode == 66) copyToClipboard(getBuildingSpread());
        if (event.keyCode == 67) setPreferenceDirect("autoGC", FrozenCookies.autoGC ? 0 : 1);
        if (event.keyCode == 69) copyToClipboard(Game.WriteSave(true));
        // Game.Ascend() without an argument asks first; Game.Reset() would reset the run on the spot.
        if (event.keyCode == 82) Game.Ascend();
        if (event.keyCode == 83) Game.WriteSave();
        if (event.keyCode == 87) {
            Game.Notify(
                "Wrinkler Info",
                "Popping all wrinklers will give you " +
                    Beautify(wrinklerValue()) +
                    ' cookies. <input type="button" value="Click here to pop all wrinklers" onclick="Game.CollectWrinklers()"></input>',
                [19, 8],
                7
            );
        }
    }
});

function userInputPrompt(title, description, existingValue, callback) {
    Game.Prompt(
        `<h3>${title}</h3><div class="block" style="text-align:center;">${description}</div><div class="block"><input type="text" style="text-align:center;width:100%;" id="fcGenericInput" value="${existingValue}"/></div>`,
        ["Confirm", "Cancel"]
    );
    $("#promptOption0").click(() => {
        callback(l("fcGenericInput").value);
    });
    l("fcGenericInput").focus();
    l("fcGenericInput").select();
}

function validateNumber(value, minValue = null, maxValue = null) {
    if (typeof value == "undefined" || value == null) return false;
    const numericValue = Number(value);
    return (
        !isNaN(numericValue) &&
        (minValue == null || numericValue >= minValue) &&
        (maxValue == null || numericValue <= maxValue)
    );
}

function storeNumberCallback(base, min, max) {
    return (result) => {
        if (!validateNumber(result, min, max)) result = FrozenCookies[base];
        if (Number(result) !== FrozenCookies[base]) takeOverFromAutopilot(base);
        FrozenCookies[base] = Number(result);
        FCStart();
    };
}

function updateSpeed(base) {
    userInputPrompt(
        "Autoclicking!",
        "At most how many times per second should it click? The game counts at most 50; any value of 50 or more clicks as fast as the game counts.",
        FrozenCookies[base],
        storeNumberCallback(base, 0, 1000)
    );
}

function updateCpSMultMin(base) {
    userInputPrompt(
        "Autocasting!",
        'What CpS multiplier should trigger Auto Casting? (e.g. "7" will trigger during a Frenzy, "1" prevents triggering during a clot, etc.)',
        FrozenCookies[base],
        storeNumberCallback(base, 0)
    );
}

function updateManaMax(base) {
    userInputPrompt(
        "Mana Cap!",
        "Choose a maximum mana amount (100 max recommended)",
        FrozenCookies[base],
        storeNumberCallback(base, 0)
    );
}

function updateMaxSpecials(base) {
    userInputPrompt(
        "Harvest Bank!",
        "Set amount of stacked Building specials for Harvest Bank",
        FrozenCookies[base],
        storeNumberCallback(base, 0)
    );
}

function updateMineMax(base) {
    userInputPrompt(
        "Mine Cap!",
        "How many Mines should autoBuy stop at?",
        FrozenCookies[base],
        storeNumberCallback(base, 0)
    );
}

function updateFactoryMax(base) {
    userInputPrompt(
        "Factory Cap!",
        "How many Factories should autoBuy stop at?",
        FrozenCookies[base],
        storeNumberCallback(base, 0)
    );
}

function updateOrbMax(base) {
    userInputPrompt(
        "You Cap!",
        "How many Yous should autoBuy stop at?",
        FrozenCookies[base],
        storeNumberCallback(base, 0)
    );
}

function updateASFMultMin(base) {
    userInputPrompt(
        "Sugar Frenzy!",
        'What CpS multiplier should trigger buying the sugar frenzy (e.g. "100" will trigger for a decent early combo, "1000" will require a huge building buff combo, etc.)?',
        FrozenCookies[base],
        storeNumberCallback(base, 0)
    );
}

function updateManBank(base) {
    userInputPrompt(
        "Manual Bank!",
        'How many minutes of base CpS should be kept at all times?',
        FrozenCookies[base],
        storeNumberCallback(base, 0)
    );
}




// A player who changes a playing option by hand is taking over: the Autopilot steps aside.
function takeOverFromAutopilot(setting) {
    if (FrozenCookies.autopilot && MushieCookies.isAutopilotSetting(setting)) {
        FrozenCookies.autopilot = 0;
        logEvent("Autopilot", "Switched off: " + setting + " was changed by hand");
    }
}

function toggleFrozen(setting) {
    takeOverFromAutopilot(setting);
    if (!FrozenCookies[setting]) {
        FrozenCookies[setting] = 1;
    } else {
        FrozenCookies[setting] = 0;
    }
    FCStart();
}

var G = Game.Objects["Farm"].minigame; //Garden
var B = Game.Objects["Bank"].minigame; //Stock Market
var T = Game.Objects["Temple"].minigame; //Pantheon
var M = Game.Objects["Wizard tower"].minigame; //Grimoire

// Runs every frame on the mod's loop. A minigame loads after the save does (a timer, then a
// script: main.js:8622-8640), and every minigame script ends with `var M=0;`, overwriting the
// handle above; reading them afresh each frame keeps them current.
function minigameCheckAction() {
    G = Game.Objects["Farm"].minigame; //Garden
    B = Game.Objects["Bank"].minigame; //Stock Market
    T = Game.Objects["Temple"].minigame; //Pantheon
    M = Game.Objects["Wizard tower"].minigame; //Grimoire
    installFateTooltip();
}

function autoBlacklistOff() {
    switch (FrozenCookies.blacklist) {
        case 1:
            FrozenCookies.blacklist = Game.cookiesEarned >= 1000000 ? 0 : 1;
            break;
        case 2:
            FrozenCookies.blacklist = Game.cookiesEarned >= 1000000000 ? 0 : 2;
            break;
        case 3:
            FrozenCookies.blacklist =
                haveAll("halloween") && haveAll("easter") ? 0 : 3;
            break;
    }
}

function clickBuffBonus() {
    var ret = 1;
    for (var i in Game.buffs) {
        // Devastation, Godzamok's buff, is too variable
        if (
            typeof Game.buffs[i].multClick != "undefined" &&
            Game.buffs[i].name != "Devastation"
        ) {
            ret *= Game.buffs[i].multClick;
        }
    }
    return ret;
}

function cpsBonus() {
    var ret = 1;
    for (var i in Game.buffs) {
        if (typeof Game.buffs[i].multCpS != "undefined")
            ret *= Game.buffs[i].multCpS;
    }
    return ret;
}

function hasClickBuff() {
    return Game.hasBuff("Cursed finger") || clickBuffBonus() > 1;
}

function chocolateValue(bankAmount, earthShatter) {
    var value = 0;
    if (Game.HasUnlocked("Chocolate egg") && !Game.Has("Chocolate egg")) {
        bankAmount =
            bankAmount != null && bankAmount !== 0 ? bankAmount : Game.cookies;
        var sellRatio = 0.25;
        var highestBuilding = 0;
        if (earthShatter == null) {
            if (Game.hasAura("Earth Shatterer")) sellRatio = 0.5;
        } else if (earthShatter) {
            sellRatio = 0.5;
            if (!Game.hasAura("Earth Shatterer")) {
                for (var i in Game.Objects) {
                    if (Game.Objects[i].amount > 0)
                        highestBuilding = Game.Objects[i];
                }
            }
        }
        value =
            0.05 *
            (wrinklerValue() +
                bankAmount +
                Game.ObjectsById.reduce(function (s, b) {
                    return (
                        s +
                        cumulativeBuildingCost(
                            b.basePrice,
                            1,
                            (b == highestBuilding ? b.amount : b.amount + 1) -
                                b.free
                        ) *
                            sellRatio
                    );
                }, 0));
    }
    return value;
}

// What popping every wrinkler would pay, with every multiplier the game applies. Popping itself
// belongs to the wrinkler system (src/systems/wrinklers.js).
function wrinklerValue() {
    return MushieCookies.wrinklerHeld(Game);
}

function canCastSE() {
    if (M && M.magicM >= 80 && Game.Objects["You"].amount > 0) return 1;
    return 0;
}

function manualBank() {
    return baseCps() * 60 * FrozenCookies.manBankMins;
}

function edificeBank() {
    if (!canCastSE()) return 0;
    var cmCost = Game.Objects["You"].price;
    return Game.hasBuff("everything must go")
        ? (cmCost * (100 / 95)) / 2
        : cmCost / 2;
}

function harvestBank() {
    if (!FrozenCookies.setHarvestBankPlant) return 0;

    FrozenCookies.harvestMinutes = 0;
    FrozenCookies.harvestMaxPercent = 0;
    FrozenCookies.harvestFrenzy = 1;
    FrozenCookies.harvestBuilding = 1;
    FrozenCookies.harvestPlant = "";

    if (
        FrozenCookies.setHarvestBankType == 1 ||
        FrozenCookies.setHarvestBankType == 3
    )
        FrozenCookies.harvestFrenzy = 7;

    if (
        FrozenCookies.setHarvestBankType == 2 ||
        FrozenCookies.setHarvestBankType == 3
    ) {
        var harvestBuildingArray = [
            Game.Objects["Cursor"].amount,
            Game.Objects["Grandma"].amount,
            Game.Objects["Farm"].amount,
            Game.Objects["Mine"].amount,
            Game.Objects["Factory"].amount,
            Game.Objects["Bank"].amount,
            Game.Objects["Temple"].amount,
            Game.Objects["Wizard tower"].amount,
            Game.Objects["Shipment"].amount,
            Game.Objects["Alchemy lab"].amount,
            Game.Objects["Portal"].amount,
            Game.Objects["Time machine"].amount,
            Game.Objects["Antimatter condenser"].amount,
            Game.Objects["Prism"].amount,
            Game.Objects["Chancemaker"].amount,
            Game.Objects["Fractal engine"].amount,
            Game.Objects["Javascript console"].amount,
            Game.Objects["Idleverse"].amount,
            Game.Objects["Cortex baker"].amount,
            Game.Objects["You"].amount,
        ];
        harvestBuildingArray.sort(function (a, b) {
            return b - a;
        });

        for (
            var buildingLoop = 0;
            buildingLoop < FrozenCookies.maxSpecials;
            buildingLoop++
        ) {
            FrozenCookies.harvestBuilding *= harvestBuildingArray[buildingLoop];
        }
    }

    switch (FrozenCookies.setHarvestBankPlant) {
        case 1:
            FrozenCookies.harvestPlant = "Bakeberry";
            FrozenCookies.harvestMinutes = 30;
            FrozenCookies.harvestMaxPercent = 0.03;
            break;

        case 2:
            FrozenCookies.harvestPlant = "Chocoroot";
            FrozenCookies.harvestMinutes = 3;
            FrozenCookies.harvestMaxPercent = 0.03;
            break;

        case 3:
            FrozenCookies.harvestPlant = "White Chocoroot";
            FrozenCookies.harvestMinutes = 3;
            FrozenCookies.harvestMaxPercent = 0.03;
            break;

        case 4:
            FrozenCookies.harvestPlant = "Queenbeet";
            FrozenCookies.harvestMinutes = 60;
            FrozenCookies.harvestMaxPercent = 0.04;
            break;

        case 5:
            FrozenCookies.harvestPlant = "Duketater";
            FrozenCookies.harvestMinutes = 120;
            FrozenCookies.harvestMaxPercent = 0.08;
            break;

        case 6:
            FrozenCookies.harvestPlant = "Crumbspore";
            FrozenCookies.harvestMinutes = 1;
            FrozenCookies.harvestMaxPercent = 0.01;
            break;

        case 7:
            FrozenCookies.harvestPlant = "Doughshroom";
            FrozenCookies.harvestMinutes = 5;
            FrozenCookies.harvestMaxPercent = 0.03;
            break;
    }

    if (!FrozenCookies.maxSpecials) FrozenCookies.maxSpecials = 1;

    return (
        (baseCps() *
            60 *
            FrozenCookies.harvestMinutes *
            FrozenCookies.harvestFrenzy *
            FrozenCookies.harvestBuilding) /
        Math.pow(10, FrozenCookies.maxSpecials) /
        FrozenCookies.harvestMaxPercent
    );
}

function haveAll(holiday) {
    return _.every(holidayCookies[holiday], function (id) {
        return Game.UpgradesById[id].unlocked;
    });
}

function defaultPurchase() {
    return {
        id: 0,
        efficiency: Infinity,
        delta_cps: 0,
        base_delta_cps: 0,
        cost: Infinity,
        type: "other",
        purchase: {
            id: 0,
            name: "No valid purchases!",
            buy: function () {},
            getCost: function () {
                return Infinity;
            },
        },
    };
}

// What buildings number startingNumber..endingNumber of a type cost in total, at today's discounts.
function cumulativeBuildingCost(basePrice, startingNumber, endingNumber) {
    var undiscounted =
        (basePrice *
            (Math.pow(Game.priceIncrease, endingNumber) -
                Math.pow(Game.priceIncrease, startingNumber))) /
        (Game.priceIncrease - 1);
    var sample = Game.ObjectsById[0];
    var discount = Game.modifyBuildingPrice(sample, 1);
    return undiscounted * discount;
}

function logEvent(event, text, popup) {
    var time = "[" + timeDisplay((Date.now() - Game.startDate) / 1000) + "]";
    var output = time + " " + event + ": " + text;
    if (FrozenCookies.logging) console.log(output);
    if (popup) Game.Popup(text);
}

function liveWrinklers() {
    return _.select(Game.wrinklers, function (w) {
        return w.sucked > 0.5 && w.phase > 0;
    }).sort(function (w1, w2) {
        return w2.sucked - w1.sucked;
    });
}

function autoGSBuy() {
    if (hasClickBuff() && !Game.hasBuff("Cursed finger")) {
        if (
            Game.Upgrades["Golden switch [off]"].unlocked &&
            !Game.Upgrades["Golden switch [off]"].bought
        ) {
            Game.Upgrades["Golden switch [off]"].buy();
        }
    } else if (!hasClickBuff()) {
        if (
            Game.Upgrades["Golden switch [on]"].unlocked &&
            !Game.Upgrades["Golden switch [on]"].bought
        ) {
            Game.recalculateGains = 1; // Ensure price is updated since Frenzy ended
            Game.Upgrades["Golden switch [on]"].buy();
        }
    }
}

function safeBuy(bldg, count) {
    if (count <= 0) return;
    var initialAmount = bldg.amount;
    var toBuy = count;
    var maxAttempts = 2;
    for (var attempt = 0; attempt < maxAttempts; attempt++) {
        if (Game.buyMode == -1) {
            Game.buyMode = 1;
            bldg.buy(toBuy);
            Game.buyMode = -1;
        } else {
            bldg.buy(toBuy);
        }
        var newAmount = bldg.amount;
        var actuallyBought = newAmount - initialAmount;
        if (actuallyBought >= toBuy) {
            return; // Success
        } else if (actuallyBought > 0) {
            // Partial success, try to buy the rest
            safeBuy(bldg, toBuy - actuallyBought);
            return;
        }
        // If nothing was bought, try again (loop)
    }
    // If still not enough, recursively try to buy half, then the rest
    if (toBuy > 1) {
        var half = Math.floor(toBuy / 2);
        safeBuy(bldg, half);
        safeBuy(bldg, toBuy - half);
    }
}

function autoGodzamokAction() {
    if (!T) return;

    // if Godz is here and autoGodzamok is set
    if (Game.hasGod("ruin") && FrozenCookies.autoGodzamok) {
        // Need at least 10 of each to be useful
        //if (Game.Objects["Mine"].amount < 10 || Game.Objects["Factory"].amount < 10) return;
        var countMine = Game.Objects["Mine"].amount;
        var countFactory = Game.Objects["Factory"].amount;

        //Automatically sell all mines and factories
        if (
            !Game.hasBuff("Devastation") &&
            !Game.hasBuff("Cursed finger") &&
            hasClickBuff()
        ) {
            Game.Objects["Mine"].sell(countMine);
            Game.Objects["Factory"].sell(countFactory);
            //Rebuy mines
            if (FrozenCookies.mineLimit) {
                safeBuy(Game.Objects["Mine"], FrozenCookies.mineMax);
                FrozenCookies.autobuyCount += 1;
                logEvent(
                    "AutoGodzamok",
                    "Bought " + FrozenCookies.mineMax + " mines"
                );
            } else {
                safeBuy(Game.Objects["Mine"], countMine);
                FrozenCookies.autobuyCount += 1;
                logEvent("AutoGodzamok", "Bought " + countMine + " mines");
            }
            //Rebuy factories
            if (FrozenCookies.factoryLimit) {
                safeBuy(Game.Objects["Factory"], FrozenCookies.factoryMax);
                FrozenCookies.autobuyCount += 1;
                logEvent(
                    "AutoGodzamok",
                    "Bought " + FrozenCookies.factoryMax + " factories"
                );
            } else {
                safeBuy(Game.Objects["Factory"], countFactory);
                FrozenCookies.autobuyCount += 1;
                logEvent(
                    "AutoGodzamok",
                    "Bought " + countFactory + " factories"
                );
            }
        }
    }
}

function goldenCookieLife() {
    for (var i in Game.shimmers) {
        if (Game.shimmers[i].type == "golden") return Game.shimmers[i].life;
    }
    return null;
}

// --- Adapters over the buyer (src/systems/buyer.js). Other legacy code keeps calling these names.
function asLegacyPurchase(c) {
    if (c.kind == "offer") {
        // Sold through the buyer by another system (a season switch, a Santa level).
        return {
            id: c.key,
            efficiency: c.payback,
            delta_cps: c.deltaIncome,
            base_delta_cps: c.deltaIncome,
            cost: c.price,
            purchase: { id: c.key, name: c.name, buy: c.buy, getCost: function () { return c.price; } },
            type: "other",
            name: c.name,
        };
    }
    // The market's offers (the bank office, a broker) are neither a building nor an upgrade.
    var target = c.kind == "building" ? c.building : c.upgrade || { id: -1, name: c.name };
    return {
        id: target.id,
        efficiency: c.payback,
        delta_cps: c.deltaIncome,
        base_delta_cps: c.deltaIncome,
        cost: c.price,
        purchase: target,
        type: c.kind == "building" ? "building" : c.upgrade ? "upgrade" : c.kind,
        name: c.name,
    };
}

function baseCps() {
    return Game.unbuffedCps;
}

// delay: the bank to assume; wrinklerCount: how many wrinklers to assume attached.
function effectiveCps(delay, wrathValue, wrinklerCount) {
    return MushieCookies.incomeWith({ wrinklerCount: wrinklerCount, bank: delay });
}

function delayAmount() {
    return MushieCookies.buyer ? MushieCookies.buyer.reserve() : 0;
}

function bestBank() {
    return { cost: delayAmount(), efficiency: 0 };
}

function nextPurchase() {
    var next = MushieCookies.buyer ? MushieCookies.buyer.next() : null;
    return next ? asLegacyPurchase(next) : defaultPurchase();
}

function nextChainedPurchase() {
    return nextPurchase();
}

function recommendationList() {
    return MushieCookies.buyer ? MushieCookies.buyer.ranking().map(asLegacyPurchase) : [];
}

function maxCookieTime() {
    return Game.shimmerTypes.golden.maxTime;
}

// One pass of the buying loop. Returns true when something was bought.
function autoCookieBody() {
    var currentHCAmount = Game.HowMuchPrestige(
        Game.cookiesEarned + Game.cookiesReset + wrinklerValue()
    );

    if (
        Math.floor(FrozenCookies.lastHCAmount) < Math.floor(currentHCAmount)
    ) {
        var changeAmount = currentHCAmount - FrozenCookies.lastHCAmount;
        FrozenCookies.lastHCAmount = currentHCAmount;
        FrozenCookies.prevLastHCTime = FrozenCookies.lastHCTime;
        FrozenCookies.lastHCTime = Date.now();
        var currHCPercent =
            (60 * 60 * (FrozenCookies.lastHCAmount - Game.heavenlyChips)) /
            ((FrozenCookies.lastHCTime - Game.startDate) / 1000);
        if (
            Game.heavenlyChips < currentHCAmount - changeAmount &&
            currHCPercent > FrozenCookies.maxHCPercent
        ) {
            FrozenCookies.maxHCPercent = currHCPercent;
        }
        FrozenCookies.hc_gain += changeAmount;
    }
    // Sugar lumps are harvested by the lump system (src/systems/lumps.js), wrinklers popped by the
    // wrinkler system (src/systems/wrinklers.js).

    var itemBought = false;

    // Golden cookies, reindeer and fortunes: src/systems/shimmers.js, on its own guard.
    if (FrozenCookies.autoBlacklistOff) autoBlacklistOff();
    var currentFrenzy = cpsBonus() * clickBuffBonus();
    if (currentFrenzy != FrozenCookies.last_gc_state) {
        if (FrozenCookies.last_gc_state != 1 && currentFrenzy == 1) {
            logEvent("GC", "Frenzy ended, cookie production x1");
            if (FrozenCookies.hc_gain) {
                logEvent(
                    "HC",
                    "Won " +
                        FrozenCookies.hc_gain +
                        " heavenly chips during Frenzy. Rate: " +
                        (FrozenCookies.hc_gain * 1000) /
                            (Date.now() - FrozenCookies.hc_gain_time) +
                        " HC/s."
                );
                FrozenCookies.hc_gain_time = Date.now();
                FrozenCookies.hc_gain = 0;
            }
        } else {
            if (FrozenCookies.last_gc_state != 1) {
                logEvent(
                    "GC",
                    "Previous Frenzy x" +
                        FrozenCookies.last_gc_state +
                        "interrupted."
                );
            } else if (FrozenCookies.hc_gain) {
                logEvent(
                    "HC",
                    "Won " +
                        FrozenCookies.hc_gain +
                        " heavenly chips outside of Frenzy. Rate: " +
                        (FrozenCookies.hc_gain * 1000) /
                            (Date.now() - FrozenCookies.hc_gain_time) +
                        " HC/s."
                );
                FrozenCookies.hc_gain_time = Date.now();
                FrozenCookies.hc_gain = 0;
            }
            logEvent(
                "GC",
                "Starting " +
                    (hasClickBuff() ? "Clicking " : "") +
                    "Frenzy x" +
                    currentFrenzy
            );
        }
        if (FrozenCookies.frenzyTimes[FrozenCookies.last_gc_state] == null)
            FrozenCookies.frenzyTimes[FrozenCookies.last_gc_state] = 0;
        FrozenCookies.frenzyTimes[FrozenCookies.last_gc_state] +=
            Date.now() - FrozenCookies.last_gc_time;
        FrozenCookies.last_gc_state = currentFrenzy;
        FrozenCookies.last_gc_time = Date.now();
    }
    return itemBought;
}

// Owns the timer and the busy flag, so an exception in the body can never stop the loop.
function autoCookie() {
    var itemBought = false;
    if (!FrozenCookies.processing && !Game.OnAscend && !Game.AscendTimer) {
        FrozenCookies.processing = true;
        try {
            if (!autoCookie.guarded) autoCookie.guarded = MushieCookies.guard("legacy:autoCookie", autoCookieBody);
            itemBought = !!autoCookie.guarded();
        } finally {
            FrozenCookies.processing = false;
        }
    }
    if (FrozenCookies.frequency) {
        FrozenCookies.cookieBot = setTimeout(
            autoCookie,
            itemBought ? 0 : FrozenCookies.frequency
        );
    }
}

function FCStart() {
    //  To allow polling frequency to change, clear intervals before setting new ones.

    if (FrozenCookies.cookieBot) {
        clearInterval(FrozenCookies.cookieBot);
        FrozenCookies.cookieBot = 0;
    }
    if (FrozenCookies.autoGSBot) {
        clearInterval(FrozenCookies.autoGSBot);
        FrozenCookies.autoGSBot = 0;
    }

    if (FrozenCookies.autoGodzamokBot) {
        clearInterval(FrozenCookies.autoGodzamokBot);
        FrozenCookies.autoGodzamokBot = 0;
    }
    if (FrozenCookies.autoCastingBot) {
        clearInterval(FrozenCookies.autoCastingBot);
        FrozenCookies.autoCastingBot = 0;
    }
    if (FrozenCookies.autoFTHOFComboBot) {
        clearInterval(FrozenCookies.autoFTHOFComboBot);
        FrozenCookies.autoFTHOFComboBot = 0;
    }

    if (FrozenCookies.auto100ConsistencyComboBot) {
        clearInterval(FrozenCookies.auto100ConsistencyComboBot);
        FrozenCookies.auto100ConsistencyComboBot = 0;
    }

    if (FrozenCookies.autoDragonAura0Bot) {
        clearInterval(FrozenCookies.autoDragonAura0Bot);
        FrozenCookies.autoDragonAura0Bot = 0;
    }

    if (FrozenCookies.autoDragonAura1Bot) {
        clearInterval(FrozenCookies.autoDragonAura1Bot);
        FrozenCookies.autoDragonAura1Bot = 0;
    }

    if (FrozenCookies.autoDragonOrbsBot) {
        clearInterval(FrozenCookies.autoDragonOrbsBot);
        FrozenCookies.autoDragonOrbsBot = 0;
    }

    if (FrozenCookies.autoSugarFrenzyBot) {
        clearInterval(FrozenCookies.autoSugarFrenzyBot);
        FrozenCookies.autoSugarFrenzyBot = 0;
    }

    if (FrozenCookies.autoWorship0Bot) {
        clearInterval(FrozenCookies.autoWorship0Bot);
        FrozenCookies.autoWorship0Bot = 0;
    }

    if (FrozenCookies.autoWorship1Bot) {
        clearInterval(FrozenCookies.autoWorship1Bot);
        FrozenCookies.autoWorship1Bot = 0;
    }

    if (FrozenCookies.autoWorship2Bot) {
        clearInterval(FrozenCookies.autoWorship2Bot);
        FrozenCookies.autoWorship2Bot = 0;
    }

    if (FrozenCookies.autoCycliusBot) {
        clearInterval(FrozenCookies.autoCycliusBot);
        FrozenCookies.autoCycliusBot = 0;
    }

    // Now create new intervals with their specified frequencies.
    // Default frequency is 100ms = 1/10th of a second

    if (FrozenCookies.frequency) {
        FrozenCookies.cookieBot = setTimeout(
            autoCookie,
            FrozenCookies.frequency
        );
    }

    // Clicking (Autoclick, Autofrenzy): src/systems/clicker.js reads the settings live.

    if (FrozenCookies.autoGS) {
        FrozenCookies.autoGSBot = setInterval(
            MushieCookies.guard("legacy:autoGSBuy", autoGSBuy),
            FrozenCookies.frequency
        );
    }

    if (FrozenCookies.autoGodzamok) {
        FrozenCookies.autoGodzamokBot = setInterval(
            MushieCookies.guard("legacy:autoGodzamokAction", autoGodzamokAction),
            FrozenCookies.frequency
        );
    }

    if (FrozenCookies.autoCasting) {
        FrozenCookies.autoCastingBot = setInterval(
            MushieCookies.guard("legacy:autoCast", autoCast),
            FrozenCookies.frequency * 10
        );
    }

    if (FrozenCookies.autoFTHOFCombo) {
        FrozenCookies.autoFTHOFComboBot = setInterval(
            MushieCookies.guard("legacy:autoFTHOFComboAction", autoFTHOFComboAction),
            FrozenCookies.frequency * 2
        );
    }

    if (FrozenCookies.auto100ConsistencyCombo) {
        FrozenCookies.auto100ConsistencyComboBot = setInterval(
            MushieCookies.guard("legacy:auto100ConsistencyComboAction", auto100ConsistencyComboAction),
            FrozenCookies.frequency * 2
        );
    }

    // The bank office, brokers and loans (autoBank, autoBroker, autoLoan) are run by the market
    // system, src/systems/market.js.

    // autoDragon and petDragon are read by src/systems/dragon.js on the mod's loop.

    if (FrozenCookies.autoDragonAura0) {
        FrozenCookies.autoDragonAura0Bot = setInterval(
            MushieCookies.guard("legacy:autoDragonAura0Action", autoDragonAura0Action),
            FrozenCookies.frequency * 10
        );
    }

    if (FrozenCookies.autoDragonAura1) {
        FrozenCookies.autoDragonAura1Bot = setInterval(
            MushieCookies.guard("legacy:autoDragonAura1Action", autoDragonAura1Action),
            FrozenCookies.frequency * 10
        );
    }

    if (FrozenCookies.autoDragonOrbs) {
        FrozenCookies.autoDragonOrbsBot = setInterval(
            MushieCookies.guard("legacy:autoDragonOrbsAction", autoDragonOrbsAction),
            FrozenCookies.frequency * 10
        );
    }

    if (FrozenCookies.autoSugarFrenzy) {
        FrozenCookies.autoSugarFrenzyBot = setInterval(
            MushieCookies.guard("legacy:autoSugarFrenzyAction", autoSugarFrenzyAction),
            FrozenCookies.frequency * 2
        );
    }

    if (FrozenCookies.autoWorship0) {
        FrozenCookies.autoWorship0Bot = setInterval(
            MushieCookies.guard("legacy:autoWorship0Action", autoWorship0Action),
            FrozenCookies.frequency * 5
        );
    }

    if (FrozenCookies.autoWorship1) {
        FrozenCookies.autoWorship1Bot = setInterval(
            MushieCookies.guard("legacy:autoWorship1Action", autoWorship1Action),
            FrozenCookies.frequency * 5
        );
    }

    if (FrozenCookies.autoWorship2) {
        FrozenCookies.autoWorship2Bot = setInterval(
            MushieCookies.guard("legacy:autoWorship2Action", autoWorship2Action),
            FrozenCookies.frequency * 5
        );
    }


    if (FrozenCookies.autoCyclius) {
        FrozenCookies.autoCycliusBot = setInterval(
            MushieCookies.guard("legacy:autoCycliusAction", autoCycliusAction),
            FrozenCookies.frequency * 600 // 1 minute
        );
    }

    // The minigame handles are kept current by the mod's loop (minigameCheckAction).

    // Show the choice just made if the menu is open.
    if (Game.onMenu == "fc_menu") Game.UpdateMenu();
}
