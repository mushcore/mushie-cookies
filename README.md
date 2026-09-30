# Mushie Cookies

A mod that plays [Cookie Clicker](https://store.steampowered.com/app/1454400/Cookie_Clicker/) by itself on Steam.

Mushie Cookies is a fork of [Frozen Cookies](https://github.com/erbkaiser/FrozenCookies) by Icehawk78, Mtarnuhal, erbkaiser and contributors. See [NOTICE.md](NOTICE.md).

It is built for Cookie Clicker v2.053, the Steam build. It loads nothing from the network.

## What it does

Everything starts off. Switch on **Autopilot**, the first option in the menu, and it automates everything: it plays the whole game, from a fresh save through ascension after ascension, with no further input. It switches on every part below and keeps off every inherited option that would fight one of them. Changing a playing option by hand hands control back to you; switching Autopilot on again restores its settings. Display options (number format, infobox, frame rate) are always yours.

Each part is also a separate switch in the **Mushie Cookies** menu, and each is measured in a time-lapse harness that runs the game's own code.

| Part | What it does | Setting |
|---|---|---|
| Buying | Ranks every building, upgrade and "a few more buildings unlock an upgrade" chain by the income it adds, measured against the game's own calculation: clicks at the game's real cap, golden cookies from the game's live rules, achievements a purchase would earn. Keeps a Lucky reserve only when it pays. | Autobuy |
| Spell casting | Forecasts Force the Hand of Fate from the game's seeded generator (matched 200 of 200 real casts), burns bad outcomes with a cheap spell, and lands good ones on a running buff. | Forecast Casting |
| Ascension | Ends a run when its prestige growth drops below the run's average, collects wrinklers and sells stock first so they count, buys heavenly upgrades by income per chip, fills permanent slots, and reincarnates. Only ever finishes an ascension it started. | Auto Ascend |
| Wrinklers | Keeps every wrinkler feeding and pops the fattest ordinary one only when buying the next purchase sooner is worth more than the feeding its empty slot loses. Shiny wrinklers are kept. Pops them all just before an ascension, yours included, so their cookies count toward it. | Auto Wrinklers |
| Sugar lumps | Harvests each lump as it ripens, never in Born again, where the game hides it; a golden lump waits inside its ripe hour while the buyer holds the bank it pays on. Unlocks the four minigames, takes the Farm to 9 and the Cursor to 12, then levels the building with the best gain per lump; once Sugar baking is owned, every spend keeps 100 in the jar. Switches Sugar frenzy on as the run nears its end, when two hours of CpS beat the best building level. | Autoharvest SL, Spend Lumps, Sugar Frenzy |
| Garden | Breeds every seed by asking the game which neighbours produce which plant, then sacrifices the garden for 10 sugar lumps and starts again. | Auto Garden |
| Stock market | Trades with buy and sell prices derived by simulating the game's exact price model (the port matches the game bit for bit); spends only what the buyer is not holding. | Auto Trading |
| Pantheon and dragon | Slots gods and picks auras by what they add to income, the way a player drags a god or confirms an aura. | Auto Gods & Auras |
| Seasons and Santa | With Season switcher, values each season for the rest of the run (reindeer in Christmas, the drops still missing in each) and switches when that repays the switch: a Valentine's visit for the hearts that pay, then Christmas to rest in. Levels Santa by what each level adds. Switches and Santa levels are ranked with every other purchase and paid from above the buyer's reserve; the calendar's season is kept while it has drops to give. | Auto Seasons |
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
| Buying | On par with the inherited logic for pure purchase order (0.96× to 1.03×, luck removed); the gains are correctness and a four times faster simulation |
| Garden | 8 of 34 seeds in the first six game hours from a fresh seed log, 27 by 48 hours. A single run on one seed: the count depends on luck, and a re-run on a later build gave 3. The run started from a 1e15 bank that buying also spent; whether seed prices held it back was not measured |
| Dragon training | Level with the inherited "train whatever is affordable" rule on income: 0.98x to 1.03x the cookies over three game hours (three seeds, golden cookies off, grimoire casting on) and 0.99x to 1.04x over four hours at a lower prestige, both inside the harness's run-to-run spread. Radiant Appetite came within 10 s of the inherited rule's in two seeds and 290 s sooner in the third. It skips the sacrifices for auras worth nothing to income and never clamps the grimoire's mana |
| Wrinklers | 2.12× the cookies of the inherited "efficient" popping over a day of grandmapocalypse (three seeds, range 2.10× to 2.14×, golden cookies off, with Unholy bait), and 2.45× the final CpS. Behind in the first hour (0.98×) while the first pops leave slots empty |
| Sugar lumps | Luck-free. Harvest: 1.043 harvests a game day, the same as the inherited click, against 1.000 when lumps are left to fall. A golden lump: the timed harvest paid 2.9× to 4.9× what harvesting at ripe paid, over three bakery stages, with no CpS lost. Sugar frenzy timed to the ascension's rate rule: ×1.09 and ×1.12 log-prestige per second of run, the ascension's own measure (×1.13 and ×1.26 prestige per run; two starting prestiges, one run each); switched on at the start of a run instead, it pushed the rate rule into ascending early (×0.35 and ×0.81). A save with Sugar baking and 100 lumps: the inherited order spent 99 of them (CpS ×0.51); now none |
| Seasons and Santa | Three game hours from just after an ascension at prestige 3000, Season switcher owned, golden cookies off, three seeds, against no season play: CpS at the end ×10,600 to ×11,800, cookies ×29,600 to ×31,000; 28 seasonal upgrades collected against none (Santa to level 14, all 7 Christmas cookies, 5 hearts) with 4 switches. At the end the seasonal upgrades give ×3.3 CpS directly and reindeer 14% of income; the rest is compounding within the run. Easter and Halloween were not visited: they wait for the wrinkler system |

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
