# Mushie Cookies

A mod that plays [Cookie Clicker](https://store.steampowered.com/app/1454400/Cookie_Clicker/) by itself on Steam.

Mushie Cookies is a fork of [Frozen Cookies](https://github.com/erbkaiser/FrozenCookies) by Icehawk78, Mtarnuhal, erbkaiser and contributors. See [NOTICE.md](NOTICE.md).

It is built for Cookie Clicker v2.053, the Steam build. It loads nothing from the network.

## Status

Work in progress. The goal is a mod that plays from a fresh save onward with no input, and makes each decision by expected value.

| # | Milestone | State |
|---|---|---|
| 1 | Foundation: offline, crash-proof, audited bugs fixed, test harness | Done |
| 2 | Buying | Next |
| 3 | Ascension and heavenly upgrades | Planned |
| 4 | Sugar lumps | Planned |
| 5 | Combos | Planned |
| 6 | Garden | Planned |
| 7 | Stock market | Planned |
| 8 | Pantheon and dragon | Planned |

Until milestone 2 lands, buying decisions are the ones Frozen Cookies makes.

## What it will and will not do

| Allowed | Not allowed |
|---|---|
| Read any game state, including state the interface hides | Write cookies, lumps, timers, buffs or random-number state |
| Take any action a player can take | Reload a save to reroll an outcome |
| Time an action to a known outcome | Grant achievements directly |

Steam achievements stay enabled. To turn that off, set `AllowSteamAchievs` to `0` in the installed `info.txt`.

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

4. Start Cookie Clicker. The mod is on by default, with every automation switched off. Open the **Mushie Cookies** button at the top right to switch automations on.

To switch the mod off, open **Options**, then **Manage mods**.

## Known conflict

Cookie Monster and Frozen Cookies are known to interfere with each other, and Mushie Cookies inherits that. Disable Cookie Monster while Mushie Cookies is on.

## If something goes wrong

Each part of the mod is isolated. A part that fails five times in a row is switched off and the rest keep running.

In the game's console:

| Command | Result |
|---|---|
| `MushieCookies.status()` | Every part, its failure count and its last error |
| `MushieCookies.revive("name")` | Switches a part back on |

## Tests

```
npm test            # logic only; needs nothing but Node
npm run test:game   # runs the installed game headless; needs Chrome and the game location
npm run test:all
```

The game tests run the game's own code in a headless browser on a virtual clock, so hours of play take minutes and every run is reproducible. No game files are copied into this repository.

## Design

| Document | Contents |
|---|---|
| [Design](docs/superpowers/specs/2026-09-29-mushie-cookies-design.md) | Goal, architecture, milestones |
| [Audit of Frozen Cookies](docs/research/frozen-cookies-audit.md) | What the base does and where it is wrong |
| [Survey of other mods](docs/research/ecosystem-survey.md) | Techniques worth taking from each |
| [Game mechanics](docs/research/game-mechanics-2.053.md) | Exact mechanics, read from the game's source |
