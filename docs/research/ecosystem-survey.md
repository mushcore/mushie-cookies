# Cookie Clicker modding ecosystem survey (excluding Frozen Cookies)

Research snapshot, 2026-09-29. Analysed against Cookie Clicker v2.053 (Steam).

## 0. Scope, method, and caveats

**Path roots used below:**
- `<repos>` = a working directory holding shallow clones of the surveyed repositories, one folder per repo named `<owner>_<repo>`.
- `<web>` = a working directory holding files fetched from the web (Workshop metadata, pastebins, single-file mods).
- `<game>` = the game's `resources/app` directory (read only, never modified). Game source files live under `<game>/src`.

**Evidence levels used in this report:**
- **[SRC]** = the mod's source was read in a clone.
- **[GAME]** = checked against the game source. `<game>/src/index.html:17` says `VERSION=2.053`.
- **[API]** = Steam/GitHub public API numbers fetched on the snapshot date (2026-09-29).
- **[WIKI]** = cookieclicker.wiki.gg, read through a fetch summarizer. Treat numbers as needing a second look unless also marked [GAME].
- **[CLAIM]** = author's own description, not verified here.

**Things to know up front:**
- Newer game version signals: Cookie Monster `package.json` says 2.058.0, and a Workshop item is titled "v2.058 Compatible". Cookie Monster's HEAD handles an upgrade ("Wrinkler ambergris") that does not exist in the 2.053 `main.js`. Expect version drift when pulling current mod builds.
- Game v2.053 has 20 buildings, so 18 stock goods. Several mods hard-code 16 or 17.
- Not read at source level (Workshop-only, description only): The Best Autoclicker, Grandma's Rolling Pin, Phena's Automation, Automation+, AutoStockAdvisor, Auto Stocks, stock assistant.

## 1. Comparison table

| Mod | What it does | Automates? | Popularity [API] | Last update | License | Steam | Size / quality |
|---|---|---|---|---|---|---|---|
| Cookie Monster | Payback-period advisor, stats, timers | Advise only | 547 stars; Workshop 104,885 lifetime subs | 2026-02-14 | MIT | Yes (Workshop item is a remote loader) | 10.6k lines, modular, linted, tests. Best engineered |
| CCSE | Modding framework (code injection, menus) | n/a | Workshop 379,748 (most subscribed) | 2026-04-29 | MIT | Yes | 4.1k lines, one file |
| Fortune Cookie | Predicts Grimoire outcomes | Advise | Workshop 13,245 | 2025-02-05 | MIT | Yes | 568 lines |
| Horticookie | Per-tile next-tick garden probabilities | Advise + 3 auto-harvest toggles | Workshop 35,123 | 2025-02-05 | MIT | Yes | 1.2k lines |
| Idle Trading | Threshold stock trader | Automates | Workshop 30,185 | 2025-02-05 | MIT | Yes | 225 lines |
| Cookie Garden Helper (yannprada) | Replant a saved plot, auto-harvest | Automates (no planning) | 15 stars | 2026-01-24 | MIT in package.json, no LICENSE file | Browser | ~720 lines |
| aisair fork | Same, older | Automates | 0 stars | 2020-06-07 | none | Browser | stale, no reason to use |
| Cookie Garden Helper Reloaded (Chakaa) | Above plus per-level mutation layouts, soil rotation | Automates | 19 stars; Workshop 90,273 | 2023-10-30 | none | Yes | 1.4k lines |
| Insugar Trading | Price histograms from 1000-year simulation | Advise | 25 stars | 2026-03-21 | GPL-3.0 | Not verified | TypeScript, tested |
| Choose Your Own Lump | Predicts/plans next sugar lump type | Advise | 5 stars | 2026-05-04 | GPL-3.0 | Not verified | TypeScript, tested, web worker |
| Spiced Cookies | Bug patches, stock delta/mode display | Mostly patches | 6 stars | 2021-12-27 | GPL-3.0 | Not verified | TypeScript, "alpha" |
| Auto Cookie (Elekester) | 6 simple automations | Automates | 1 star | 2024-09-01 | MIT | Needs wrapper | 687 lines, clean but thin |
| CookieClicker-Automation (SteeleRobert) | Console scripts: garden unlock, stock, dualcast | Automates | 8 stars | 2024-07-15 | none | Console paste | 1.1k lines, hard-coded |
| Cookie Assistant (hitsub) | Broad toggle-based automation | Automates | 22 stars; Workshop 171,320 | 2022-06-03 (Workshop) | MIT | Yes, native | 1.56k lines, naive logic |
| Uncanny Cookie Clicker | Chrome extension autoclick/autobuy | Automates | 38 stars; ~100k Chrome users [CLAIM] | 2023-03-11 | MIT | No | ~1.3k lines |
| Cookie Profit Predictor (now "Cookie Payback Planner") | Payback ranking with lookahead, auto-buy | Both | 10 stars; Workshop 21,068 | 2024-09-30 (repo) | GPL-3.0 | Yes | 948 lines |
| Auto Buy Mod (drblaui) | Buys the cheapest thing | Automates | Workshop 8,219 | 2024-01-27 | GPL-3.0 | Yes | 369 lines, nothing to borrow |
| Auto Click and Buy Mod (ACABM) | Autoclick plus efficiency auto-buy | Automates | Workshop 24,194 | 2025-02-25 | GPL-3.0 | Yes | 1.8k lines, class-based |
| CookiStocker 2 | Mode-aware stock trader | Automates | Workshop 33,476 | 2025-10-15 | none stated | Yes | ~1.6k lines |
| Auto Sacrifice: Fully AFK Garden | Full seed log then sacrifice loop | Automates | Workshop 37,132 | 2022-10-27 | none | Yes | 2.0k lines |
| garden-gnome (bdunks) | Same goal, measured performance | Automates | 1 star | 2026-03-09 | MIT | Browser | TypeScript, ~1.4k lines, clean |
| CookieBot (prinzstani) | Full automatic playthrough to all achievements | Automates everything | 65 stars | 2024-12-15 | GPL-3.0 | Yes (loader) | 2.35k lines, one file |
| QuantBroker (itCarl) | Online-quantile stock trader | Automates | 0 stars, repo 1 day old | 2026-09-28 | MIT | Yes [CLAIM] | 1.96k lines plus test harness |
| Clairvoyance | FtHoF forecast | Advise | Workshop 19,646 | 2025-02-15 | not stated | Yes | 203 lines |

**Other top Workshop automation items [API], lifetime subscribers:**
- The Best Autoclicker: 146,555
- FortuneHelper: 125,411
- Auto-Click Golden Cookies: 49,654
- stock assistant: 47,038 (display only)
- Grandma's Rolling Pin: 35,542
- Price to CPS Ratio: 28,141
- Ascension Helper: 18,554
- Phena's Automation: 14,678
- AutoStockAdvisor: 12,699
- Automation+: 10,537
- Frozen Cookies (erbkaiser fork, comparison only): 8,942

The full top-90 list with counts was captured as `<web>/details.json`.

## 2. Per-mod findings

### Cookie Monster [SRC]
**Payback period (PP):**
- Formula: `pp = max(price - (cookies + wrinklerBank), 0) / cookiesPs + price / bonus`.
- Buildings: `<repos>/CookieMonsterTeam_CookieMonster/src/Cache/PP/Building.js:60-64`.
- Upgrades: `.../src/Cache/PP/Upgrade.js:11-17`. NaN becomes Infinity.
- First term is time to afford; second is time to repay.

**How `bonus` is computed:**
- Full state copy, then apply the purchase, then a re-implemented `CalculateGains`.
- It awards achievements the purchase would trigger and recalculates, so milk/kitten gains are included (`.../src/Sim/SimulationEvents/BuyBuildingBonusIncome.js:14-52`, `.../src/Sim/Calculations/CalculateGains.js:27-239`).
- Evaluated for buying 1, 10 and 100.

**Non-CpS upgrades:**
- They get no bonus, so PP is Infinity (grey).
- Click upgrades get a separate `bonusMouse` (`.../src/Sim/SimulationEvents/BuyUpgrades.js:154-158`) that is not folded into PP.
- This is the main hole to fill.

**Other reusable calculators:**
- Lucky bank: `cps*900/0.15`, times 7 for Frenzy (`.../src/Cache/Stats/Stats.js:27-38`).
- Chain cookie bank (`.../src/Cache/Stats/ChainCookies.js:30-50`).
- Chocolate egg sell-all value with Earth Shatterer (`.../src/Sim/SimulationEvents/SellBuildingForChoEgg.js:15-56`).
- Aura change delta and cost (`.../src/Sim/SimulationEvents/AuraChange.js:20-55`).
- Post-ascension CpS delta (`.../src/Sim/SimulationEvents/ResetAscension.js:19-87`).
- Heavenly chips per second, 5-second average (`.../src/Cache/Stats/HeavenlyChips.js:14-38`).

**Integration point:** results are published on `window.CookieMonsterData` (`.../src/Cache/PP/PP.js:20-26`). CookieBot consumes this.

**Steam note:** the Workshop item (id 2685721341) is a one-line `main.js` that loads remote JavaScript from github.io at runtime. It needs network and is unpinned.

### CCSE and klattmose mods [SRC]
**CCSE:**
- Rewrites game functions by editing their source text (`<repos>/klattmose_klattmose.github.io/CookieClicker/CCSE.js:225-267`).
- Exposes `Game.customMinigame[...]` hook arrays.
- Useful as a UI/menu helper. Most Steam mods depend on it.

**Fortune Cookie (FtHoF prediction), confirmed against [GAME] `minigameGrimoire.js:289-314` and `main.js:5316-5355`:**
1. `Math.seedrandom(Game.seed + '/' + spellsCastTotal)`.
2. First `Math.random()` is the fail roll. Success if `roll < 1 - failChance`.
3. `failChance = 0.15`, times 0.1 with Magic adept, times 5 with Magic inept, times `(1 + 0.1*SupremeIntellect)`, plus `0.15 * goldenCookiesOnScreen`.
4. Shimmer creation consumes one random call only if the season is Valentine's or Easter, then two more for x and y.
5. Success pool: Frenzy, Lucky, and Click Frenzy unless Dragonflight is active. Then in order:
   - `<0.1` adds Cookie Storm twice and Blab.
   - `BuildingsOwned>=10 && <0.25` adds Building Special (short-circuits, so the call is skipped under 10 buildings).
   - `<0.15` replaces the pool with Cookie Storm Drop.
   - `<0.0001` adds a sugar lump.
   - Then `choose()`.
6. Backfire pool: Clot, Ruin. `<0.1` adds Cursed Finger and Elder Frenzy. `<0.003` adds a lump. `<0.1` replaces with Blab.
7. Code: `.../FortuneCookie.js:268-316`.

**Discrepancy found:**
- Fortune Cookie marks its second column active for Valentine's, Easter, Business Day and Halloween (`FortuneCookie.js:410`).
- In 2.053 only Valentine's and Easter consume the extra call.
- Clairvoyance (`<web>/clairvoyance.js:117`) and FtHoF Planner v3 (`<repos>/Eminenti_FtHoF-Planner-v3/index.js:183`) agree with the game.
- The chime no longer matters: `pitchSupport=false` at `<game>/src/main.js:887`.
- Consequence: toggling Easter/Valentine's gives a choice of two outcomes per cast.

**Gambler's Fever Dream:**
- Spell choice uses seed N; the inner cast resolves with seed N+1 at fail chance `max(fail, 0.5)` (`FortuneCookie.js:475-511`, [GAME] `minigameGrimoire.js:195-216`).
- The 1-second delay enables "scrying" and cast skipping, documented in `<repos>/staticvariablejames_SpicedCookies/doc/GFD.md`.

**Horticookie:**
- Parses the game's own `getMuts` source to build the recipe table (`Horticookie.js:261-342`), so it follows game updates.
- Computes exact per-tile next-tick probabilities by enumerating neighbour outcome combinations (`:596-699`).
- Models plant aging probability (`:205-242`) and the 3 wood-chip loops (`:687-692`).
- Best available garden probability engine, but it does not plan.

**Idle Trading:**
- Fixed per-good dollar thresholds, default disabled. Each tick: buy max if `price <= buyThresh`, sell all if `price >= sellThresh` (`IdleTrading.js:193-210`).
- Can import thresholds from Insugar Trading's lowest/highest displayed quantile (`:165-181`).

**Klattmose Utilities:** sample "Dump Wizards" hotkey sells towers down to the count whose max magic just covers current magic (`.../KU config.js`, third hotkey). This is the exact dualcast sell count.

### Cookie Garden Helper family [SRC]
- yannprada/aisair: state machine per tile (young/mature/dying) plus replant of a saved plot. No mutation planning (`<repos>/yannprada_cookie-garden-helper/src/Garden.js:108-189`).
- `src/Garden.js:45` references an undefined `plant`; the built file is correct (`cookie-garden-helper.js:98`).
- Chakaa's Reloaded version is the one worth reading:
  - Hard-coded parent table for all 34 plants (`<repos>/Chakaa_cookie-garden-helper-reloaded/CookieGardenHelper-reloaded/main.js:1103`).
  - Mutation layouts for every farm level 1 to 9, for one-parent and two-parent recipes (`:542-621`, `:700-754`).
  - Soil rule: fertilizer when young plants are at least as numerous as mature, otherwise clay or wood chips (`:1131-1163`).

### staticvariablejames [SRC]
**Insugar Trading:**
- 3,600 histograms: bank levels 1 to 50, 4 aura combinations, 18 goods, $0.10 bins, 525,960,000 ticks each [CLAIM for tick count].
- CDF/quantile by binary search with linear interpolation (`<repos>/staticvariablejames_InsugarTrading/src/dataset.ts:149-207`).
- Default highlight at 25% and 75% quantiles (`src/settings.ts`).
- Bank level 1 medians from its README: CRL 21.94, CHC 26.66, up to YOU 136.29. First quartile CRL 6.37.
- The simulator is the separate `<repos>/staticvariablejames_CookieClickerCppTools`.

**Choose Your Own Lump:**
- Lump type is seeded by `Game.seed + '/' + lumpT`.
- Algorithm at `<repos>/staticvariablejames_ChooseYourOwnLump/src/planner/core.ts:103-135` matches [GAME] `main.js:4522-4539`.
- Pool per loop: bifurcated 10% (15% with Sucralosia), golden 0.3%, meaty 10% times grandmapocalypse stage, caramelized 2%.
- Loops: 1, plus 1 with Dragon's Curve.
- It enumerates grandma count, Rigidel slot, auras and grandmapocalypse stage to shift the auto-harvest millisecond.
- Requires an export/reload cycle and suffers a 1 to 2 ms "discrepancy".

**cookie-connoisseur:** Playwright test harness with a save-file parser (`<repos>/staticvariablejames_cookie-connoisseur/src/ccsave.ts`, 3.5k lines). Useful for automated testing of a bot.

### Auto Cookie [SRC]
- A small framework of interval-driven actions.
- Godzamok loop sells and rebuys all cursors each interval, only if Godzamok is slotted and a mouse upgrade is owned (`<repos>/Elekester_AutoCookie/AutoCookie.js:422-432`).
- No purchase optimiser. Dualcast is an unimplemented TODO (`:6`).

### CookieClicker-Automation (SteeleRobert) [SRC]
**Stock thresholds:**
- `simulate.py` is a line-for-line port of the game tick (matches [GAME] `minigameMarket.js:803-877`).
- Runs 100,000 ticks once, then grid-searches (step 2.5) the buy/sell pair maximising profit per stock (`<repos>/SteeleRobert_CookieClicker-Automation/simulate.py:111-144`).
- Weaknesses:
  - Single trajectory.
  - Profit counted at the sell threshold, not the actual price.
  - Ignores overhead.
  - Not mode-aware.
  - 17 goods.
  - README says level 10 but code uses level 7.
- The idea is right; the implementation overfits (e.g. buy CRL under $4.30, `components/StockMarket.js:4-22`).

**Dualcast:**
- Casts FtHoF when `cookiesPs/unbuffedCps > 1000`, or click power exceeds `unbuffedCps*threshold*777/4`.
- Then sells towers one at a time until max magic drops to current magic, casts again, rebuys to 460 (`components/Grimoire.js:54-72`).
- Lump refill variant at `:74-113` requires more than 100 lumps.

**Garden:**
- Dependency table (`components/Garden.js:520-672`) plus fixed 6x6 layouts per recipe type.
- Plants the slower-maturing parent first and delays the faster one so they mature together (`:234-254`).
- JQB uses an 8-ring layout while breeding other seeds on the edges (`:772-800`).
- Requires a 6x6 plot.

### Cookie Assistant [SRC]
- Buys every affordable upgrade and every affordable building in id order, in round lots (`<repos>/hitsub_CookieAssistant/main.js:579-727`). No efficiency calculation.
- FtHoF cast when buff count reaches a configured number (`:487-540`).
- Borrowable pieces:
  - Season cycling until each season's drops are complete (`:618-690`, `:1037-1080`).
  - Dragon petting using the seeded drop schedule (`:733-741`).
  - Chocolate egg on ascend (`:1090-1111`).
  - Configurable sell/cast/rebuy slots for Godzamok (`:932-1027`).

### Uncanny Cookie Clicker [SRC]
- Chrome extension only.
- Buys the cheapest affordable building (`<repos>/builtinnya_UncannyCookieClicker/src/js/modules/gameClient.js:382-392`).
- Nothing worth borrowing.
- Its "speed up" writes to `Game.accumulatedDelay` (`:320-327`).

### Cookie Profit Predictor / Cookie Payback Planner [SRC]
- Same project. Internal id "BestDealHelper", Workshop 2689045003.
- Metric: `ΔCpS / (waitTime + paid/newCpS)` (`<repos>/cometjc_Cookie-Payback-Planner/main.js:394-399`).
- Simulates by mutating the live game and calling the real `Game.CalculateGains()` with `Game.Win` stubbed (`:344-367`).
  - Always matches the running game version.
  - Misses achievement milk gains.
- Two ideas worth taking:
  - Multi-buy lookahead up to 50 units, including the next tier upgrade if within 15 buildings (`:401-434`).
  - "Helper" chain: if the best item is unaffordable, find cheaper purchases that shorten time-to-target (`:441-491`).
- Bank reserve is a user-set number of seconds of raw CpS (`:312-333`).

### ACABM [SRC]
- Score: `base² × (new − base) / price²` (`<repos>/elliotks_ACABM/ACABM/main.js:235-237`).
- Zero-CpS upgrades are bought when `price < sqrt(cookiesEarned × cookiesPs)` (`:307-329`).
- "Protect" reserve is `(Frenzy ? 1 : 7) × cps × 1200` (`:1127-1130`). This does not match the standard 6000/42000 multiples.

### CookiStocker 3.02 [SRC, from the Pastebin linked in its Steam guide]
File: `<web>/pastebin_Rnj3YSxk.txt:569-711`. It reads the hidden `good.mode`.

**Constants:**
- `alwaysBuyBelow=2`, `neverSellBelow=11`, `smallDelta=3`, `largeDelta=4`.
- Ceiling: `max(10*(i+1)+bankLevel+49, 97+bankLevel*3)`.

**Counters:**
- Consecutive rise/drop ticks.
- Reset on a mode change into 3 (not from 1), 4 (not from 2), 1 (not from 3), or 2 (not from 4).

**Required streak:** 3 if the mode is unchanged and you are either holding in a falling mode or not holding in a rising mode; otherwise 4.

**Buy** if price < 2, or if mode is not 4 and the price is below ceiling (or mode is 1 or 3) and any of:
- Price rose and rise streak reached the threshold.
- Mode just changed to 1 or 3.
- Mode is 0, nothing sold yet, drop streak under threshold, price at least 10.

**Sell** if holding, price at least 11, and either:
- Price fell with drop streak at threshold.
- Mode just changed to 2 or 4.

**Gates:** at least 72 brokers (overhead about 0.5%) and cost to fill under 5% of bank.

Author claims about $15M/day [CLAIM]. No license, so reimplement rather than copy.

### Auto Sacrifice and garden-gnome
**Auto Sacrifice [CLAIM from README, code skimmed]:**
- Published seed order (34 steps, queenbeet line first) in `<repos>/LabyrinthX_autosacrifice/README.md`.
- "Parlay" mutations: use a long-maturing parent for a second recipe before its first harvest.
- 5x5 JQB layout using the 11 spare tiles.
- Surrounds a growing JQB with 8 elderwort.
- Claims just over 4 days per sacrifice with Supreme Intellect.
- Requires 6x6.

**garden-gnome [SRC]:**
- Target priority: queenbeet, JQB, everdaisy, tidygrass, then the rest (`<repos>/bdunks_garden-gnome/src/mutationStrategy.ts:38-47`).
- Sticks to the current target.
- Planting sync: plant the slowest first, plant others only when they mature at or after the planted ones, with at least 2 ticks overlap before decay (`src/gnome.ts:303-338`).
- Dead-end detection using the game's own `getMuts` (`:99-124`).
- Keeps only the oldest locked sprout per species (`:166-215`).
- No planting during short buffs but allows loans (`:271-292`).
- Measured over 1,000 simulated runs: mean 5d17h, median 5d1h, min 2d23h, max 17d5h [CLAIM, from its README].

### CookieBot [SRC]
File: `<repos>/prinzstani_CookieBot/cookieAutoPlayBeta.js`.

**Purchasing:**
- Uses Cookie Monster PP if present.
- Patches in pseudo-bonuses for zero-CpS upgrades as a fraction of CpS (`:404-443`):
  - Lucky day, Serendipity, Get lucky: 0.5 each.
  - Golden goose egg: 0.05.
  - Mouse upgrades: `AverageClicks*0.01`.
  - Season upgrades: 0.01 to 0.1.
- Buys lots of 10 when Rigidel is slotted (`:446-456`).

**Bank:**
- `6000 × unbuffedCps`, times 7 after Get lucky.
- Ramped linearly over 400 minutes after a 30 minute delay.
- Only after both golden cookie upgrades (`:301-367`).

**Sugar lumps (`:707-743`):**
1. Unlock the 4 minigames.
2. Farm to 9.
3. Cursor to 12 while keeping 100.
4. All buildings to 10.
5. Cursor to 20.

**Garden:** four 3x3 sectors running four mutation targets in parallel (`:1027-1119`).

**Ascension (`:1624-1725`):**
- Driven by an achievement list.
- Ascends when prestige digits allow Lucky digit/number/payout.
- Otherwise when days in run exceed `(40*(prestige+1e9)/(ascendMeterLevel+1))²`.

**Warning:**
- It contains deliberate game-state manipulation: golden cookie timer manipulation `:242-270`, lump time and type overrides `:665-700`, synthetic clicks `:294-298`.
- It sleeps 23:00 to 07:00.
- These are configurable but on some paths by default.

### QuantBroker [SRC for mechanism, CLAIM for results]
- Online quantile estimate per good: step up by `lr*p` when price is above the estimate, down by `lr*(1-p)` below (`<repos>/itCarl_CookieClickerMod-QuantBroker/mod/main.js:360-364`).
- Buy at 34th percentile, sell at 66th, minimum margin 2% (`:39-49`).
- Detects the market-wide shock event cross-sectionally (`:398-430`).
- `moddev/market.js` is a seeded transcription of the game tick. The README says it loads the game's own source; the file read here is a hand transcription.
- The "+28%" result is unverified and the repo was one day old at the snapshot date.

## 3. Questions

### Q1. Credible bases other than Frozen Cookies (ranked)

1. **New mod on top of Cookie Monster's data, borrowing MIT parts.** This is the survey's recommendation.
   - Cookie Monster has the only well-tested simulation and is actively maintained.
   - MIT sources to draw on: Cookie Monster, Fortune Cookie, Horticookie, garden-gnome, QuantBroker.
   - The catch is that you write the control loop yourself.
2. **CookieBot.**
   - The only other mod that plays the whole game, including ascension and heavenly upgrades.
   - Against it: GPL-3.0, one 2.3k-line file, goal is achievements not optimality, embedded game-state manipulation and night mode to strip, primitive combos, targets 2.052.
3. **Cookie Assistant.**
   - MIT, Steam-native, widely used, readable.
   - Good scaffolding for settings UI and season/dragon chores, but every decision rule would be replaced.
4. **ACABM.**
   - Cleanest module structure among the auto-buyers, but GPL-3.0 and narrow.

Not credible as a base: SteeleRobert (no license, hard-coded), Auto Cookie (too thin), Uncanny (browser extension), CookiStocker and Auto Sacrifice (no license, single purpose).

### Q2. Community state of the art

**Purchase ordering**
- Buy the lowest Cookie Monster PP [SRC]. The wiki FAQ points to Cookie Monster [WIKI].
- Early rule of thumb: 15 of each building before moving on [WIKI].
- Keep 6000 × CpS banked for Lucky, 42,000 × with Frenzy [GAME `main.js:5536`: `min(15% bank, 900s CpS)+13`].

**Combo execution**
- Buff values [GAME `main.js:5493-5565`]:

| Buff | Multiplier | Base duration |
|---|---|---|
| Frenzy | x7 | 77s |
| Click Frenzy | x777 | 13s |
| Dragonflight | x1111 | 10s |
| Dragon Harvest | x15 | 60s |
| Elder Frenzy | x666 | 6s |
| Building Special | `1 + amount/10` | 30s |

- Durations double with Get lucky.
- Natural Click Frenzy is rare; FtHoF gives it about 25% per successful cast [WIKI].
- Standard combo: natural Frenzy plus Building Special or Dragon Harvest, then FtHoF for Click Frenzy [WIKI].
- Godzamok: +1% / 0.5% / 0.25% click power per building sold for 10s, additive onto an existing buff [GAME `main.js:7887-7899`].
- Max magic: `floor(4 + T^0.6 + 15*ln(1 + (T + 10(L-1))/15))` [GAME `minigameGrimoire.js:267`].
- FtHoF cost: `floor(10 + 0.6*maxMagic)` [GAME `:339-345`].
- Dualcast tower counts, first cast then sell down to [WIKI]:

| Tower level | "Optimal" | "First convenient" |
|---|---|---|
| 1 | 537 to 37 | 321 to 21 |
| 2 | 531 to 31 | |
| 3 | 524 to 24 | |
| 4 | 413 to 13 | |
| 5 | 407 to 7 | |
| 6 | 403 to 3 | |
| 7 | 610 to 10 | |
| 8 | 608 to 8 | |
| 9 | 604 to 4 | |
| 10 | 601 to 1 | 501 to 1 |

- Single-cast optimum is 38 max magic (55 to 57 towers at level 1) [WIKI].
- Endgame adds Golden Switch, Sugar frenzy, all three loans, and rapid Godzamok sells [WIKI].

**Garden**
- Mutation table is at [GAME] `minigameGarden.js:642-691`.
- Key rates: JQB 0.1% with 8 mature queenbeets, queenbeet 1%, bakeberry 0.1%, everdaisy 0.2%.
- Soils [GAME `:877-928`]:

| Soil | Tick |
|---|---|
| Fertilizer | 3 min |
| Dirt | 5 min |
| Clay | 15 min |
| Wood chips | 5 min, with 3 mutation loops |

- Wiki rule: always fertilizer, wood chips only while attempting bakeberry, queenbeet, JQB or elderwort; clay for passive buffs [WIKI].
- Sacrifice gives 10 lumps [GAME `:1509`], about every 5.5 days [WIKI].
- Garden ticks use unseeded randomness, so reload-scumming works (SugarScum automates it).

**Stock market**
- Resting value: `10*(id+1) + bankLevel - 1` [GAME `minigameMarket.js:261-264`].
- 1% pull toward resting per tick [GAME `:822`].
- Overhead: `20% × 0.95^brokers` [GAME `:212`].
- $1 equals 1 second of highest raw CpS [GAME `:211`].
- Heuristics in use:
  - Buy at or below 50% of resting and sell at or above 125% (AutoStockAdvisor [CLAIM]).
  - 25%/75% quantiles (Insugar).
  - Mode transitions (CookiStocker).
- The wiki says to buy on rises and sell when it turns, and that the market matters little next to combos [WIKI].

**Sugar lumps**
- Harvest at ripe, not mature: mature harvest fails 50% [GAME `main.js:4471-4483`].
- Spending order [WIKI]:
  1. 1 lump each on Wizard tower, Temple, Farm, Bank.
  2. 44 lumps for Farm to 9.
  3. 78 lumps for Cursor to 12.
  4. Hoard 100 for Sugar baking.
  5. Farm to 10.
  6. Then either Cursor to 20, or all buildings to 10.

**Ascension timing**
- Prestige = `(lifetime cookies / 1e12)^(1/3)` [GAME `main.js:3967-3971`].
- Wiki prestige targets per ascension [WIKI]:

| Ascension | Total prestige |
|---|---|
| 1 | 365 |
| 2 | 2,550 |
| 3 | 14,851 |
| 4 | 77,068 |
| 5 | 204,844 |
| 6 | 1,029,863 |
| 7 | 3,598,774 |
| 8 | 36,498,774 |
| 9 | 246,765,434 |
| 10 | 1,846,765,434 |

- After roughly the 23rd, at least double prestige each time [WIKI].
- First purchases at 365: Legacy, Heavenly cookies, How to bake your dragon, Box of brand biscuits, Heavenly luck, Permanent slot I [WIKI].
- Before ascending: pop wrinklers, harvest, sell stocks, then Earth Shatterer, sell all, and buy Chocolate egg (implemented in Cookie Assistant and CookieBot [SRC]).

### Q3. Gaps across the ecosystem

- **Combos:** no mod plans a combo end to end. Predictors do not act, and actors cast on buff-count thresholds without reading the seeded forecast. Nobody automates the season toggle that gives two FtHoF outcomes per cast.
- **Valuation:** no unified value function. PP covers passive CpS only. Click, golden cookie and combo income are handled by hand-tuned constants (CookieBot) or a square-root rule (ACABM).
- **Ascension:** timing and heavenly upgrade order are not optimised anywhere. CookieBot uses a days-based formula and then buys everything affordable.
- **Stock market:** no trader computes an expected-value policy from the fully readable state (mode, delta, duration) and the known process. Loans are not coordinated with combos.
- **Garden:** automation targets seed-log completion only. Nothing swaps to combo-support plants before a combo, and Horticookie's exact probabilities are not used for planning.
- **Pantheon and auras:** set statically; nobody swaps them around combos within the swap budget.
- **Sugar lumps:** fixed spending lists only; no cost-benefit against refills. Lump type planning needs manual save reloads.
- **Test infrastructure:** no full-game headless simulator exists. Only partial ones: market (C++ tools, QuantBroker), garden (garden-gnome-runner), Playwright harness.
- **Steam robustness:** several Steam items are remote loaders of unpinned code (Cookie Monster, CookieBot, Frozen Cookies). Many mods target 2.048 to 2.052.
- **Steam achievements:** a mod blocks them unless `info.txt` sets `AllowSteamAchievs: 1` (`<game>/mods/ReadMe.txt`).
