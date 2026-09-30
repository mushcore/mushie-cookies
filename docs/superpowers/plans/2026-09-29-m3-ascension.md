# M3 Ascension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide when to ascend by the rate of prestige growth, and once ascended, spend heavenly chips and fill permanent upgrade slots by measured value, so that a run from nothing keeps ascending and compounding without input.

**Architecture:** One new loop system, `ascension`, with a pure timing rule in `src/core/ascension.js` and a pure chip-spending ranking in `src/core/heavenly.js`. It reuses M2's what-if machinery to measure heavenly upgrades and permanent-slot candidates, and M2's income model to value them. The legacy `shouldAutoAscend` and its settings are retired; the legacy pre-ascension routine (`prepareForAscension`) is kept and called from the new system.

**Tech Stack:** As M1 and M2.

**Spec:** `docs/superpowers/specs/2026-09-29-mushie-cookies-design.md`, section 6, M3. Mechanics: `docs/research/game-mechanics-2.053.md` section 7 (prestige formula, what a reset keeps, permanent slots). Prior art: `docs/research/ecosystem-survey.md` (CookieBot's ascension logic, the wiki's prestige targets); the pc123177 fork's payback rule is described in `docs/research/frozen-cookies-audit.md`.

## Global Constraints

- Everything in the M1 and M2 plans' Global Constraints.
- Fair play: ascending, buying heavenly upgrades and assigning permanent slots happen through `Game.Ascend(1)`, `Game.PurchaseHeavenlyUpgrade(id)` / `upgrade.buy()`, writing `Game.permanentUpgrades[slot]` (what the game's own slot dialog writes) and `Game.Reincarnate(1)`. Nothing writes `Game.prestige`, `Game.heavenlyChips` or `Game.cookiesReset`.
- The mod only ever reincarnates an ascension it started (M1 review, finding 5).
- No static price table: heavenly upgrades are read from `Game.PrestigeUpgrades` with `getPrice()`, `parents`, `canBePurchased`.
- The dragon egg guard from the pc123177 fork stays: never ascend while "How to bake your dragon" is owned, "A crumbly egg" is not yet unlocked, and `Game.cookiesEarned < 1e6`.

## Review Focus

1. **A run that grows fast then stalls.** The rule must not ascend during the fast phase and must ascend within a reasonable time once growth has flattened. Pinned in Task 1.
2. **The first ascension**, where the average-rate rule has no history. Pinned in Task 1.
3. **Chips that cannot buy anything useful yet.** The spender must not waste chips on low-value items when saving one more run would afford a prestige-multiplier upgrade. Pinned in Task 2.
4. **A permanent slot already holding something.** The slot is refilled only with something measured better. Pinned in Task 3.
5. **An ascension interrupted** (game reloaded on the ascension screen). The system must recover and reincarnate, or leave a manual ascension alone. Pinned in Task 4.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/core/ascension.js` | `shouldAscend`: the timing rule, pure |
| `src/core/heavenly.js` | `rankHeavenly`, `planChips`: chip spending, pure |
| `src/game/prestige.js` | Reads heavenly candidates and permanent-slot candidates from the game; measures them with what-ifs |
| `src/systems/ascension.js` | The loop system: tracks prestige history, ascends, spends, fills slots, reincarnates |
| `src/legacy/fc_main.js` | `shouldAutoAscend`, the `reincarnate` loop system and the ascend settings removed; `prepareForAscension` kept |
| `src/legacy/fc_preferences.js` | `autoAscendToggle`, `autoAscend`, `HCAscendAmount`, `comboAscend`, `minCpSMult` replaced by one setting `autoAscend` (off / on) |
| `test/unit/ascension.test.mjs`, `test/unit/heavenly.test.mjs` | Pure tests |
| `test/game/ascension.test.mjs` | Game tests |

---

### Task 1: The timing rule

**Files:**
- Create: `src/core/ascension.js`
- Test: `test/unit/ascension.test.mjs`

**Interfaces:**

```js
/**
 * @param {object} args
 * @param {number} args.prestige         prestige level now (Game.prestige)
 * @param {number} args.projected        prestige level after ascending now
 * @param {Array<{t: number, projected: number}>} args.history  samples of `projected` over this run, seconds since the run began; oldest first
 * @param {number} args.runSeconds       seconds since reincarnation
 * @param {number} args.overheadSeconds  time an ascension costs: the animation plus the rebuild lag (default 300)
 * @param {number} args.windowSeconds    how far back the instantaneous rate looks (default 900)
 * @param {number} args.minRunSeconds    never ascend earlier than this (default 1800)
 * @param {number} args.firstTarget      for a first ascension: the prestige to reach (the starter shopping list's cost)
 * @returns {{ascend: boolean, reason: string, instantRate: number, averageRate: number}}
 */
export function shouldAscend(args)
```

The rule, on `u = ln(1 + projected)`:
- `averageRate = (u(now) − u(start)) / (runSeconds + overheadSeconds)`: what this run has earned per second, charged for the restart.
- `instantRate = (u(now) − u(now − window)) / window`, from the two history samples that bracket the window.
- Ascend when `runSeconds >= minRunSeconds`, `projected − prestige >= 1`, and `instantRate < averageRate`: the run is now earning less per second than starting over would.
- First ascension (`prestige === 0`): ascend when `projected >= firstTarget`, whatever the rates say; the rates are undefined from zero.
- Never ascend when `projected − prestige < 1`.

- [ ] Tests: a run whose `projected` grows exponentially never triggers; one that grows then flattens triggers once the instantaneous rate drops under the average; the overhead makes the rule wait longer on short runs; `minRunSeconds` blocks an early trigger; first ascension waits for `firstTarget` and ignores the rates; a history shorter than the window uses what it has; no gain of at least one level, no ascension.

- [ ] Implement, test, commit: `git commit -m "Ascension timing by the rate of prestige growth"`

---

### Task 2: Spending chips

**Files:**
- Create: `src/core/heavenly.js`, `src/game/prestige.js`
- Test: `test/unit/heavenly.test.mjs`, `test/game/prestige.test.mjs`

**Interfaces:**
- `listHeavenly(game)` (game side): every prestige upgrade with `canBePurchased`, not bought, whose parents are all bought: `{ id, name, price: upgrade.getPrice(), upgrade, apply() }` where `apply` sets `bought = 1` for a what-if.
- `measureHeavenly(game, settings, candidates)`: `measureCandidates` over them (M2), giving the income after each.
- `rankHeavenly({ candidates, measured, income, enablers })` (pure): value per chip `= (deltaIncome / income.total) / price` (relative income gain per chip); enablers get a fixed relative value from a table by name, because the income model cannot see them: Legacy 1000 (nothing works without it), How to bake your dragon 0.5, Season switcher 0.3, Golden switch 0.2, Persistent memory 0.1, Twin Gates and the offline chain 0.02 each (worth something to a player who closes the game). Sorted by value per chip, descending.
- `planChips({ ranked, chips, saveFor })` (pure): walks the ranking, buys what is affordable in order; stops at the first item whose price exceeds the chips left **if** its value per chip beats everything affordable after it by a factor of 3, in which case it reports `saving: name`; otherwise skips it and keeps going. Returns `{ buy: [ids], saving: name | null }`.

- [ ] Tests (pure): value per chip ordering; enablers ranked by their fixed values; the prestige-multiplier chain (a cheap parent then an expensive child) is bought in order; saving is chosen when the next item is far better than the rest; an unaffordable item with nothing better later is skipped, not saved for.
- [ ] Test (game): on the ascension screen after a mod-started ascension with about 400 chips, `listHeavenly` lists Legacy, Heavenly cookies (after Legacy) and the cheap tree; `Legacy` is first in the ranking; a what-if of `Heavenly cookies` measures +10% income.
- [ ] Commit: `git commit -m "Rank and buy heavenly upgrades by income per chip"`

---

### Task 3: Permanent slots

**Files:**
- Modify: `src/game/prestige.js`
- Test: `test/game/prestige.test.mjs` (extend)

**Interfaces:**
- `slotCandidates(game)`: owned upgrades eligible for a slot (`bought && unlocked && !noPerm && (pool == '' || pool == 'cookie')`), not already slotted.
- `bestForSlots(game, settings, slotsOwned)`: measures each candidate's share of income by a what-if that **removes** it (`bought = 0`), on the pre-ascension state; returns the `slotsOwned` largest shares, best first. Assigns by writing `Game.permanentUpgrades[i]` for slots that are empty or hold something measured worse. Runs before `Game.Ascend`, because the measurement needs the run's buildings.

- [ ] Test: with kitten upgrades and cookie upgrades owned and one slot, the kitten with the largest share is chosen; a slot holding a better upgrade is not overwritten; a slot holding a worse one is.
- [ ] Commit: `git commit -m "Fill permanent upgrade slots by measured share of income"`

---

### Task 4: The ascension system

**Files:**
- Create: `src/systems/ascension.js`
- Modify: `src/game/bridge.js`, `src/main.js`, `src/legacy/fc_main.js`, `src/legacy/fc_preferences.js`, `src/legacy/fc_button.js` (the HC section reads the new system's report)
- Test: `test/game/ascension.test.mjs`

**Interfaces:**
- `createAscension({ game, settings, loop, buyer, log, prepare })` registers `ascension` at `everyFrames: 30`, `enabled: () => settings.autoAscend`. State machine:
  - `playing`: every 60 s append `{ t, projected }` to history (projected includes wrinkler and chocolate egg value as `fcReset` does); when `shouldAscend` says so: `prepare()` (the legacy pre-ascension routine), fill permanent slots, set `game.ascendingByMod = true` (replacing the legacy flag), `Game.Ascend(1)`, go to `ascending`.
  - `ascending`: wait for `Game.OnAscend && !Game.AscendTimer`; then `listHeavenly` → measure → rank → `planChips`; buy each; log what was bought and what is being saved for; `Game.Reincarnate(1)`; go to `playing` with a fresh history; `buyer.invalidate()`.
  - If `Game.OnAscend` is seen in `playing` without the mod's flag (manual ascension or a reload on the screen), do nothing.
- `report()`: `{ instantRate, averageRate, projected, gain, savingFor, lastAscension: { at, chips, bought } }` for the menu.
- Legacy: delete `shouldAutoAscend` and the `reincarnate` system; `autoCookieBody` no longer ascends; settings collapse to `autoAscend` (off/on) with the old five migrated on load (`autoAscendToggle == 1` → on).

- [ ] Tests (game, harness): a fresh run with buying on ascends by itself within 12 game hours, buys Legacy and Heavenly cookies, reincarnates, and its CpS a game hour after reincarnation exceeds its CpS an hour before ascending; over 24 game hours it ascends at least twice and prestige rises each time; a manual `Game.Ascend(1)` with `autoAscend` on is left on the ascension screen; with `autoAscend` off, nothing ascends in 12 hours.
- [ ] Commit: `git commit -m "Ascension system: rate rule, chip spending, permanent slots, reincarnation"`

---

### Task 5: Close out

- [ ] Compare in the harness, 24 game hours, same seed: the rate rule against the upstream "prestige doubles" rule (kept reachable by an option for the comparison), on prestige reached and CpS at the end. Record the result in the spec.
- [ ] README status (M3 done, M4 next), spec status line, `npm run deploy`.
- [ ] Commit: `git commit -m "M3 complete"`.

---

## Review of milestones 2 to 4

An independent reviewer went over milestones 2, 3 and 4 against the game's source and verified one blocker and seven major defects by running them. All are fixed, each with a regression test in `test/game/review2.test.mjs` or a unit test.

| Finding | Severity | Fix |
|---|---|---|
| The buyer froze for good at "One mind": the game asks for confirmation, `buy()` only opens the prompt, and the same candidate was chosen every tick | Blocker | Buy with the game's own bypass (what "Yes" does); a purchase the game refuses is set aside for a minute instead of retried |
| The pre-ascension routine ran at reincarnation, after the game had granted chips, and wrinklers were wiped before paying out | Major | Collect before ascending, wait for the pops to land, then ascend; the plan is made before collecting, while the bakery still stands |
| Heavenly upgrades hidden at the new prestige were bought | Major | Visibility is checked at the prestige being reached, and buying checks the game's own `canBePurchased` |
| Bulk buys and chains went past building limits | Major | Limits are passed to the buyer and chains; bulk needs the bank to cover all ten above the reserve |
| The legacy wrinkler popping compared two identical incomes after the adapter dropped its arguments | Major | The adapter honours the wrinkler count again |
| Wrinklers were credited at the maximum return even with nothing popping them | Major | Returns only when auto-popping is on; withering at the game's real rate otherwise |
| A running CpS buff inflated the measured click power | Major | Rankings are made between buffs and kept while one runs |
| A manual reincarnation was not seen as a new run | Major | Runs are tracked by the game's reset count and start date; the run's start is kept apart from the sample buffer |
| Golden payouts were sized from the wrinkler-inflated income | Minor | Sized from real CpS |
| Golden pool details: the dragon gate is 19.25%, not 15%; a wrath cookie still rolls for chain and storm; 30% of wrath building specials are debuffs | Minor | All three modelled |
| The buyer kept buying during the ascend animation | Minor | Disabled while ascending |
| Lumps were spread over whatever was affordable; Born again mode spent the Sugar baking hold | Minor | The best level is waited for; the hold reads ownership and honours the Sugar Baking Guard |
| What-ifs left the store-rebuild flag set | Minor | Added to the snapshot |
| Suspected: fortune chains, heavenly upgrades the model cannot see, permanent slots filled before their own slot was bought, dead settings | Minor | Fortune upgrades are not chained; cookie boxes, starter kits and discounts get small fixed shares; slots are assigned on the ascension screen after buying; three dead settings removed |
