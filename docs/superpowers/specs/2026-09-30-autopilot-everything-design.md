# Autopilot that automates everything — design

Status: **in progress** 2026-09-30. Follows the owner's instruction: "default all to off. but a full autopilot mode would auto EVERYTHING. that should be the toggle."

Builds on [the main design](2026-09-29-mushie-cookies-design.md); its fair-play boundary (section 2) and licensing rules (section 4) apply unchanged.

## 1. Goal

Every option starts off. One switch, **Autopilot**, automates every part of the game a player can act on, each by expected value, with no further input, from a fresh save through ascension after ascension.

"Everything" is the list in section 3. A part is automated when a system owns it and makes a measured decision about it, including the decision to do nothing (for example, not taking a loan when no combo is coming).

## 2. Rules every system follows

1. **One owner per thing.** Each game resource (the bank, the season, each pantheon slot, each aura slot, the dragon, the garden plot, the wrinklers, each minigame's actions, sugar lumps) has exactly one owning system. Nothing else writes it. Where an inherited option does the same job, the Autopilot keeps it off and the new system stands aside while a player turns it on.
2. **One bank.** Spending goes through the buyer's reserve: a system spends only what the buyer is not holding, and a spend that competes with the buyer's next purchase is ranked against it.
3. **One buff classifier.** Systems ask a shared classifier whether a buff is an income spike worth finishing, a long buff (Sugar blessing, loans), or a debuff, instead of reading `Game.buffs` raw.
4. **Frame-driven.** New code runs on the mod's loop. The one exception is the clicker, which must fire between frames (the game counts one click per 20 ms; frames are 33 ms).
5. **Measured.** Each system comes with a harness measurement against the rule it replaces, reported with its spread across seeds, and a regression test for every defect fixed.

## 3. What is automated, and by which system

| Part of the game | Owner | State on 2026-09-30 |
|---|---|---|
| Buildings and upgrades | buyer | done (M2). In wave one: click power is read at the unbuffed CpS (each mouse upgrade adds 1% of the buffed CpS to a click, main.js:4692-4706), so a ranking made during a CpS buff is the one made without it, and the buyer ranks after each purchase through CpS buffs as between them. Luck-free with a forced Frenzy (77 s every 10 minutes, or 154 s every 5), over two game hours, that earned 1.23× and 1.55× the cookies of buying on down the ranking made before the buff |
| Clicking the big cookie | clicker | rebuilt in wave one (section 4.1): a self-scheduling pump, the measured click rate in the income model, the buyer standing aside during click buffs. In the game's own runtime, window shown, 8 tries over two sessions on a fully loaded machine: 44.3 accepted clicks a second (40.6 to 48.1) with no call turned away, against 33.1 (30.8 to 35.9) for a 50-a-second interval and 43.6 (39.7 to 47.5) for a 250-a-second one, which turned away 79% of its calls. During a Click frenzy with a rich bank: 38.8 (36.1 to 42.9) with the buyer standing aside, 23.4 (0.4 to 35.9) with it buying through. Minimized, no better than the interval: 29.9 (14.3 to 41.2) against 31.4 (6.3 to 41.0). In the harness all three reach the game's 50 |
| Golden, wrath and storm cookies, reindeer, news fortunes | shimmers | rebuilt in wave one (4.2): on its own guard, first on the loop each frame. Harness, 3 seeds of one game hour with a storm every five minutes: 0 missed an hour, as for the inherited popping (about 1,265 popped an hour); with a persistent failure injected into the inherited loop, the inherited popping missed all of them (1,241 to 1,263 an hour) and this system none. The hour-of-CpS fortune, drawn 4,000 times on each of 3 recorded 4-hour runs (buyer, clicker and golden cookies on, Auto Ascend off, so the "ascension imminent" branch never fired; each seed its own draws, both policies the same ones; tools/dev/shimmers.mjs fortune): 5.9× the expected payout in cookies of clicking it on sight (3.7×, 6.1×, 8.0×). In 34% to 68% of draws it was never taken before the run ended: the bank covered an hour of unbuffed CpS on only 6% to 11% of the ten-second tickers. Cookies paid early are counted at face value, not by what they would have bought since. An earlier figure of 7.1× took any fortune in a run's last ten minutes as if an ascension were imminent, which the code's predicate is not, and reused one set of draws for every seed |
| Wrinklers | wrinklers | rebuilt in wave one: keeps every slot feeding and pops the fattest ordinary wrinkler only when buying the next purchase sooner is worth more than the feeding lost; collects them all before every ascension the mod starts (a player's own ascension is left alone); the income model counts what the policy keeps. Luck-free over a day of full wrath with Unholy bait, 3 seeds: cookies 2.12x the inherited popping (2.10x to 2.14x), final CpS 2.45x (4.3) |
| Seasons, Santa, seasonal drops | seasons | nothing buys seasons or levels Santa; to build (4.4) |
| Dragon training and petting | dragon | rebuilt on branch w1/dragon: trains toward the level whose aura repays the chain's sacrifices within the run's expected length, holds Wizard tower levels for mana, pets with a private forecast; measured level with the inherited rule on income (4.5) |
| Dragon auras, pantheon | gods | done (M8), thrash fixed in review |
| Heavenly upgrades, permanent slots | ascension, heavenly | rebuilt in wave one (4.6): unlock-only upgrades bought for what they lead to, parents first; permanent slots by the income lost until the buyer rebuys the upgrade. Luck-free, 8 game hours, one run per start: projected prestige ×1.00, ×2.96 and ×46.2 from starts of 10^3, 10^6 and 10^9, heavenly upgrades owned 15/15, 25→41 and 27→63 |
| Ascension timing and the steps before it | ascension | done (M3); pre-ascension routine runs only for the mod's own ascension, wrinklers paid before the egg; the rest of 4.7 to rebuild |
| Sugar lumps: harvest, spend, Sugar frenzy | lumps | done (wave one): harvest, golden-lump timing and Sugar frenzy moved into the lump system, inherited harvest and Rigidel/Dragon's Curve steps removed, every target holds for Sugar baking once it is owned. Luck-free harness: 1.043 harvests a game day, as the inherited click (1.000 left to fall); a golden lump paid 2.9× to 4.9× the ripe harvest over three bakery stages, cookies over 3.5 h ×1.03 to ×1.19; Sugar frenzy timed to the rate rule gave ×1.09 and ×1.12 log-prestige per second of run (×1.13 and ×1.26 prestige per run, from starting prestiges of 1 and 3 million; it fired 1.2 h before the rule's ascension), while one switched on at the start of the run inflated the run average and the rule ascended after 1.3 h and 5.3 h (×0.35 and ×0.81); on a save with Sugar baking and 100 lumps the inherited order spent 99 (CpS ×0.51), the hold none |
| Grimoire | grimoire | done (M5). Double cast built on branch w2/doublecast (4.9), Autopilot on. From a late bakery, against casting one at a time, same seed: without natural golden cookies 3.1× to 16.8× the cookies over 8 game hours (4 seeds, geometric mean 6.1); with them, paired, 1.00× to 1.22× over 4 hours (4 seeds), with no double cast at all, since a natural boost would give the second outcome a buff anyway; the 1.22× is the cookies kept for the buy-back changing purchases. Holding the forced cookie still to add (4.9) |
| Garden | garden | done (M6), reserve fixed in review; harvest-combo mode to add (4.10) |
| Stock market trading | market | done (M7) |
| Bank office, brokers, loans | market | not automated; to build (4.11) |
| Godzamok, Golden switch | combos | inherited, net-negative as written; to build (4.12) |

## 4. Systems to build

Each entry names the decision, the value it maximises, and how it is measured. Game line references are to `main.js` and the minigame files of v2.053.

### 4.1 Clicker

A self-scheduling click pump: after each counted click, the next call is timed for 20 ms after the game's `lastClick`, and a rejected call retries at once. While a click buff runs (Click frenzy, Dragonflight), heavy what-ifs (buyer re-ranks, garden replans) are deferred, because they block the page and cost clicks exactly when clicks are worth most. The income model uses the measured accepted click rate instead of assuming 50 a second.

Measure: accepted clicks per second in the harness and on the game's own Electron runtime, against the interval clicker.

### 4.2 Shimmers

Golden, wrath and storm-drop cookies and reindeer are clicked on sight from the loop, under their own guard. Iteration copies the shimmer list first (popping splices it). News-ticker fortunes are clicked when they pay: a fortune upgrade and the fortune golden cookie on sight (taken before the frame's pops, so that cookie is popped in the same frame), the one-hour fortune once its payout, min(an hour of buffed CpS, the bank) (main.js:7646), is at least an hour of unbuffed CpS, which a CpS buff makes easier, or at any size while the mod's own ascension is about to reset it. Reindeer are popped before golden cookies: a Frenzy or Elder frenzy popped earlier in the same frame cuts a reindeer at once and raises CpS only on the next frame (main.js:5787-5789).

Measure: shimmers missed per hour; fortune payout against clicking on sight.

### 4.3 Wrinklers

Keep the maximum number attached and pop only when the cookies bought sooner are worth more than the lost feeding time (from the game's spawn formula, main.js:14361-14377); pop everything one tick before an ascension's other collection steps, and on a player-started ascension too. During a Halloween or Easter hunt, pop for drops only while the expected drop value beats the forfeited return. The income model's wrinkler state follows the policy.

Measure: cookies over a day of grandmapocalypse against the inherited "efficient" popping.

Built (src/core/wrinklers.js, src/game/wrinklers.js, src/systems/wrinklers.js). Every slot is left feeding; the fattest ordinary wrinkler is popped only when buying the buyer's next purchase sooner is worth more than the feeding its empty slot loses until the next spawn and the 10 s crawl (main.js:14361-14381). Nothing is popped while the next purchase is already affordable or while the buyer is off; several are popped at once when one does not cover the purchase; a shiny is never popped for a purchase and does not stop the others. Payouts carry every factor the game applies, Dragon Guts and Skruuia included (main.js:14467-14479). The income model counts the wrinklers the policy keeps on average (its measured pop rate and the spawn gap, and the refill still to come while slots are empty), and counts what they store as income only while popping is on. The inherited popping, with its Halloween/Easter pop-all branch (M3), is deleted; a hunt pops for drops only when the season system asks through `wrinklers.hunt({ season, value })` and the drops expected a second beat the income it forfeits. The ascension system collects the wrinklers a tick before the stock sale and the Chocolate egg; an ascension the player starts is held one frame while they pay. `autoWrinkler` is on or off (the old "instantly" mode is migrated to on); `shinyPop` is removed.

Measured with `tools/dev/wrinklers.mjs` (golden cookies off; a 1e15 bank and a small bakery; elder wrath 3 from empty slots, with Unholy bait; buyer on; 24 game hours; seeds w1, w2, w3; the wrinkler system of commit 2f0849a divided by the inherited popping of 1ca4dc0, same seed; `test/baselines/w1-wrinklers.json`): cookies made (earned plus what the wrinklers still hold) 2.12x, 2.14x, 2.10x; final CpS 2.41x, 2.47x, 2.47x. The inherited rule popped 25 to 28 wrinklers in the day and kept 9.9 of 10 attached; more than a third of its total was still inside the wrinklers at the end. The system popped 152 to 162, kept about 9.57 attached on average, and put the stores into purchases. It is behind in the first hour (0.98x on seed w3 and on a one-hour calibration run) while its first pops leave slots empty, ahead from the second (1.10x) and 1.5x by the fifth. Not measured: slots without Unholy bait (they refill five times slower), popping off altogether, and hunts, which wait for the season system to ask.

### 4.4 Seasons

One owner of `Game.season`, gated on owning Season switcher and on the reserve. Each run it plans which seasons to visit and in what order to collect seasonal upgrades cheapest (switch prices grow with `seasonUses`, drops reset each ascension), levels Santa to 14 while Christmas is on (`Game.UpgradeSanta`, about 2.35× CpS in total), buys A festive hat, and settles on the season whose standing value is highest. Reindeer and Santa enter the income model so Christmas can be valued. The real calendar season is respected: it costs nothing and switching away forfeits it.

Measure: CpS at the end of a run with and without the planner; seasonal upgrades collected per run.

### 4.5 Dragon

Train a level when the aura it leads to (a chain to the next rewarding level) repays the sacrificed buildings' rebuy cost before the expected ascension, within the reserve. Do not train a Wizard tower level while the grimoire holds mana above the cap the sacrifice would leave. Pet the dragon only at level 8 or more, when the current window's drop is not owned, forecasting the drop with a private generator as the fate forecast does (no reseeding of the game's generator).

Measure: CpS over a run against the inherited train-when-affordable rule.

Built (src/core/dragon.js, src/systems/dragon.js). Each target level is judged on the whole chain to it: the income its best aura adds (measured with the game's own calculation, one aura at a time; the Dragon cookie from level 26; the second slot at 27) times the expected time left, against the rebuy cost of every unit the chain sacrifices (the game's getSumPrice sum with modifyBuildingPrice) plus the building an aura switch costs. The expected time left is how long the run has lasted, at least an hour. A gain that needs an aura switch counts only if it clears the gods system's 2% switch threshold. Egg levels spend only above the buyer's reserve. While the mod casts, a Wizard tower level waits until the grimoire's mana is at or under the cap the sacrifice leaves. The chain is recomputed each second and a decision is taken again as soon as it changes. Petting pets once a second from level 8 while the quarter hour's drop is missing; the drop is forecast by the game's shuffle on a private generator. `levelsGained()` and `onLevelGained(fn)` let the gods system re-pick auras on the frame a level is gained (the hook in gods.js is not made yet). The inherited training and petting are deleted; the inherited rule is kept as `MushieCookies.dragon.options.rule = 'eager'` for comparison.

Measured with `tools/dev/dragon.mjs` (golden cookies off, a run started just after an ascension with the heavenly prestige multipliers and the dragon owned, buyer, clicking and gods on; 3 seeds; measured rule divided by the inherited rule, same seed):

| Start (seeds d1, d2, d3) | Cookies baked over the run | Final CpS | Radiant Appetite learned, measured vs inherited |
|---|---|---|---|
| prestige 10^6, grimoire and forecast casting on, 3 h (commit 874e7d7) | 0.98x, 1.01x, 1.03x (geometric mean 1.01) | 0.95x, 1.00x, 0.98x; averaged over the 10-minute samples 0.98x, 1.02x, 1.05x | 714 vs 716 s, 644 vs 634 s, 338 vs 628 s |
| prestige 10^4, 4 h (commit c8158ee, before decisions followed chain changes) | 1.04x, 0.99x, 1.00x (geometric mean 1.01) | 1.02x, 0.96x, 1.00x | reached by neither; the measured rule stayed at level 7, the inherited one went to 16 |

The two rules are level on income: every difference is inside the few percent that the order of purchases moves a luck-free run by (the same rule differs by 5% between seeds at prestige 10^4). The measured rule does not sacrifice for auras worth nothing to income: with golden cookies off, the inherited rule went on to levels 20-22 at prestige 10^6 and to 16 at 10^4 for golden cookie auras. The measured rule trains the chain to Radiant Appetite in one burst when the hundredth Prism arrives; in seed d3 it got there 290 s sooner because nothing had been sacrificed on the way. Casts were the same under both rules (10, 8, 10). Under both, the gods system equipped Radiant Appetite only at its next five-minute look (600-900 s); the level signal is there for it to do so at once. Levels 25-27 were not reached in these runs, so the horizon test on the last levels is covered by the game tests only. A third set (prestige 10^6 without the grimoire) was cut short when the shared machine was too loaded to launch browsers.

### 4.6 Heavenly planner

Value unlock-only upgrades by what they unlock (Synergies Vol. I and II, Pet the dragon, Fortune cookies, Season switcher, the cookie boxes, Stevia Caelestis leading to Sugar baking, the season prestige upgrades), by simulating the store upgrades and drops they open at current building counts. Choose permanent slots by the income lost until the buyer would buy the upgrade again, not by the share lost at the end of the run.

Measure: prestige per day over several ascensions against the current planner.

Built (w1/heavenly): the planner ranks bundles, an upgrade with every ancestor it still needs, by the share they add together per chip, so any depth of worthless parents is walked (the angels to Kitten angels, Heralds to Season switcher, Golden switch and Residual luck to Pet the dragon). What an upgrade opens is simulated at current building counts: cookies that require it, the synergy tiers, the dragon's drops, fortunes and seasonal drops, each counted only when the run bakes ten times its price and only while the system that uses it is on (season planner, petting, fortunes, Sugar frenzy). Lump upgrades are worth their extra lumps a day times a lump's value, averaged over the next run; Sugar craving two hours of CpS a run; the season boosts and Keepsakes part of the drops they speed up. Fixed shares remain only for what no what-if can show (the dragon, offline production, discounts, research speed, the Golden switch itself). Permanent slots: share times the cookies the run had baked when the buyer bought the upgrade, recorded by the heavenly system on the loop (src/systems/heavenly.js).

Measured with tools/dev/heavenly-ab.mjs against the planner it replaces (commit 1ca4dc0), same seed and start, 8 game hours. Each run starts just after a first ascension at the start prestige, with the starter upgrades owned and a bank that doubles its prestige; buying, clicking and ascension on. The candidate build was ab9e453 (later commits add only a cache and tests).

| Start prestige | Projected prestige after 8 h | Heavenly upgrades owned | Ascensions in the 8 h |
|---|---|---|---|
| 10^3, golden cookies off | 2,570 vs 2,570 (×1.00) | 15 vs 15 | 1 vs 1 |
| 10^6, golden cookies off | 3.68e6 vs 1.09e7 (×2.96) | 25 vs 41 | 2 vs 4 |
| 10^9, golden cookies off | 2.04e9 vs 9.45e10 (×46.2) | 27 vs 63 | 1 vs 10 |
| 10^9, golden cookies on, seed g1 | 4.23e9 vs 3.81e12 (×902) | 30 vs 73 | 9 vs 11 |
| 10^9, golden cookies on, seed g2 | 3.16e9 vs 3.53e12 (×1118) | 29 vs 73 | 10 vs 12 |

At 10^3 the chips cover only the upgrades both planners buy first. At 10^9 the old planner stopped at 27 upgrades and left 1.60e9 of its 2e9 chips unspent after the first ascension (CpS an hour in: 4.2e31 against 1.3e37); the new one bought the angels, Synergies Vol. I and II, Kitten angels, the Stevia line to Sugar baking and the lump upgrades, and the Unshackled upgrades. The golden-cookie rows are two seeds at one start; the runs at 10^6 with golden cookies on did not finish (a browser launch timeout, and a run cut off at 7 h). After merging m2-buying (dragon, lumps and buff classifier; commit 36502db against m2-buying at 2c42063), a 3-hour luck-free re-run gave the same numbers as the runs above at 3 h: ×1.54 at 10^6 and ×15.2 at 10^9.

Not measured: the A/B leaves petting, fortunes and Sugar frenzy off, so what Pet the dragon, Fortune cookies and Sugar craving open is covered by the unit and game tests only; with no season planner on this branch, Season switcher and the season boosts are worth nothing to the planner yet.

### 4.7 Pre-ascension routine

Collect in order, one tick apart: pop wrinklers, sell stock, then the Chocolate egg with a legal Earth Shatterer swap (dragon level 9 or more) when the egg's gain beats the sacrificed building. Wait only for short income buffs. Take the run's baseline at reincarnation, not at mod launch.

Measure: chips per ascension against the inherited routine.

Fixed on branch w1/wrinklers (item pre-ascension): the routine (`prepareForAscension`) runs only for the mod's own ascension, before `Game.Ascend`. The inherited `fcReset` ran it for every ascension the player started too, at Reincarnate: on the ascension screen, where a player can neither sell nor buy, with every option off, after the chips were granted, and with popped wrinklers that could no longer pay (main.js:4094, 4125, 16165, 3532). It now leaves a player's ascension alone; only the wrinkler system, with its option on, collects before one. Wrinklers are popped a tick before the rest, so their payout is in the bank for the harvests and the egg. What the other steps gain, by the game's code: stock and building sales only add to the bank (minigameMarket.js:252-253, main.js:7873-7874), which the reset wipes, so they count toward prestige only through the egg's 5% of the bank (main.js:10398-10403); a stock sale can also earn a stock market achievement, which is kept. Goods bought in the current market minute cannot be sold (minigameMarket.js:243) and are lost with the reset; waiting out the market minute when an egg is due is not built.

### 4.8 Sugar lumps

Harvest ripe lumps from the lump system (not the inherited clicker), including golden-lump timing: the payout is `min(CpS × 86400, bank)` with buffed CpS, so hold a golden lump inside its window for a buff when that pays. Spend a lump on Sugar frenzy (×3 CpS for an hour, once per ascension) when two hours of buffed CpS beats the best building level. Minigame and Farm/Cursor targets respect the Sugar baking hold.

Measure: lumps per day and CpS against the current lump system.

### 4.9 Grimoire additions

Double-cast Force the Hand of Fate by selling Wizard towers to lower the mana cap, when the forecast pair is worth more than the towers' rebuy cost. Hold the forced golden cookie up to its lifetime to land it on a buff.

Measure: cookies per cast across seeds, reported with the spread.

**Double cast: built on branch `w2/doublecast`.** Setting: Double Cast FTHOF (`autoFTHOFCombo`), default off, Autopilot on. It turns on forecast casting with double casts. The inherited combo (`autoFTHOFComboBot`) no longer runs.

- When forecast casting is about to cast, it also forecasts the cast after that. The forecast uses the fail chance that cast will have: its own cookie is popped first, and a double cast starts only with no golden cookie on screen. It also uses the buildings the sale will leave.
- It sells the fewest Wizard towers that make the second cast affordable. Max magic and spell cost come from the game's formulas (minigameGrimoire.js:263-267, 339-345) for any tower count, level and Supreme Intellect. Current magic is cut to the new max. At level 1 this needs 307 towers or more.
- It double-casts when the pair adds more than the towers' round trip (a sale refunds a quarter) and the delay the spent mana puts on every later cast.
  - The pair adds the second outcome's worth on the first one's buff, less what it would be worth cast later on its own.
  - "Later on its own" means the way forecast casting casts it. The outcome is held for the first CpS boost it would be cast on, until the bar is full. Boosts come from natural golden cookies, when they are clicked (autoGC). Their spawn interval and outcome odds come from the income model (src/game/measure.js).
  - It is valued on the buffs still running when mana pays for it. A long boost such as Sugar frenzy (×3 for an hour, which the lump system switches on late in a run) is still running then, and forecast casting casts on it at once. So a pair gains nothing from a first outcome that adds no buff of its own (a Lucky then a click frenzy). Found in review: before this, "later" was valued with every running buff removed, and 369 towers were sold for such a pair.
  - The average cast behind the mana penalty is valued the same way.
  - Outcome values use the shared buff classifier (src/core/buffs.js), the measured click rate, and the golden cookie gain multiplier and storm-drop reach. They count what a CpS buff multiplies besides buildings: clicks under a running click frenzy, and a running storm's drops.
- The sequence runs cast, pop, hold the buyer, sell. When the game recomputes max magic (every fifth frame), it forecasts again, casts, pops, buys the towers back in the same frame, and releases the buyer. The towers are bought back whenever the second cast is dropped.
- While the pair is forecast and mana fills, the buyer keeps the cookies the buy-back would lose, on top of its reserve. It does this only for a pair still worth doubling on the buffs that will be running once mana is full. From the sale to the buy-back it keeps the whole buy-back price, so no other spender can take the refund. The keep is let go as soon as forecast casting is switched off or stands aside for an inherited casting mode (found in review: it used to stay in the reserve for the rest of the session).
- The buyer has two new claims for this. `hold` stops purchases and re-ranks, and lapses after 30 frames. `keep` sets cookies aside on top of the reserve, and every spender respects it through `reserve()`.

Measured with `tools/dev/doublecast.mjs`. The fixture is a late bakery: prestige 1e15, 450 Wizard towers at level 1 to start, and the golden cookie upgrades. Buying, clicking, golden cookie clicking and forecast casting are all on. Each seed is run with Double Cast on and with it off, and the table gives on divided by off.

| Runs | Commit | Double cast on ÷ off (cookies earned) | Double casts |
|---|---|---|---|
| No natural golden cookies, 8 game hours, seeds dcn1 to dcn4 | b64912e; 3e8546e gives the same dcn4 run to the cookie | 3.96×, 6.77×, 3.11×, 16.8× (geometric mean 6.1) | 3, 1, 1, 4 |
| Natural golden cookies, paired, 4 game hours, seeds dcg1 to dcg4 | 3e8546e | 1.22×, 1.00×, 1.00×, 1.00× | none |
| The same, before natural boosts were counted, seeds dcg1 to dcg3 | b64912e | 1.21×, 0.46×, 0.68× | 0, 1, 1 |

Without natural golden cookies, the Hand of Fate outcomes follow the spell count. Both variants of a seed therefore see the same outcomes, and the comparison is luck-free.

With natural golden cookies, the runs are paired: natural cookies and storm drops draw from generators of their own, seeded by the seed. Without that pairing, the variants' golden cookies part at the first purchase they make differently, because each purchase draws Math.random for its sound. Unpaired runs of the final build gave 0.16× to 1.00×: 0.91× and 1.00× in seeds with no double cast, and 0.16× in dcg1. That run double-cast once (a Lucky onto a frenzy, 555 towers sold). Unpaired, its ratio cannot be told apart from golden cookie luck.

At this stage of a run, golden cookies come often enough that the held second outcome usually finds a natural Frenzy or building special anyway. So the final build made no double cast in the 16 paired golden hours, and one in the 12 unpaired ones. The Autopilot value of 1 therefore rests on the luck-free runs and on paired golden runs in which the decision never double-cast. With golden cookies on, there is no measurement yet of a double cast's own gain.

The review fixes (the long-boost valuation and the keep let go) give the same runs to the cookie on dcn1 to dcn4 and on paired dcg1 and dcg2: no buff in these runs lasts until mana pays for a cast again. Before natural boosts were counted, doubling a click frenzy onto the spell's frenzy lost the bigger natural buff that outcome would have found on its own, and lost the towers' round trip as well.

Seed dcg1 parted from single casting in hour 1 with no double cast. The cookies kept for a pair while mana filled changed what the buyer bought, and its 1.22× comes from that.

Not measured: early-run bakeries with fewer golden cookie upgrades, where natural boosts are rarer and double casts should fire with golden cookies on.

### 4.10 Garden harvest mode

Between seed hunts, grow the plant whose harvest pays most (Bakeberry, Queenbeet, Duketater) and harvest mature plots during a Frenzy with the bank at its cap.

Measure: garden income per day against leaving the plot to seed hunting only.

### 4.11 Bank office, brokers, loans

Office upgrades as a buyer chain (buy cursors to the threshold, upgrade), valued by the market profit the larger storage allows. Brokers as a buyer candidate valued by the overhead saved on measured trade volume, within the expected time to ascension. Loans on forecast combos only, when the combo's value beats the loan's interest and no better combo is forecast within its window.

Measure: market profit per day with and without each.

### 4.12 Godzamok and Golden switch

Devastation enters the income model (+1% click power per building sold for 10 s, main.js:7885-7901), so the gods system can value Godzamok, and the combo system sells the buildings that give the most units per cookie of rebuy cost during a click buff. The Golden switch is turned on at the start of a click buff only when half the buffed income over the buff beats an hour of CpS for the toggle, and off after.

Measure: cookies per click buff with and without each, across seeds.

## 5. Order of work

1. Merge the M5–M8 review fixes.
2. Wave one, in parallel worktrees: clicker and shimmers, wrinklers, seasons, dragon, heavenly planner, lumps.
3. Wave two: market office/brokers/loans, combos, grimoire additions, pre-ascension routine, garden harvest mode, the shared buff classifier.
4. An independent review of each wave before it merges, and an unattended multi-day Autopilot run after each wave, compared with the previous one across seeds.
