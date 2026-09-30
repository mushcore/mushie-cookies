# Mushie Cookies — design

Status: **approved** 2026-09-29.

Decisions confirmed by the owner:

| Question | Decision |
|---|---|
| Fair-play boundary | As in section 2: no save-scumming, no editing timers or cookies |
| Steam achievements | On |
| Steam Workshop release | No |
| Review gates | None. Milestones run back to back, with a report at each boundary |
Target: Cookie Clicker v2.053, Steam build.
Base: fork of `erbkaiser/FrozenCookies` at upstream commit `797f174`.

Supporting research lives in `docs/research/`:

- `frozen-cookies-audit.md` — what the base does, where it is wrong, and what is worth keeping
- `ecosystem-survey.md` — every other notable mod and the technique worth taking from each
- `game-mechanics-2.053.md` — exact mechanics read from the game's own source

## 1. Goal

A self-contained Steam mod that plays Cookie Clicker from a fresh save onward with no human input, and that makes each decision by expected value rather than by rule of thumb.

"Optimal" here means measurably better than stock Frozen Cookies and than a player following the community guides. It does not mean provably optimal: the full game is too large a search space for that, and no existing mod solves it.

### Success criteria

1. **Offline.** No network request at load or at runtime.
2. **Unattended.** From a fresh save it reaches its first ascension, buys heavenly upgrades, reincarnates, unlocks and runs all four minigames, and keeps going, with no input.
3. **Never stalls.** An error in one subsystem does not stop the others, and a what-if calculation can never leave phantom buildings or upgrades in the live game.
4. **Measured.** Each decision module beats the rule it replaces in a reproducible test.
5. **Fair play.** It stays inside the boundary in section 2.

## 2. Fair-play boundary

| Allowed | Not allowed |
|---|---|
| Reading any game state, including state the UI hides (stock mode, RNG seed, spell counter) | Writing cookies, lumps, timers, buffs or RNG state |
| Any action a player can take: click, buy, sell, cast, plant, harvest, slot, ascend | Save-scumming (reload to reroll an outcome) |
| Timing an action to a known outcome (for example casting when the forecast is good) | Granting achievements directly |

Two consequences for the base code:

- Frozen Cookies awards itself the "Third-party" shadow achievement on Steam, where the game would not. That is removed.
- `AllowSteamAchievs` stays `1` as upstream ships it, so Steam achievements keep working. It is one line in `info.txt` to turn off.

## 3. Why this base

| Candidate | Verdict | Reason |
|---|---|---|
| **Frozen Cookies (erbkaiser)** | **Chosen** | The only mod with full breadth of unattended play and a settings UI. Its core idea, measuring a purchase by running the game's own CpS calculation, survives game updates |
| Cookie Monster | Reference only | Best-engineered and MIT, but it advises and never acts. Its achievement-aware simulation and payback formula are the model for the new buying logic |
| CookieBot | Rejected | Plays the whole game, but aims at achievements rather than income, and ships with timer and lump manipulation that breaks section 2 |
| pc123177 fork of Frozen Cookies | Ideas only | Has a payback-based ascension rule and a heavenly upgrade buyer, but is alpha, web-only, and its interface has been translated to Portuguese |
| canacel3 fork of Frozen Cookies | Ideas only | Has a working garden bot; its phase structure informs milestone 6 |

The audit's warning stands: Frozen Cookies is a good reference and a poor foundation. The architecture in section 5 is how this design lives with that.

## 4. Licensing rules for a public repository

Upstream Frozen Cookies has no license file. Hosting this repository as a GitHub fork is covered by GitHub's terms. Redistribution elsewhere, including the Steam Workshop, is not, and stays out of scope until the upstream maintainer grants a license.

| Source license | Rule | Applies to |
|---|---|---|
| MIT | Code may be adapted, with attribution in `NOTICE.md` | Cookie Monster, Fortune Cookie, Horticookie, garden-gnome, Cookie Assistant, Auto Cookie, QuantBroker |
| GPL-3.0 | Ideas only, reimplemented from the game's mechanics. No code copied | CookieBot, Insugar Trading, Choose Your Own Lump, Cookie Payback Planner, ACABM |
| None stated | Ideas only. No code copied | CookiStocker, Auto Sacrifice, SteeleRobert's scripts, both Frozen Cookies forks above |
| Game source | Mechanics and formulas are facts and are used freely. Game files are never committed | Cookie Clicker itself |

## 5. Architecture

### 5.1 Approach

New code grows around the legacy code and replaces it one module at a time. Legacy files keep running until their replacement is verified, then they are deleted. At no point is there a big-bang rewrite that leaves the mod unplayable.

### 5.2 Layout

```
src/
  core/       pure logic: no access to the Game object, testable in Node
  game/       adapters: read the Game object into snapshots, carry out decisions
  systems/    one folder per subsystem (buyer, ascension, lumps, combos, garden, market, gods)
  ui/         settings panel and status line
  legacy/     the upstream fc_*.js files, shrinking over time
vendor/       third-party libraries, pinned and local
test/         unit tests and the time-lapse harness
tools/        build, deploy, table generators
dist/         build output (not committed)
```

Language: JavaScript ES modules with JSDoc types. Bundler: esbuild. Tests: Node's built-in test runner.

### 5.3 Build and load

The Steam loader runs exactly one file, `main.js`, from the mod folder, and it runs it before the game has created its buildings, upgrades or interface. The legacy files read game state as soon as they are evaluated, so they cannot simply be concatenated into that file.

The build therefore produces `main.js` from two parts: the vendored libraries, and the bundled new modules, which carry the legacy files as text. At load the new code registers through the game's mod API and does nothing else. One second after the game is ready, which is safely after Steam has loaded the save, it evaluates the legacy text as a single global script and starts it.

`tools/deploy` copies `dist/MushieCookies/` into the game's `mods/local/` folder.

Mod identity: name `Mushie Cookies`, id `mushie_cookies`. A separate id means its settings never collide with a Frozen Cookies install.

### 5.4 Core modules

| Module | Responsibility | Replaces |
|---|---|---|
| `core/sim` | The only code allowed to alter game state for a what-if. Always restores, even on error. Freezes achievement awards and the highest-CpS record while it runs, and counts the achievements a purchase would earn | `buildingToggle`, `upgradeToggle`, and the regex-and-`eval` replay in `fc_main.js` |
| `core/value` | One income model: passive CpS, click income at the game's real cap, and golden cookie income built from the game's live outcome pool, timing and durations | `cookieValue`, the hardcoded odds table, the fps-dependent probability tables |
| `core/ledger` | Subsystems reserve cookies and take named locks, each with an owner and an expiry | Subsystems overwriting each other's user settings |
| `core/loop` | One scheduler. Each subsystem tick is isolated; repeated failures switch that subsystem off and say so in the UI | `autoCookie` and about thirty separate intervals |

The ledger is the piece every later milestone depends on. A combo needs buying paused and cookies held for the rebuy; the garden needs seed money; the market needs trading capital. Today those needs are met by one subsystem silently changing another's settings, which is the source of a whole class of upstream bugs.

### 5.5 Pure logic, thin adapters

Every decision is a function from a snapshot to an action list. Adapters build the snapshot from the `Game` object and carry out the actions. Decisions can then be tested in Node against recorded snapshots, and the same decision code runs unchanged in the harness and in the live game.

## 6. Milestones

Ordered by when each matters in a run that starts from nothing. Each milestone is verified before the next begins.

### M1 — Foundation

- Offline loader, vendored libraries, single-file build, deploy tool.
- `core/loop` and `core/sim` with the safety guarantees above.
- Fix the bugs listed in section 6 of the audit. Pure-logic fixes get a regression test.
- Remove dead code and the "reward cookie" patch that buys buildings with autobuy off.
- Test harness skeleton (section 7).

Verified by: the game loads the mod with the network disconnected; a ten-minute run logs no errors; with autobuy off, nothing is bought.

Status: done 2026-09-29. 43 logic tests and 25 game tests pass, including two hours of unattended buying with no error, identical purchases across two runs of one seed, and a run inside the game's own runtime.

Carried into M2: with the mod buying, the harness runs at about 25 times real time, against about 1,000 for the bare game. Ranking upgrades accounts for four fifths of that: each pass runs a what-if for some 400 upgrades, most of them far out of reach. M2 has to cut that before multi-day comparisons are practical.

### M2 — Buying

- Click income capped at the game's real limit of 50 clicks per second.
- Golden cookie value from the live outcome pool, including building specials, Dragon Harvest and Dragonflight.
- Payback formula that accounts for cookies already held: `max(price − bank, 0) / income + price / Δincome`.
- Purchase deltas that include achievements the purchase would earn.
- Bulk buying that buys in bulk, and lookahead to the next tier threshold.
- Discount and non-CpS upgrades valued through `core/value` over a horizon, not against a single purchase.

Verified by: time to reach a target CpS from recorded starting states, new logic against legacy logic, in the harness.

Status: done 2026-09-29, with a finding that changed how every later milestone is measured.

- A single run is dominated by golden cookie luck. First readings of 2× to 35× over M1 were luck: with golden cookies switched off, which makes runs fully deterministic, the new buyer was at 0.81×.
- Two real defects explained that gap, and both are fixed: the income model credited golden cookies when none could spawn, and chains read tier thresholds that are not always the real unlock count (Billion fingers unlocks at 100 cursors, not its tier's 150). Chains now come from the upstream prerequisite table.
- Luck-free, the buyer is now 0.96× to 1.03× of M1 over two hours; the acceptance test guards that level. With golden cookies on, over nine seeds, the geometric mean is 1.53× but the spread (0.05× to 32×) makes that indistinguishable from parity. Purchase ordering was already close to optimal upstream; the buyer's gains are correctness (no phantom state, achievements counted, spawn rules honoured) and speed (the harness runs about four times faster with it).
- Evidence: `test/baselines/m1-two-hours-nogolden.json`, `m2-vs-m1-9-seeds.json`, `m2-reserve-sweep.log`.

### M3 — Ascension

- Timing rule: ascend when the current rate of prestige growth falls below the run's average rate, measured on a log scale and including rebuild time. This is the point where staying longer earns less than starting again.
- First ascension uses a shopping-list target, since a growth rate from zero is undefined.
- Guards: no ascending mid-combo, inside the dragon egg unlock window, or before a minimum run length.
- Heavenly upgrade buyer with a priority order, and permanent upgrade slots filled by simulated value.
- Pre-ascension routine: pop wrinklers, harvest, sell stock, sell buildings under Earth Shatterer, buy the Chocolate egg. This makes those cookies count toward the ascension being taken.
- Reincarnation triggered by game state, not by a fixed ten-second timer.

Verified by: prestige per day over multi-ascension runs in the harness, against the upstream "double your prestige" rule.

Status: implemented 2026-09-29; the mechanics are verified, the rule comparison is not. A harness test runs a first ascension end to end (plan heavenly upgrades on the living bakery, ascend, buy, reincarnate, rebuild) and manual ascensions are left alone. The comparison with the doubling rule could not be made: luck-free, prestige grows so slowly that neither rule fires within twelve game hours even from prestige 5, and ascension plays out over game days. The rate rule is kept on theoretical grounds (it is the stopping rule that maximises long-run average yield for a repeated process) and the doubling rule stays available as an option.

### M4 — Sugar lumps

- Harvest when ripe, never when merely mature.
- Spending order: unlock the four minigames, Farm to level 9, Cursor to level 12, hold 100 for Sugar baking, then by value.
- Refills for combos weighed against building levels.

Without this milestone the mod cannot unlock a minigame on its own, because upstream never spends a lump.

Verified by: a fresh-save harness run unlocks all four minigames unattended.

Status: done 2026-09-29 for spending: minigames, Farm 9, Cursor 12, then the best CpS gain per lump, holding 100 with Sugar baking. Harness tests show the minigames unlocking and the hold respected. Refills for combos are left to M5's later work.

### M5 — Combos

- A forecast that returns an outcome code, takes the fail chance as an input, and covers both season branches.
- A planner that lines up a wanted pair of outcomes, waits for a natural Frenzy with a building special, dual-casts, and aborts cleanly.
- Godzamok sell targets chosen by rebuy cost against click gain.
- Golden Switch, loans and sugar frenzy timed by cost and benefit.
- Replaces `fc_spells.js`, whose 2,000 lines are largely one block repeated.

Verified by: forecast checked against real casts in the harness, outcome by outcome; combo income per day against upstream.

Status: single-cast forecasting done 2026-09-29; dual-casting, Godzamok, Golden Switch and loans are not yet replaced.

- The forecast matched 200 of 200 real casts across five seasons, including backfires with golden cookies on screen, and leaves the game's own random sequence untouched (the inherited predictor reseeded the global generator).
- The casting policy values the next outcome in cookies given the buffs running, burns bad outcomes with Haggler's Charm, and lands good ones on a running buff or casts when mana is full.
- Over six seeds, three game hours from a mid-game bakery: forecast casting earned 6.0× what no casting did (geometric mean; range 0.43× to 103×); the inherited "smart" casting earned 1.04×. Forecast casting beat the inherited mode on five seeds of six. Evidence: `test/baselines/m5-casting-6-seeds.json`.

### M6 — Garden

- Seed unlock planner that reads the mutation table from the live game and works at every plot size.
- Juicy queenbeet and sacrifice loop while lumps are the bottleneck, then a steady-state layout.
- Soil policy. Seeds bought outside CpS buffs, since seed price scales with buffed CpS.

Verified by: time to a full seed log in the harness, against published figures for existing garden bots.

Status: unlock loop and sacrifice implemented 2026-09-29. Mutation rules are asked of the game's own `getMuts`; a layout optimiser places parents; sprouts of locked plants are kept until mature, which unlocks the seed, and a secured target frees the rest of the plot for the next. From a fresh log with a full plot: 7 of 34 seeds in 6 game hours. The time to a full log is being measured.

### M7 — Stock market

- Buy and sell thresholds per good, bank level and hidden mode, derived by simulating the game's exact price model and shipped as a generated table.
- Loans coordinated with combos through the ledger.

Verified by: profit per day in the market simulator against the three published strategies (fixed percentages of resting value, quantiles, mode transitions).

### M8 — Pantheon and dragon

- Gods and auras swapped by situation, within the swap budget.
- Cyclius computed from the game's formula, not from a timetable.

Verified by: income per day in the harness against static slotting.

## 7. Testing

| Layer | What it covers | How |
|---|---|---|
| Unit | Pure logic in `src/core` | Node test runner, recorded snapshots |
| Cross-check | Forecasts and formulas | Run the prediction and the real game code side by side and compare |
| Time-lapse harness | Whole strategies over days of game time | The game's own code in a headless browser with a controllable clock |
| Runtime test | Loading and buying on the Chrome the game ships with | The Electron runtime copied from the install, without the game's own code, driven over the DevTools protocol |

The time-lapse harness is the piece no other mod has, and it is what makes criterion 4 checkable.

Feasibility was confirmed by a spike on 2026-09-29. The installed v2.053 game booted in headless Chrome in about 0.3 seconds with no errors, and ran at roughly 30,000 logic frames per second: about 1,000 times real time, or one game day in under two minutes. Cookies earned over a simulated hour matched CpS × 3,600 exactly.

Three rules follow from how the harness works:

- New code is driven by the game's `logic` hook and counts frames. It never uses wall-clock timers, so it behaves identically at any playback speed.
- The harness replaces timers, the clock and the random seed with virtual ones, so legacy code that still uses timers runs in virtual time and every run is reproducible.
- The harness loads mods at the point where Steam loads them, so a mod that touches the game too early fails in tests as it would in the game.

Game files are read from the local install at test time. They are never copied into the repository.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Upstream has no license | Fork relationship kept; no Workshop release; section 4 |
| Game updates change mechanics | Read pools, recipes and formulas from the live game wherever possible; generated tables are rebuilt by a tool |
| The seam between legacy and new code leaks | One bridge file owns every global the legacy code still needs |
| Conflict with other mods | Upstream has a known conflict with Cookie Monster; the README will say so |
| Bot damages a save | Every automation is off until switched on; tests never touch a real save |

## 9. Out of scope

- Steam Workshop release
- Web, bookmarklet and userscript loaders. The upstream ones are removed, because they load upstream's code, not this fork's
- Translations
- Anything outside the boundary in section 2
