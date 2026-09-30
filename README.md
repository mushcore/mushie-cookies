# Mushie Cookies

A mod that plays [Cookie Clicker](https://store.steampowered.com/app/1454400/Cookie_Clicker/) by itself on Steam.

Mushie Cookies is a fork of [Frozen Cookies](https://github.com/erbkaiser/FrozenCookies) by Icehawk78, Mtarnuhal, erbkaiser and contributors. See [NOTICE.md](NOTICE.md).

It is built for Cookie Clicker v2.053, the Steam build. It loads nothing from the network.

## What it does

Everything starts off. Switch on **Autopilot**, the first option in the menu, and it automates everything: it plays the whole game, from a fresh save through ascension after ascension, with no further input. It switches on every part below and keeps off every inherited option that would fight one of them. Changing a playing option by hand hands control back to you; switching Autopilot on again restores its settings. Display options (number format, infobox, frame rate) are always yours.

Each part is also a separate switch in the **Mushie Cookies** menu, and each is measured in a time-lapse harness that runs the game's own code.

| Part | What it does | Setting |
|---|---|---|
| Buying | Ranks every building, upgrade and "a few more buildings unlock an upgrade" chain by the income it adds, measured against the game's own calculation: clicks at the rate the clicker really achieves, golden cookies from the game's live rules, achievements a purchase would earn. Keeps a Lucky reserve only when it pays. Reads every income unbuffed, so it ranks and buys through a Frenzy as between buffs; waits out click buffs, so it does not hold up the clicks. | Autobuy |
| Clicking | Clicks the big cookie as often as the game counts a click, timing each call for the moment it will count, and measures the rate it really gets. A click of yours on a wrinkler or the dragon still lands. | Autoclick |
| Golden cookies | Clicks golden, wrath and storm cookies and reindeer in the frame they appear, and news fortunes: upgrades and the golden cookie on sight, the hour of CpS once it would pay at least an hour of unbuffed CpS (the game caps it at the bank, and a CpS buff raises it), or at any size when the mod's own ascension is about to reset it. | Autoclick GC, Reindeer, Auto Fortune |
| Spell casting | Forecasts Force the Hand of Fate from the game's seeded generator (matched 200 of 200 real casts), burns bad outcomes with a cheap spell, and lands good ones on a running buff. | Forecast Casting |
| Ascension | Ends a run when its prestige growth drops below the run's average. Before ascending it collects the wrinklers so their cookies count, sells stock, harvests the garden, and, when a Chocolate egg is unlocked, sells the buildings and buys the egg last. A sale only adds to the bank, which the reset wipes, so stock and building sales count toward prestige only through the egg's 5% of the bank. Then it buys heavenly upgrades by income per chip, fills permanent slots, and reincarnates. An ascension you start is left to you, apart from the wrinkler collection below. | Auto Ascend |
| Wrinklers | Keeps every wrinkler feeding and pops the fattest ordinary one only when buying the next purchase sooner is worth more than the feeding its empty slot loses. Shiny wrinklers are kept. Pops them all just before an ascension, yours included, so their cookies count toward it. | Auto Wrinklers |
| Sugar lumps | Harvests each lump as it ripens, never in Born again, where the game hides it; a golden lump waits inside its ripe hour while the buyer holds the bank it pays on. Unlocks the four minigames, takes the Farm to 9 and the Cursor to 12, then levels the building with the best gain per lump; once Sugar baking is owned, every spend keeps 100 in the jar. Switches Sugar frenzy on as the run nears its end, when two hours of CpS beat the best building level. | Autoharvest SL, Spend Lumps, Sugar Frenzy |
| Garden | Breeds every seed by asking the game which neighbours produce which plant, then sacrifices the garden for 10 sugar lumps and starts again. | Auto Garden |
| Stock market | Trades with buy and sell prices derived by simulating the game's exact price model (the port matches the game bit for bit); spends only what the buyer is not holding. | Auto Trading |
| Pantheon and dragon | Slots gods and picks auras by what they add to income, the way a player drags a god or confirms an aura. | Auto Gods & Auras |
| Dragon training | Trains the dragon toward the level whose aura (Radiant Appetite, the second slot) repays the buildings the levels on the way sacrifice, within the time the run is expected to last. Spends only what the buyer is not holding, and holds a Wizard tower level until the grimoire has spent the mana it would lose. | Dragon Upgrading |
| Dragon petting | Pets the dragon from level 8 while the quarter hour's drop is missing, forecasting the drop without touching the game's random numbers. | Dragon Petting |

## What it will and will not do

| Allowed | Not allowed |
|---|---|
| Read any game state, including state the interface hides | Write cookies, lumps, timers, buffs or random-number state |
| Take any action a player can take | Reload a save to reroll an outcome |
| Time an action to a known outcome | Grant achievements directly |

Steam achievements stay enabled. To turn that off, set `AllowSteamAchievs` to `0` in the installed `info.txt`.

## Measured results

From the harness, against the inherited Frozen Cookies logic or against doing nothing. Full numbers and caveats are in the [design document](docs/superpowers/specs/2026-09-29-mushie-cookies-design.md).

| Part | Result |
|---|---|
| Spell casting | 6.0× the cookies of not casting over three game hours (geometric mean of six seeds, range 0.43× to 103×); the inherited "smart" casting managed 1.04×. Promising, not established: with six seeds the 95% interval runs from about 0.65× to 55× |
| Stock market | 1.95× the profit of the published "buy at 50%, sell at 125% of resting value" rule on a price history the search never saw (bank levels 1 and 5, 5% broker overhead; 1.92× over every bank level and overhead). Simulated profit per share of storage, not profit measured in the game |
| Buying | On par with the inherited logic for pure purchase order (0.96× to 1.03×, luck removed); the gains are correctness and a four times faster simulation. Through CpS buffs (luck removed, a forced Frenzy every 10 or 5 minutes, two game hours), ranking after each purchase earned 1.23× and 1.55× the cookies of buying on down the ranking made before the buff |
| Clicking | In the game's own runtime with the window shown (8 tries, a loaded machine): 44 accepted clicks a second (41 to 48) with no call wasted, against 33 (31 to 36) for a 50-a-second interval and 44 (40 to 47) for a 250-a-second one that wasted 79% of its calls. During a Click frenzy with the buyer busy: 39 (36 to 43), against 23 (0.4 to 36) if it bought through. No better than the interval with the window minimized (about 30 a second, widely spread) |
| Golden cookies | None missed in the harness, like the inherited popping, and still none when the inherited loop keeps failing (the inherited popping then missed every one). The hour-of-CpS fortune, modelled on 3 recorded 4-hour runs with Auto Ascend off (4,000 draws each): 5.9× the cookies of clicking it on sight (3.7× to 8.0×), but in 34% to 68% of draws it is never taken within the run, and a payout taken early is not credited with what it would have bought |
| Garden | 8 of 34 seeds in the first six game hours from a fresh seed log, 27 by 48 hours. A single run on one seed: the count depends on luck, and a re-run on a later build gave 3. The run started from a 1e15 bank that buying also spent; whether seed prices held it back was not measured |
| Dragon training | Level with the inherited "train whatever is affordable" rule on income: 0.98x to 1.03x the cookies over three game hours (three seeds, golden cookies off, grimoire casting on) and 0.99x to 1.04x over four hours at a lower prestige, both inside the harness's run-to-run spread. Radiant Appetite came within 10 s of the inherited rule's in two seeds and 290 s sooner in the third. It skips the sacrifices for auras worth nothing to income and never clamps the grimoire's mana |
| Wrinklers | 2.12× the cookies of the inherited "efficient" popping over a day of grandmapocalypse (three seeds, range 2.10× to 2.14×, golden cookies off, with Unholy bait), and 2.45× the final CpS. Behind in the first hour (0.98×) while the first pops leave slots empty |
| Sugar lumps | Luck-free. Harvest: 1.043 harvests a game day, the same as the inherited click, against 1.000 when lumps are left to fall. A golden lump: the timed harvest paid 2.9× to 4.9× what harvesting at ripe paid, over three bakery stages, with no CpS lost. Sugar frenzy timed to the ascension's rate rule: ×1.09 and ×1.12 log-prestige per second of run, the ascension's own measure (×1.13 and ×1.26 prestige per run; two starting prestiges, one run each); switched on at the start of a run instead, it pushed the rate rule into ascending early (×0.35 and ×0.81). A save with Sugar baking and 100 lumps: the inherited order spent 99 of them (CpS ×0.51); now none |

A single run is dominated by golden cookie luck, so strategies are compared with golden cookies switched off (which makes runs deterministic) or across several seeds.

The casting, buying and garden results were recorded before commit `eb1e001` fixed the harness clock. Until then every timer in a frame ran at the frame's time, so the game, which counts a click only 20 ms after the last one, counted at most 30 clicks a second instead of 50.

## Install

You need [Node.js](https://nodejs.org) 22 or later.

1. Install the build tools:

   ```
   npm install
   ```

2. Tell the tools where the game is. Create `.mushie.local.json` in this folder:

   ```json
   { "gameApp": "<Steam library>/steamapps/common/Cookie Clicker/resources/app" }
   ```

   Setting the `COOKIE_CLICKER_APP` environment variable to the same path also works.

3. Build and copy the mod into the game:

   ```
   npm run deploy
   ```

4. Start Cookie Clicker. The mod loads with everything off. Open the **Mushie Cookies** button at the top right and switch on **Autopilot** to have it play everything, or switch on only the parts you want.

To switch the mod off, open **Options**, then **Manage mods**.

Some inherited options do the same job as a new part and would fight it (the old casting modes, worship slots, dragon auras). Autopilot never turns them on; if you do, the new part stands aside while its inherited counterpart is on.

## Known conflict

Cookie Monster and Frozen Cookies are known to interfere with each other, and Mushie Cookies inherits that. Disable Cookie Monster while Mushie Cookies is on.

## If something goes wrong

Each part is isolated. A part that fails five times in a row is switched off and the rest keep running.

In the game's console:

| Command | Result |
|---|---|
| `MushieCookies.status()` | Every part, its failure count and its last error |
| `MushieCookies.revive("name")` | Switches a part back on |
| `MushieCookies.buyer.report()` | What the buyer wants next and why |

## Tests

```
npm test            # logic only; needs nothing but Node
npm run test:game   # runs the installed game headless; needs Chrome and the game location
npm run test:all
```

The game tests run the game's own code in a headless browser on a virtual clock, so hours of play take minutes and every run is reproducible. One test also runs the mod on the Electron runtime the game ships with. No game files are copied into this repository.

## Design

| Document | Contents |
|---|---|
| [Design](docs/superpowers/specs/2026-09-29-mushie-cookies-design.md) | Goal, architecture, milestones and what each measured |
| [Plans](docs/superpowers/plans/) | Milestone plans, where execution departed from them, and the independent reviews |
| [Audit of Frozen Cookies](docs/research/frozen-cookies-audit.md) | What the base does and where it was wrong |
| [Survey of other mods](docs/research/ecosystem-survey.md) | Techniques worth taking from each |
| [Game mechanics](docs/research/game-mechanics-2.053.md) | Exact mechanics, read from the game's source |
