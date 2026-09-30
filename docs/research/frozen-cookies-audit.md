# Frozen Cookies technical audit (read-only)

Research snapshot, 2026-09-29. Analysed against Cookie Clicker v2.053 (Steam).

## Scope and method

- **Repo audited:** `https://github.com/erbkaiser/FrozenCookies` (primary source). HEAD `797f174`, 2025-07-27.
- **Path convention:** all Frozen Cookies `file:line` references are paths relative to the repo root at upstream commit 797f174. This repository is a fork of that repo, so the references resolve directly at that commit.
- **Game source used for cross-checking (read only):** `<game>/src/main.js`, `<game>/src/minigameGrimoire.js`, `<game>/src/minigameGarden.js`, and `<game>/steam/steam.js`, where `<game>` is the game's `resources/app` directory. Analysed game version is **v2.053** (`<game>/src/index.html:17`). In the text below, bare `main.js:N` references mean the game's `main.js`; Frozen Cookies files are always named `fc_*.js`, `frozen_cookies.js`, `cc_upgrade_prerequisites.js` or `Steam/FrozenCookies/*`.
- **Nothing was executed.** Every behavioural claim is from static reading. Tags: **[V]** = verified by reading the source(s) named; **[I]** = inference, not directly confirmed.

---

## 1. Inventory

| File | Lines | Responsibility |
|---|---|---|
| `fc_main.js` | 3779 | Core: mod registration, load/save, monkey patches, GC valuation model, banks, purchase optimizer, simulation toggles, wrinklers, Godzamok, Golden Switch, main loop `autoCookie`, timer setup `FCStart`, "reward cookie" patch |
| `fc_spells.js` | 2023 | FTHOF outcome predictor, `autoCast`, double-cast combo, "100% Consistency Combo" state machine, Auto Sweet, Auto Sugar Frenzy |
| `fc_button.js` | 1165 | FC button, menu (`FCMenu` overrides `Game.UpdateMenu`), preference setters, dead store-rebuild code |
| `fc_gods.js` | 725 | Pantheon slotting, Cyclius timetable, Rigidel lump harvest, Dragon's Curve, dragon upgrade/petting/auras/orbs |
| `cc_upgrade_prerequisites.js` | 631 | Static data: `upgradeJson` (471 prerequisite entries), blacklists, season cookie ids, hardcoded GC odds table `cookieInfo` |
| `fc_preferences.js` | 578 | Preference schema `FrozenCookies.preferenceValues` |
| `fc_infobox.js` | 481 | Number formatting, `timeDisplay`, infobox drawing, `updateTimers` (runs every draw frame) |
| `frozen_cookies.js` | 101 | Loader: pulls jQuery, CDN libs, then the 8 FC modules |
| `fc_bank.js` | 57 | Bank office upgrade, broker hiring, loans. No trading |
| `fc_userscript_loader.user.js` | 21 | Tampermonkey loader |
| `fc_bookmarklet_loader.js` | 1 | Bookmarklet |
| `Steam/FrozenCookies/info.txt` | 12 | Steam mod manifest |
| `Steam/FrozenCookies/main.js` | 1 | Steam entry point (one `Game.LoadMod` call) |
| `README.md` | 1064 | Docs and changelog |
| `index.html`, `_config.yml`, `.prettierignore` | 45 / 1 / 2 | GitHub Pages stub, Jekyll theme, prettier config |

About 9,560 lines of JS. No build step, no tests, no package.json, no linter config.

**License [V]:** there is no LICENSE file. GitHub API returns `licenseInfo: null` for this repo and for both upstreams (Icehawk78, Mtarnuhal). The README has a license badge (`README.md:4`) that points at nothing. The README says nothing about forking or redistribution; the only relevant sentence is "Contributions and suggestions are welcome!" (`README.md:749`). In issue #142 the maintainer said he would "check about the possibility and legality" of bundling dependencies, so he has not settled this himself. Practical consequence: forking on GitHub is covered by GitHub's terms, but there is no explicit grant to redistribute (for example to Steam Workshop). The maintainer is responsive; asking him for a license is the cheap fix.

---

## 2. Loading

**Steam manifest [V]** (`Steam/FrozenCookies/info.txt:1-12`):
```
"ID": "frozen_cookies", "ModVersion": "2.052.8", "GameVersion": 2.052,
"Date": "2025/07/20", "Dependencies": [], "Disabled": 1, "AllowSteamAchievs": 1
```
- `AllowSteamAchievs` **is set to 1**, so Steam achievements stay enabled (game gate is `<game>/steam/steam.js:601`).
- `Disabled: 1` means it ships disabled and must be enabled in Manage mods.

**Entry file [V]** (`Steam/FrozenCookies/main.js:1`):
```
Game.LoadMod("http://erbkaiser.github.io/FrozenCookies/frozen_cookies.js");
```

**It is not self-contained. All real code is remote. [V]**
1. The Steam folder contains only those two files. The loader URL is **plain HTTP**. Fetched on the snapshot date: it 301-redirects to `http://github.erbkaiser.com/FrozenCookies/frozen_cookies.js`, still plain HTTP, status 200.
2. `frozen_cookies.js:16-23` tries to derive its base URL from a script element with id `frozenCookieScript` or `modscript_frozen_cookies`. The game's `LoadScript` (`main.js:87`, identical in the web build) sets **no id**, so this lookup always fails and the base URL always falls back to the hardcoded `https://github.erbkaiser.com/FrozenCookies/`. Pointing `main.js` at a local `frozen_cookies.js` would therefore still pull the 8 modules from the remote host.
3. `frozen_cookies.js:31-53` loads 13 third-party assets from CDNs at runtime: jQuery UI (googleapis), underscore, jCanvas, jqPlot plus 7 plugins (cdnjs), and jQuery 3.6.0 from code.jquery.com (`:88-101`). Only jQuery has an SRI hash.
4. Deployed files matched repo HEAD on the snapshot date (sha1 equal for `frozen_cookies.js`, `fc_main.js`, `fc_spells.js`).

**Risk evidence [V]:** issue #202 (May 2026) reports the custom domain returned 404 and the mod stopped loading for everyone until the maintainer re-enabled it. Issue #142 (open since 2023) asks for offline use.

**What a local fork needs:** (a) local path in `main.js`, (b) replace base-URL detection with `document.currentScript.src`, (c) vendor the libraries, (d) ideally drop most of them. underscore is used 15 times across 9 functions, jqPlot only for the stats graph, jCanvas only for the infobox.

**Web vs Steam:** same loader. Steam-specific handling is limited to `App` checks for upgrade ids 816/817 (`fc_main.js:2036-2040`) and `App.gotAchiev` in `fcWin` (`fc_main.js:2666`).

**Side effect [V]:** FC awards the "Third-party" shadow achievement itself (`fc_main.js:284`). The vanilla Steam game does not award it for Steam mods (`main.js:1063` is gated on `!App`).

---

## 3. Architecture

**Main loop [V].** `autoCookie` (`fc_main.js:2964-3348`) is a self-rescheduling `setTimeout` every `FrozenCookies.frequency` = 100 ms (`:192`), or 0 ms right after a purchase (`:3337-3340`). Order per tick: HC tracking, `updateCaches()`, lump harvest, wrinklers, purchase, auto-ascend, force `Game.fps`, pop golden cookies and reindeer, blacklist auto-off, frenzy time logging.

**Timers [V].** `FCStart` (`fc_main.js:3350-3698`) clears and recreates about 30 `setInterval`s, all multiples of 100 ms. It is called on every preference change.
- Leak: `frenzyClickBot` (`:3502`) and `autoSweetBot` (`:3551`) are never cleared, so each `FCStart` stacks another interval.
- `updateTimers` runs on **every draw frame** via the `draw` hook (`fc_main.js:28`, `fc_infobox.js:232-482`), doing bank calculations, recursive prerequisite costing and jQuery lookups each frame.

**Preferences [V].**
- Schema in `fc_preferences.js:1-578`: `{hint, display[], default, extras}`. The value is the index into `display`, stored directly as `FrozenCookies[name]`.
- Numeric settings are outside the schema and hand-wired in four places: load (`fc_main.js:295-308`), save (`:477-496`), a prompt function each (`:612-709`), and the `extras` HTML string.
- Persistence uses the game's mod save API (`save: saveFCData`, `load: setOverrides`, `fc_main.js:164-165`), with a legacy localStorage fallback (`:378-388`).

**UI [V].** `FCMenu` replaces `Game.UpdateMenu` (`fc_button.js:361-1112`) and rebuilds the whole menu with jQuery once a second while open. The FC button hides the game's Info button (`fc_button.js:4-14`).

**Caching [V].** `FrozenCookies.caches` holds `nextPurchase`, `nextChainedPurchase`, `recommendationList`, `buildings`, `upgrades` (`fc_main.js:399-406`). Invalidation is one boolean, `recalculateCaches`. `updateCaches` (`:2589-2633`) sets it when CpS, current bank, target bank or GC value move by more than 0.01%, or when the store's upgrade count changes, and loops up to 10 full recalculations per tick.

**Global state: heavily tangled [V].**
- Everything is a global function. `FrozenCookies` carries roughly 150 mixed fields (preferences, runtime state, timer handles).
- Single-letter globals `G`, `B`, `T`, `M` (`fc_main.js:746-749`); `nextSpell` reassigns global `M` and leaks `season`, `spell`, `ret` (`fc_spells.js:41-44, 98`). `calculateChainValue` leaks `x`, `n` (`fc_main.js:1328-1329`).
- State machines store state on function objects (`autoFTHOFComboAction.state`).
- Subsystems coordinate by **overwriting each other's user preferences**. Combos set `FrozenCookies.autoBuy = 0` and remember the old value in `*.autobuyyes` (`fc_spells.js:1114-1119, 1333-1352`). Since the same fields are what gets saved, a save mid-combo persists the temporary value. The repair block at `fc_main.js:310-356` exists for exactly this.

**Monkey patches [V]:** `Beautify` (`:250`), `Game.sayTime` (`:251`), `Game.tooltip.draw` (`:254-257`), `Game.Reset` (`:258-261`), `Game.Win` (`:262`), `Game.UpdateMenu`, plus two `eval` source rewrites (`:269-281`).

---

## 4. The purchase optimizer

### 4.1 Formula [V]
`purchaseEfficiency` (`fc_main.js:1747-1755`):
```
efficiency = efficiencyWeight * cost/currentCps + cost/deltaCps      (lower is better)
             Infinity if deltaCps <= 0
```
- **`efficiencyWeight` is 1.0 (`fc_main.js:193`). The README documents 1.15 (`README.md:944-970`).** Code and docs disagree.
- `currentCps` is not displayed CpS. It is `effectiveCps()` (`:1082-1095`) = base CpS with buffs divided out, times a wrinkler multiplier, plus modelled golden cookie income, plus autoclick income, plus reindeer income.

### 4.2 How delta CpS is computed [V]
It **simulates by mutating live game state and calling the game's own `Game.CalculateGains()`**, then reverting.

- **Buildings** (`buildingStats`, `:1857-1938`; `buildingToggle`, `:2342-2363`): increments `amount`, `bought`, `Game.BuildingsOwned` by exactly 1, recalculates, reads CpS, reverts. Always +1, regardless of bulk mode.
- **Upgrades** (`upgradeStats`, `:1940-2010`; `upgradeToggle`, `:2271-2340`): sets `bought = 1`, also adds any missing prerequisite buildings and recursively toggles prerequisite upgrades, then replays the upgrade's side effects through `buyFunctionToggle`.
- **`buyFunctionToggle`** (`:2365-2452`) takes the upgrade's `buyFunction` source text, strips `if` and `for` with regexes, drops statements matching an ignore list, **`eval`s the rest**, and builds inverse statements by string replacement. This is how season switches and `Game.elderWrath` changes get simulated.

What this does and does not capture:

| Effect | Captured? | Why |
|---|---|---|
| Synergies, grandma types, tiered multipliers | Yes [V] | The game's own formula is used |
| Kitten upgrades with current milk | Yes [V] | Same |
| Achievements gained by the purchase (extra milk) | **No [V]** | Building-count achievements are awarded in the game's buy path (`UnlockTiered`, `main.js:~9919`), which the simulation bypasses. CpS achievements are awarded inside `CalculateGains` (`main.js:5101-5104`) but after milk was already computed (`main.js:5018`), and FC calls it once |
| Season and wrath stage changes | Partly [V] | Via the `eval` replay |

The achievement snapshot and restore (`:1906-1910, 2327-2334`) exists only to undo CpS achievements that the simulation triggers. The maintainers' own comment at `fc_main.js:2635-2648` shows they do not know why `fcWin` is called so often; this is why.

### 4.3 Selection and chain logic [V]
- `recommendationList` (`:1757-1777`) concatenates upgrades, buildings and a Santa entry and sorts by efficiency, then delta CpS, then cost.
- `nextPurchase` (`:1813-1850`) takes the best entry. If it is a locked upgrade with unmet prerequisites, the actual purchase becomes the best-ranked prerequisite.
- Prerequisites come from the static table `upgradeJson` (`cc_upgrade_prerequisites.js:4-542`). Upgrades not in the table (kittens, cookie upgrades) are only considered once the game unlocks them (`:2069`).
- **Lookahead: none beyond this.** A chain is valued as one atomic lump: total cost against total delta CpS. It is one-step greedy.

### 4.4 Bank reserves [V]
- `delayAmount()` (`:1695-1706`) = `bestBank(nextChainedPurchase().efficiency).cost`. Autobuy only fires when `Game.cookies >= delay + cost` (`:3060-3066`). Elder Pledge is exempt.
- `bestBank` (`:1589-1624`) considers three levels: 0, **Lucky bank = 6000 x base CpS** (`:1429-1431`), **Frenzy+Lucky bank = 42000 x base CpS** plus the price of Get Lucky if unowned (`:1433-1439`). It picks the largest whose efficiency is at most the next purchase's efficiency.
- Bank efficiency uses `cost/deltaCps` only (`cookieEfficiency`, `:1570-1587`), a different formula from the one it is compared against.
- Overrides: Spontaneous Edifice bank, harvest bank, manual bank, taken as a max (`:1591-1602`).
- A chain bank is computed (`:1441-1457`) but only displayed, never used. No bank level accounts for building specials, Dragon Harvest or Elder Frenzy.

### 4.5 Upgrades whose value is not CpS [V]

| Type | Treatment |
|---|---|
| Golden cookie upgrades (Lucky day, Serendipity, Get lucky) | Valued through the GC income model (`:1007-1021, 1112-1199`) |
| Click upgrades | Valued only through `clickSpeed x cookiesPerClick`. With autoclick off they are worth zero and never bought |
| Season switchers | If it is the configured default season: `efficiency = cost / baseCps` (`:1979-1984`). Otherwise simulated. Gated by `isUnavailable` (`:2084-2089`) |
| Research chain | In `upgradeJson` (ids 64-73). Wrath effect simulated, and the model **assumes a full set of wrinklers whenever wrath > 0** (`:1084`), which strongly favours the Grandmapocalypse |
| Discount upgrades | Valued only as the saving on the **single next** recommended purchase; bought if that saving exceeds their cost (`:1967-1970, 1985-1986`, `checkPrices` `:1714-1744`) |
| Zero-delta upgrades | Never recommended. A hardcoded list of 13 names is bought as soon as affordable, ignoring the bank (`buyOtherUpgrades`, `:824-874`) |
| Never bought | Chocolate egg, Golden switch, Shimmering veil, Sugar frenzy, selectors (`cc_upgrade_prerequisites.js:553-562`) |
| Santa levels | Efficiency Infinity (`:2094-2119`); only bought as a prerequisite |

### 4.6 Where it is provably suboptimal or crude
1. **Click income is overestimated by 5x or more. [V]** The game ignores clicks less than 20 ms after the last accepted one when called without an event (`Game.ClickCookie` in `main.js`: `now-Game.lastClick<1000/50`), so at most 50 clicks/sec register. FC calls `Game.ClickCookie()` with no event (`fc_main.js:2959-2962`) but models income as the configured rate x cookies per click (`:1075-1080`). Recommended settings are 250 and 1000 (`:880-882`). This inflates `currentCps` and click upgrade values.
2. **The GC model is outdated. [V]** Odds are a hardcoded table (`cc_upgrade_prerequisites.js:575-631`) covering only clot, frenzy, blood, chain, ruin, lucky, click and pairs. The game's current pool also has building special, dragon harvest, dragonflight, cookie storm, cursed finger, free lump, with different selection logic (`main.js:~5426-5450`). Durations are hardcoded (77 s, 13 s) and ignore Lasting fortune and similar.
3. **GC frequency is wrong for late game. [V]** FC accounts for three upgrades (`fc_main.js:1007-1021`); the game has a dozen more modifiers (`getTimeMod` in `main.js`). The tables are built once at load with the then-current `Game.fps` (`:990-999`), while FC lets you change fps (`:3263-3264`). Issue #61 is this; the maintainer closed it as unfixable "without a full rewrite".
4. **Achievement milk from a purchase is ignored** (see 4.2).
5. **Chains are valued atomically**, so long chains look worse than they are.
6. **Discount upgrades are valued against one purchase.**
7. **The weight is 1.0, not the 1.15 the docs cite.**
8. **One building per tick, full recalculation after each.** `safeBuy(recommendation.purchase, 1)` (`:3153`) always buys 1, so Auto Bulkbuy only changes the store UI. Issue #203 reports exactly this. The near-limit bulk branches at `:3098-3151` are now pointless, and their `FrozenCookies.autoSpell` conditions reference a preference that does not exist.
9. **The first term ignores cookies already held.**
10. **GC valuation ignores the Autoclick GC setting. [V]** It is governed only by `simulatedGCPercent` (`:1681-1686`), contradicting `README.md:1001`. Related to issue #200.

---

## 5. Automation subsystems

| Subsystem | What it does | Sophistication |
|---|---|---|
| **Golden/wrath clicking** | Pops every golden shimmer each tick (`fc_main.js:3267-3275`). Wrath filter is commented out (`:3271`) | Minimal. No wrath policy, no delayed clicking for stacking. Issue #128 promised wrath-ignore; not present |
| **Big cookie autoclick** | `setInterval(fcClickCookie, 1000/speed)` (`:3494-3499`) | Minimal. Capped at about 50/sec by the game [V] |
| **Frenzy click speed** | 100 ms poller swaps to a second interval while a click buff is active (`:2821-2841`) | Minimal. Same cap, so the separate speed is mostly moot [I] |
| **Grimoire prediction** | `nextSpell(i)` (`fc_spells.js:39-102`) reseeds with `Game.seed + "/" + (spellsCastTotal + i)` and replays the game's RNG call order | **Yes, it predicts with the seeded RNG. [V]** Call order matches `minigameGrimoire.js:37-80` on reading. Defects below |
| **Grimoire simple/smart** | Casts only at full mana. Always takes a free lump; Stretch Time to shorten a debuff; Haggler's Charm to skip a backfire; smart mode requires specific buffs with enough time left (`:278-698`) | Moderate. Rule-based, thresholds hardcoded |
| **Combo stacking** | Double cast (`:701-1157`): burns casts with Haggler's Charm until the next two outcomes are a wanted pair, waits for a natural Frenzy/Dragon Harvest plus building special, casts, sells towers, casts again, rebuys. "100% Consistency" (`:1159-1905`): 20-state script adding lump refill, aura swap, Golden Switch, Godzamok sells | Ambitious but brittle. It does seek combos, which is real planning. Looks only 2 outcomes ahead |
| **Garden** | None. Only `harvestAll()` on reset (`fc_main.js:431`), whiskerbloom planting inside the 100% combo, and a harvest bank reserve | Absent. Maintainer declined it in issue #168 |
| **Stock market** | No trading. Office upgrades, brokers, loans (`fc_bank.js`). Sells all stock on reset (`fc_main.js:426-430`) | Absent |
| **Pantheon** | Slots three user-chosen gods (`fc_gods.js:32-101`). Cyclius follows a hardcoded UTC timetable (`:103-425`) | Static. No situational swapping |
| **Dragon** | Upgrades as soon as the cost can be paid, no efficiency check (`:562-589`). Petting predicts the current drop with the seeded RNG (`:591-622`). Two static auras (`:624-695`). Orbs: sells one You when idle (`:697-725`) | Petting is good. The rest is static |
| **Wrinklers** | "Efficient": pops the fattest until the next purchase is affordable, or one when at max count (`fc_main.js:2763-2819`). "Instant": pops all. Shiny protection. Pops by setting `w.hp = 0` | Moderate |
| **Sugar lumps** | **Harvest only.** Harvests when ripe (`:2993-3005`). Optional Rigidel swap with building sell-down to a multiple of 10 (`fc_gods.js:432-501`). Optional Dragon's Curve swap before harvest to bias the next lump (`:503-560`) | It does not choose lump type, does not predict it from the seed, and never spends lumps on building levels |
| **Seasons** | Switches through the optimizer; stays until drops are complete; Easter during Cookie Storm, Halloween when wrinklers exist (`fc_main.js:764-807`) | Moderate. Fixed order (issue #67) |
| **Godzamok** | On a click buff without Devastation, sells **all Mines and Factories** and immediately rebuys (`:2894-2943`) | Crude. Fixed two building types, no cost check |
| **Auto-ascend** | See below | Crude |
| **Heavenly upgrades** | **None. [V]** No code touches the prestige pool. Hint says "skips upgrade screen" (`fc_preferences.js:97`) | Absent |
| **Golden Switch** | On during click buffs, off otherwise (`fc_main.js:2843-2860`) | Simple rule, no cost/benefit though each toggle costs an hour of CpS |
| **Shimmering Veil** | **None. [V]** Only reference is the never-buy list. Autoclicking breaks the veil anyway | Absent |

### Auto-ascend detail [V] (`fc_main.js:3188-3244`)
- **Mode 1:** ascend when new prestige levels >= a fixed user number.
- **Mode 2:** ascend when projected prestige >= 2 x current.
- Both need `Game.prestige > 0`, so never on a first run, and both need `HCAscendAmount > 0`, **including mode 2, which does not use it**. The recommended preset sets mode 2 with amount 0 (`:899-901`), so that configuration never fires. Plausible cause of issues #172 and #147 [I].
- Then `Game.Ascend(1)` and a fixed `setTimeout(10000)` to `Game.Reincarnate(1)`.

**Is the rule good? No.**
- Doubling is a folk heuristic. It ignores the rate of prestige gain, the rebuild time, and what the chips would buy.
- FC already tracks HC per hour and its peak (`:2979-2987`) but only displays them. A rate-based rule is a small change with data already present.
- The projection counts wrinkler and chocolate egg value, but those are collected inside `fcReset`, which runs from `Game.Reincarnate` after prestige was already awarded at the end of the ascend animation (`main.js:4094` versus `:4125`). They count toward the next ascension, not this one. [I, from reading order of operations]
- The fixed 10 s timer assumes the 150-frame animation takes 5 s. `AscendDuration` is fixed at launch (`main.js:4082`), so at FC's 15 fps option or lower the animation takes 10 s or more and the timer can fire first. [I]

### Grimoire defects
- **Second-cast prediction uses the wrong fail chance. [I, high confidence]** Each golden cookie on screen adds 15% backfire chance (`minigameGrimoire.js`, `failFunc`). The 100% combo turns GC clicking off and leaves the first cookie on screen, so the second cast runs at 30% while the prediction assumed 15%. About 15% of predicted successes on cast 2 would backfire. Casts 3 and 4 are not predicted at all.
- One outcome is mislabelled: the game pushes `'cookie storm','cookie storm','blab'`; FC labels the first "Cookie Chain" (`fc_spells.js:69-73`). Harmless in current logic. [V]
- `nextSpellName` compares HTML strings and calls `nextSpell` up to 13 times per lookup (`:105-194`). [V]

---

## 6. Gaps and weaknesses

### What a strong player does that FC does not
- Spends heavenly chips and sets permanent upgrade slots.
- Runs the garden.
- Trades the stock market.
- Spends lumps on building levels; manipulates lump type.
- Times golden cookie clicks; avoids wrath cookies selectively.
- Swaps gods and auras by situation.
- Picks Godzamok sell targets by value.
- Ascends on rate of return and buys in bulk after ascending.
- Manages Shimmering Veil.
- Sells buildings and buys the Chocolate egg before ascending so it counts immediately.

### Bugs found by reading [V unless noted]

| Location | Bug |
|---|---|
| `fc_main.js:3747-3779` | **"Reward cookie" patch buys buildings with no `autoBuy` check, no bank check, no blacklist check, and via `obj.buy()` rather than `safeBuy`.** In sell mode `buy()` sells instead (`main.js:7828`). Very likely the cause of open issues #201 (buildings bought with autobuy off) and #204 (towers bought to "around 650"; Everybutter biscuit needs exactly 650, `cc_upgrade_prerequisites.js:438`) [I for the causal link] |
| `fc_main.js:3725-3729` | `restoreBuildingLimits` compares Wizard tower **count** to `manaMax`, which is **mana**. With cap 100 it would sell towers down to 100 |
| `fc_main.js:2042-2064` | "Stay in base season" condition requires the id to equal 182 and 183 and 184 and 209 at once. Always false; Free Season is dead |
| `fc_main.js:1422` | `if (!canCastSE)` tests the function, not its result. Always false |
| `fc_main.js:3072, 3178` | `disabledPopups` assigned as a bare global; the real flag never changes |
| `fc_main.js:466-467` | Resets `lastCps`/`lastBaseCps`; real fields are `lastCPS`/`lastBaseCPS` |
| `fc_main.js:2776-2782` | Sorts `Game.wrinklers` in place, reordering the game's own array |
| `fc_main.js:1618` | `bankLevels[0].cost` throws if the filter empties (NaN efficiency) [I; a third-party fork has a branch named for this crash] |
| `fc_spells.js:736-737, 796-797, 953-954` | `!nextSpellName(0) == "Click Frenzy"` is `false == "..."`. Always false, so combo abort guards never fire |
| `fc_spells.js:1407, 1420` | Same precedence bug on aura checks |
| `fc_spells.js:1516-1517` | `Game.shimmers[0].pop()` twice, unguarded. Throws if empty and the machine sticks in state 12 |
| `fc_spells.js:1596` | `Game.shimmer.wrath` reads the constructor. Always undefined, so wrath cookies are popped in the step meant to skip them |
| `fc_spells.js:1871` | `countAntiMatter` never defined |
| `fc_spells.js:1375` | Whiskerbloom check looks inverted: plants when the seed is locked, skips when unlocked. `useTool` does not check unlock state (`minigameGarden.js:1442`) [I on intent] |
| `fc_spells.js:1470-1474` | Lump refill in the combo ignores Sugar Baking Guard |
| `fc_spells.js:1939-1942` | Auto Sweet calls `Game.Reincarnate(1)` directly, a reset with no prestige award that run |
| `README.md:352, 935` | Documented kill switch is `FrozenCookies.autosweet = 0`; the real flag is `autoSweet`. The documented command does nothing |
| `fc_gods.js:60, 84, 92` | `FrozenCookies.autoworship1` typo (lowercase w) |
| `fc_gods.js:341` | `times.SI730` does not exist; that Cyclius branch never runs |
| `fc_bank.js:46` | `B.officelevel` typo; guard never triggers |
| `fc_main.js:2669` vs `main.js:12639` | `fcWin` counts every non-shadow pool; the game counts only normal. Latent |

Five of these (precedence, unguarded shimmer pop, `countAntiMatter`, worship typo, `SI730`) are independently listed in commit messages of the fork `pc123177/FrozenCookies`. That fork was not audited here.

### Dead code [V by reference count]
`rebuildStore`, `rebuildUpgrades`, `getBuildingTooltip`, `getUpgradeTooltip`, `colorizeScore` (`fc_button.js:30-272`); `cyclePreference` defined twice and never called (`fc_main.js:714`, `fc_button.js:1115`); `writeFCButton`; `shouldClickGC` (marked unused); `cookieStats` (a near-copy of `cookieValue` with different constants); `weightedCookieValue`, `gcEfficiency` (only referenced from a commented block); `earnedRemaining`, `buildingRemaining`, `estimatedTimeRemaining`, `cumulativeProbability`; unused fields `timeTravelAmount`, `calculatedCpsByType`, `priceReductionTest`.

### TODO/FIXME
Only two real ones: `fc_main.js:31`, `fc_main.js:533`. The README mentions a "full code rewrite which may or may not materialize" (`README.md:146`).

### Performance hazards
- **Full recalculation is very expensive. [V]** Per candidate: two `Game.CalculateGains()` calls, two passes over every achievement, regex parsing and `eval`, several GC model evaluations. Candidates are all unbought upgrades with known prerequisites plus 20 buildings. Up to 10 recalculations per tick, and one after every purchase. Estimated at several hundred `CalculateGains` calls per recalculation mid-game. [I for the number]
- Anything that moves CpS continuously forces constant recalculation: Cyclius (issue #175, "1 fps") and Century egg. The 0.01% threshold from July 2025 is a mitigation.
- `updateTimers` every frame; full menu rebuild every second.
- The README lists lag as a known issue (`README.md:746`).

### Fragility
- **Simulation mutates live state with no `try/finally`. [V]** An exception mid-simulation leaves phantom buildings or a phantom owned upgrade in the real game. [I for consequence]
- **`autoCookie` has no error handling. [V]** Any throw leaves `processing = true` and breaks the timer chain; the bot stops until reload. Consistent with issues #153 and #162. [I]
- **`eval` rewrites of `popFunc` and `UpdateWrinklers`** (`:269-281`) re-create game functions outside their closure. The authors already had to copy `inRect` (`:2689-2705`). Any game update adding a closure reference breaks golden cookies or wrinklers.
- `Game.Win` is replaced wholesale and has drifted from the game's version.
- `upgradeJson`, `cookieInfo`, `BuildingSpecialBuff` names (`fc_spells.js:198-245`), the 20-element building array (`fc_main.js:1478-1499`) and hardcoded upgrade ids all need manual edits per game update.
- Known conflict with Cookie Monster (`README.md:45`, issue #176).

---

## 7. Maintenance signal

Source: `gh` CLI, authenticated.

- **Last commit:** 2025-07-27. None in the 14 months since.
- **Commits per year:** 2022: 638; 2023: 112; 2024: 12; 2025: 100; 2026: 0.
- **Last 24 months:** 100 commits in two bursts, May 2025 (65) and July 2025 (35). The July burst was mostly one outside contributor, DragonHeart996.
- **Latest tagged release:** 2.025, May 2023; the version string says 2.052.8.
- **Issues:** 9 open, 95 closed. 0 open PRs. 41 stars, 20 forks.
- **Maintainer:** still answers issues (replies April and May 2026, restored the domain May 2026) but ships no code. Open issues #203 and #204 have no reply.
- **Branches:** `performance-update` and `work-in-progress`, both last touched 2025-07-21.
- **Upstreams:** Icehawk78 and Mtarnuhal both dormant since 2022.
- **Active forks:** `canacel3/FrozenCookies` (pushed 2026-09-24) and `pc123177/FrozenCookies` (pushed 2026-08-09, with a TypeScript rewrite branch and a claimed heavenly-upgrade buyer). That author opened and closed two PRs against this repo in August 2026 without merging. Not audited.

**Recurring complaints:**
1. Lag and freezes (#175, #176, README).
2. Autobuy ignoring limits or settings (#201, #204, #186, #132, #153, #162).
3. Combos unreliable (#144, #141, #170, #152, #139).
4. Auto-ascend not firing (#147, #172).
5. Hosting and offline dependence (#142, #202, #161, #174).
6. GC timer inaccuracy (#61).
7. Breaking challenge runs (#157, #158, #169, #187).

The maintainer's own replies include "I can see the problem in your save but I can't explain it" (#165) and "so deep in the code I am not going to be able to fix it without a full rewrite" (#61).

---

## 8. Fork suitability

**Judgement: a good reference and data source, a poor foundation.** Forking to fix the loader and the listed bugs is cheap. Building significant new automation on the existing structure will fight you.

**Worth keeping:**
- The core idea of measuring delta CpS through the game's own `CalculateGains`. It survives game formula changes.
- The FTHOF seeded predictor and the dragon-petting predictor.
- `upgradeJson` as data.
- The preference schema shape.
- Rigidel lump harvest.

**What will fight new work:**
- No modules, no tests, no build. Function-object state.
- Subsystems coordinate by overwriting user preferences. Every new automation that must pause another inherits that bug class.
- The optimizer, its cache and the GC model are interleaved in one 3,779-line file.
- The current maintainers do not fully understand the inherited core.
- No license.

**Cheaper to rewrite than extend:**

| Module | Why |
|---|---|
| Loader (`frozen_cookies.js`, Steam `main.js`) | Small, and mandatory for a self-contained fork |
| `fc_spells.js` | About 2,000 lines, mostly one condition block copied around 12 times and a mana table copied twice. A predictor returning an enum with a fail-chance parameter plus one generic combo machine would be a fraction of the size and fix the second-cast error |
| GC valuation (`cookieValue`, `cookieInfo`, probability tables) | Outdated odds, missing effects, fps-dependent tables, wrong click cap. Patching costs more than re-deriving |
| Optimizer orchestration (`updateCaches`, `recommendationList`, `buyFunctionToggle`) | Keep simulate-and-measure. Replace regex and `eval` with an explicit list of side-effecting upgrades, add `try/finally`, cache per item, add achievement-threshold awareness |
| Auto-ascend | About 60 duplicated lines. Needs a new rule and a heavenly upgrade buyer |
| Reward-cookie patch (`fc_main.js:3700-3779`) | Delete and fold into chain logic |

**Reasonable to extend in place:** `fc_preferences.js` (add numeric types), `fc_gods.js` (fix typos, compute Cyclius from the formula), `fc_bank.js`, `fc_infobox.js` (throttle it).

**Entirely new work whichever base you choose:** garden, stock trading, Shimmering Veil, lump spending and type strategy, wrath policy, delayed GC clicking, dynamic gods and auras.

**Options:** the two honest options are (a) fork, fix the loader and the section 6 bugs, and accept the architecture for modest additions; or (b) start a clean modular codebase and port the four or five good ideas. If the goal includes garden, market and heavenly upgrade automation, (b) is the recommendation of this audit, because those need a scheduler in which subsystems can reserve resources without editing each other's settings, and that does not exist here. Before either, look at `pc123177/FrozenCookies` to avoid duplicating a rewrite already in progress, and ask erbkaiser for a license.
