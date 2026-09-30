FrozenCookies.preferenceValues = {
    autopilot: {
        hint: "Autopilot automates everything: it plays the whole game by itself with the best measured settings. Changing a playing option below hands control back to you.",
        display: ["Autopilot OFF", "Autopilot ON"],
        default: 0,
    },
    // clicking options
    clickingOptions: {
        hint: "Auto clicking:",
    },
    autoClick: {
        hint: "Auto-click big cookie and set speed.",
        display: ["Autoclick OFF", "Autoclick ON"],
        default: 0,
        extras: '<a class="option" id="cookieClickSpeed" onclick="updateSpeed(\'cookieClickSpeed\');">${cookieClickSpeed} clicks/sec</a>',
    },
    autoFrenzy: {
        hint: "Auto-click for click frenzies.",
        display: ["Autofrenzy OFF", "Autofrenzy ON"],
        default: 0,
        extras: '<a class="option" id="frenzyClickSpeed" onclick="updateSpeed(\'frenzyClickSpeed\');">${frenzyClickSpeed} clicks/sec</a>',
    },
    autoGC: {
        hint: "Auto-click golden/wrath cookies.",
        display: ["Autoclick GC OFF", "Autoclick GC ON"],
        default: 0,
    },
    autoReindeer: {
        hint: "Auto-click reindeer.",
        display: ["Autoclick Reindeer OFF", "Autoclick Reindeer ON"],
        default: 0,
    },
    autoFortune: {
        hint: "Auto-click fortunes in news ticker.",
        display: ["Auto Fortune OFF", "Auto Fortune ON"],
        default: 0,
    },

    // autobuy options
    buyingOptions: {
        hint: "Auto-buying:",
    },
    autoBuy: {
        hint: "Auto-buy most efficient building/upgrade.",
        display: ["AutoBuy OFF", "AutoBuy ON"],
        default: 0,
    },
    autoBlacklistOff: {
        hint: "Turn off blacklist when goal is met.",
        display: ["Auto Blacklist OFF", "Auto Blacklist ON"],
        default: 0,
    },
    blacklist: {
        hint: "Blacklist: Restrict purchases for achievements or challenges.",
        display: [
            "Blacklist OFF",
            "Blacklist Mode SPEEDRUN",
            "Blacklist Mode HARDCORE",
            "Blacklist Mode GRANDMAPOCALYPSE",
            "Blacklist Mode NO BUILDINGS",
        ],
        default: 0,
    },
    mineLimit: {
        hint: "Limit mines for Godzamok combos.",
        display: ["Mine Limit OFF", "Mine Limit ON"],
        default: 0,
        extras: '<a class="option" id="mineMax" onclick="updateMineMax(\'mineMax\');">${mineMax} Mines</a>',
    },
    factoryLimit: {
        hint: "Limit factories for Godzamok combos.",
        display: ["Factory Limit OFF", "Factory Limit ON"],
        default: 0,
        extras: '<a class="option" id="factoryMax" onclick="updateFactoryMax(\'factoryMax\');">${factoryMax} Factories</a>',
    },

    // other auto options
    autoOtherOptions: {
        hint: "Other automation:",
    },
    autoBulk: {
        hint: "Set bulk buy after ascension.",
        display: ["Auto Bulkbuy OFF", "Auto Bulkbuy x10", "Auto Bulkbuy x100"],
        default: 0,
    },
    autoAscendToggle: {
        hint: "Ascend when prestige growth slows; buys heavenly upgrades and fills permanent slots by measured value.",
        display: ["Auto Ascend OFF", "Auto Ascend ON"],
        default: 0,
    },
    autoWrinkler: {
        hint: "Keep every wrinkler feeding; pop one only when buying the next purchase sooner is worth more than its feeding. Shinies are kept. Collects them all before an ascension, yours included.",
        display: ["Auto Wrinklers OFF", "Auto Wrinklers ON"],
        default: 0,
    },
    autoSL: {
        hint: "Harvest sugar lumps when ripe; a golden lump waits for a full bank or a CpS buff, never past falling. Nothing in Born again.",
        display: ["Autoharvest SL OFF", "Autoharvest SL ON"],
        default: 0,
    },
    autoLumps: {
        hint: "Spend sugar lumps: minigames, Farm 9, Cursor 12, then the best building level (keeps 100 with Sugar baking).",
        display: ["Spend Lumps OFF", "Spend Lumps ON"],
        default: 0,
    },
    sugarBakingGuard: {
        hint: "Before Sugar baking is owned, keep 100 lumps ready for it after the minigame, Farm 9 and Cursor 12 targets (once owned, 100 are always kept).",
        display: ["Sugar Baking Guard OFF", "Sugar Baking Guard ON"],
        default: 0,
    },
    sugarFrenzy: {
        hint: "Spend a lump on Sugar frenzy (x3 CpS for an hour, once an ascension) near the end of a run, when two hours of CpS beat the best building level.",
        display: ["Sugar Frenzy OFF", "Sugar Frenzy ON"],
        default: 0,
    },
    autoGS: {
        hint: "Auto-toggle Golden Switch for click buffs.",
        display: ["Auto-Golden Switch OFF", "Auto-Golden Switch ON"],
        default: 0,
    },
    autoGodzamok: {
        hint: "Auto-sell mines/factories for Godzamok during click buffs.",
        display: ["Auto-Godzamok OFF", "Auto-Godzamok ON"],
        default: 0,
    },
    autoBank: {
        hint: "Auto-upgrade bank office.",
        display: ["Auto-Banking OFF", "Auto-Banking ON"],
        default: 0,
    },
    autoBroker: {
        hint: "Auto-hire stock brokers.",
        display: ["Auto-Broker OFF", "Auto-Broker ON"],
        default: 0,
    },
    autoLoan: {
        hint: "Auto-take loans during click frenzies.",
        display: ["Auto-Loans OFF", "Take loans 1 and 2", "Take all 3 loans"],
        default: 0,
        extras: '<a class="option" id="minLoanMult" onclick="updateLoanMultMin(\'minLoanMult\');">x${minLoanMult} minimum Frenzy</a>',
    },

    // Pantheon options
    worshipOptions: {
        hint: "Pantheon:",
    },
    autoWorshipToggle: {
        hint: "Auto-slot selected gods (can't select same god twice).",
        display: ["Auto Pantheon OFF", "Auto Pantheon ON"],
        default: 0,
    },
    autoWorship0: {
        hint: "Auto-slot god in DIAMOND slot.",
        display: [
            "No god",
            "Vomitrax",
            "Godzamok",
            "Cyclius",
            "Selebrak",
            "Dotjeiess",
            "Muridal",
            "Jeremy",
            "Mokalsium",
            "Skruuia",
            "Rigidel",
        ],
        default: 0,
    },
    autoWorship1: {
        hint: "Auto-slot god in RUBY slot.",
        display: [
            "No god",
            "Vomitrax",
            "Godzamok",
            "Cyclius",
            "Selebrak",
            "Dotjeiess",
            "Muridal",
            "Jeremy",
            "Mokalsium",
            "Skruuia",
            "Rigidel",
        ],
        default: 0,
    },
    autoWorship2: {
        hint: "Auto-slot god in JADE slot.",
        display: [
            "No god",
            "Vomitrax",
            "Godzamok",
            "Cyclius",
            "Selebrak",
            "Dotjeiess",
            "Muridal",
            "Jeremy",
            "Mokalsium",
            "Skruuia",
            "Rigidel",
        ],
        default: 0,
    },
    autoCyclius: {
        hint: "Auto-swap Cyclius for max CpS (set gods above, do not use Cyclius).",
        display: [
            "Auto-Cyclius OFF",
            "Auto-Cyclius in RUBY and JADE",
            "Auto-Cyclius in all slots",
        ],
        default: 0,
    },

    // Spell options
    spellOptions: {
        hint: "Grimoire:",
    },
    towerLimit: {
        hint: "Stop buying Wizard Towers at set max mana.",
        display: ["Wizard Tower Cap OFF", "Wizard Tower Cap ON"],
        default: 0,
        extras: '<a class="option" id="manaMax" onclick="updateManaMax(\'manaMax\');">${manaMax} max Mana</a>',
    },
    autoGods: {
        hint: "Slot Pantheon gods and pick dragon auras by what they add to income (needs the worship, Cyclius and aura options below OFF).",
        display: ["Auto Gods & Auras OFF", "Auto Gods & Auras ON"],
        default: 0,
    },
    autoMarket: {
        hint: "Trade the stock market with prices derived by simulating the game's own price model; spends only cookies the buyer is not holding.",
        display: ["Auto Trading OFF", "Auto Trading ON"],
        default: 0,
    },
    autoGarden: {
        hint: "Unlock every garden seed by breeding, then sacrifice the garden for 10 sugar lumps, and repeat.",
        display: ["Auto Garden OFF", "Auto Garden ON"],
        default: 0,
    },
    autoFate: {
        hint: "Cast Force the Hand of Fate by forecast: skip bad outcomes, land good ones on a running buff. Needs the casting modes below OFF.",
        display: ["Forecast Casting OFF", "Forecast Casting ON"],
        default: 0,
    },
    autoCasting: {
        hint: "Auto-cast selected spell when mana is full.",
        display: [
            "Auto Cast OFF",
            "Auto Cast CONJURE BAKED GOODS",
            "Auto Cast FORCE THE HAND OF FATE (simple)",
            "Auto Cast FORCE THE HAND OF FATE (smart)",
            "Auto Cast FTHOF (Click and Building Specials only)",
            "Auto Cast SPONTANEOUS EDIFICE",
            "Auto Cast HAGGLER'S CHARM",
        ],
        default: 0,
        extras: '<a class="option" id="minCpSMult" onclick="updateCpSMultMin(\'minCpSMult\');">x${minCpSMult} minimum Frenzy</a>',
    },
    spellNotes: {
        hint: "Only one combo can be active at a time. See readme.",
    },
    autoFTHOFCombo: {
        hint: "Auto double-cast FTHOF combos (needs enough mana).",
        display: ["Double Cast FTHOF OFF", "Double Cast FTHOF ON"],
        default: 0,
    },
    auto100ConsistencyCombo: {
        hint: "⚠️ EXPERIMENTAL: Auto-cast 100% Consistency Combo.",
        display: [
            "Auto Cast 100% Consistency Combo OFF",
            "Auto Cast 100% Consistency Combo ON",
        ],
        default: 0,
    },
    autoSugarFrenzy: {
        hint: "Auto-buy Sugar Frenzy during first combo of X Frenzy.",
        display: [
            "Auto Sugar Frenzy OFF",
            "ASF for 100% Consistency Combo",
            "ASF also for Double Cast Combo",
        ],
        default: 0,
        extras: '<a class="option" id="minASFMult" onclick="updateASFMultMin(\'minASFMult\');">x${minASFMult} minimum Frenzy</a>',
    },

    //Dragon options
    dragonOptions: {
        hint: "Dragon:",
    },
    autoDragon: {
        hint: "Auto-upgrade dragon.",
        display: ["Dragon Upgrading OFF", "Dragon Upgrading ON"],
        default: 0,
    },
    petDragon: {
        hint: "Pet the dragon for its drops, only while this quarter hour's drop is missing (needs Pet the dragon).",
        display: ["Dragon Petting OFF", "Dragon Petting ON"],
        default: 0,
    },
    autoDragonToggle: {
        hint: "Auto-set dragon auras.",
        display: ["Dragon Auras OFF", "Dragon Auras ON"],
        default: 0,
    },
    dragonNotes: {
        hint: "Set desired auras. Can't set same aura twice.",
    },
    autoDragonAura0: {
        hint: "Auto-set FIRST dragon aura.",
        display: [
            "No Aura",
            "Breath of Milk",
            "Dragon Cursor",
            "Elder Battalion",
            "Reaper of Fields",
            "Earth Shatterer",
            "Master of the Armory",
            "Fierce Hoarder",
            "Dragon God",
            "Arcane Aura",
            "Dragonflight",
            "Ancestral Metamorphosis",
            "Unholy Dominion",
            "Epoch Manipulator",
            "Mind Over Matter",
            "Radiant Appetite",
            "Dragon's Fortune",
            "Dragon's Curve",
            "Reality Bending",
            "Dragon Orbs",
            "Supreme Intellect",
            "Dragon Guts",
        ],
        default: 0,
    },
    autoDragonAura1: {
        hint: "Auto-set SECOND dragon aura.",
        display: [
            "No Aura",
            "Breath of Milk",
            "Dragon Cursor",
            "Elder Battalion",
            "Reaper of Fields",
            "Earth Shatterer",
            "Master of the Armory",
            "Fierce Hoarder",
            "Dragon God",
            "Arcane Aura",
            "Dragonflight",
            "Ancestral Metamorphosis",
            "Unholy Dominion",
            "Epoch Manipulator",
            "Mind Over Matter",
            "Radiant Appetite",
            "Dragon's Fortune",
            "Dragon's Curve",
            "Reality Bending",
            "Dragon Orbs",
            "Supreme Intellect",
            "Dragon Guts",
        ],
        default: 0,
    },
    autoDragonOrbs: {
        hint: "Auto-sell Yous for GC if Dragon Orbs aura is set and Godzamok is not.",
        display: ["Auto-Dragon Orbs OFF", "Auto-Dragon Orbs ON"],
        default: 0,
    },
    orbLimit: {
        hint: "Limit Yous for Dragon Orbs combos.",
        display: ["You Limit OFF", "You Limit ON"],
        default: 0,
        extras: '<a class="option" id="orbMax" onclick="updateOrbMax(\'orbMax\');">${orbMax} Yous</a>',
    },

    // Season options
    seasonOptions: {
        hint: "Season:",
    },
    autoSeasons: {
        hint: "Switch seasons (with Season switcher) when the drops and reindeer repay the switch, visit Valentine's for hearts, rest in Christmas, and level Santa by measured value.",
        display: ["Auto Seasons OFF", "Auto Seasons ON"],
        default: 0,
    },

    //Bank options
    bankOptions: {
        hint: "Bank: (delays autobuy until bank is full)",
    },
    holdManBank: {
        hint: "Manual minimum bank (minutes of base CpS)",
        display: ["Manual Bank OFF", "Manual Bank ON"],
        default: 0,
        extras: '<a class="option" id="manBankMins" onclick="updateManBank(\'manBankMins\');">${manBankMins} Minutes</a>',
    },
    holdSEBank: {
        hint: "Keep bank for Spontaneous Edifice.",
        display: ["SE Bank OFF", "SE Bank ON"],
        default: 0,
    },
    setHarvestBankPlant: {
        hint: "Keep bank for harvesting selected plant.",
        display: [
            "Harvesting Bank OFF",
            "Harvesting Bank BAKEBERRY",
            "Harvesting Bank CHOCOROOT",
            "Harvesting Bank WHITE CHOCOROOT",
            "Harvesting Bank QUEENBEET",
            "Harvesting Bank DUKETATER",
            "Harvesting Bank CRUMBSPORE",
            "Harvesting Bank DOUGHSHROOM",
        ],
        default: 0,
    },
    setHarvestBankType: {
        hint: "Increase bank for plant harvest during CpS buffs.",
        display: [
            "Harvesting during NO CpS MULTIPLIER",
            "Harvesting during FRENZY",
            "Harvesting during BUILDING SPECIAL",
            "Harvesting during FRENZY + BUILDING SPECIAL",
        ],
        default: 0,
        extras: '<a class="option" id="maxSpecials" onclick="updateMaxSpecials(\'maxSpecials\');">${maxSpecials} Building specials</a>',
    },

    // Other options
    otherOptions: {
        hint: "Other:",
    },
    FCshortcuts: {
        hint: "Keyboard shortcuts: a autobuy, b building spread, c golden cookies, e export, r ascend (asks first), s save, w wrinklers.",
        display: ["Shortcuts OFF", "Shortcuts ON"],
        default: 0,
    },
    simulatedGCPercent: {
        hint: "Assume % of GCs clicked for efficiency (100% recommended).",
        display: ["GC clicked 0%", "GC clicked 100%"],
        default: 1,
    },

    //Display options
    displayOptions: {
        hint: "Display:",
    },
    showMissedCookies: {
        hint: "Show missed golden cookies in info panel.",
        display: ["Show Missed GCs OFF", "Show Missed GCs ON"],
        default: 0,
    },
    numberDisplay: {
        hint: "Change number formatting style.",
        display: [
            "Number Display RAW",
            "Number Display FULL (million, billion)",
            "Number Display INITIALS (M, B)",
            "Number Display SI PREFIXES (M, G, T)",
            "Number Display SCIENTIFIC (6.3e12)",
        ],
        default: 1,
    },
    fancyui: {
        hint: "Infobox style (text, wheel, or both).",
        display: [
            "Infobox OFF",
            "Infobox TEXT ONLY",
            "Infobox WHEEL ONLY",
            "Infobox WHEEL & TEXT",
        ],
        default: 0,
    },
    logging: {
        hint: "Log actions to console.",
        display: ["Logging OFF", "Logging ON"],
        default: 1,
    },
    purchaseLog: {
        hint: "Log all auto-purchases.",
        display: ["Purchase Log OFF", "Purchase Log ON"],
        default: 0,
    },

    slowOptions: {
        hint: "Warning: These options may slow the game.",
    },
};
