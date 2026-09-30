# Cookie Clicker (Steam) — mechanics extracted from local source

Research snapshot, 2026-09-29. Analysed against Cookie Clicker v2.053 (Steam).

Read-only investigation of the game's shipped source. `<game>` stands for the game's `resources/app` directory. All line numbers refer to these files:

- `<game>/src/main.js` (16,912 lines) → `main.js`
- `<game>/src/index.html` → `index.html`
- `<game>/src/minigameMarket.js` / `minigameGarden.js` / `minigameGrimoire.js` / `minigamePantheon.js` → `market` / `garden` / `grimoire` / `pantheon`
- `<game>/steam/steam.js` → `steam.js`
- `<game>/start.js` (Electron main process) → `start.js`
- `<game>/preload.js`, `<game>/mods/ReadMe.txt`

Global constant used everywhere: `Game.fps=30` (`main.js:1971`). Buff/timer durations are stored in frames.

Items marked **[derived]** are arithmetic from the quoted formulas, not statements in the code. Nothing below is from wiki memory.

---

## 1. Version and mod API

**Version**: `var VERSION=2.053; var BETA=0;` (`index.html:17-18`), `Game.version=VERSION` (`main.js:1232`). `package.json` version `1.0.0` is the Electron wrapper only. On Steam `App=Steam` (`steam.js:43-44`), on web `App=0` (`index.html:19`).

**Hooks** (`main.js:1048`): `['logic','draw','reset','reincarnate','ticker','cps','cookiesPerClick','click','create','check']`. Registering an unknown name only logs an error (`main.js:1096-1097`). `registerHook`/`removeHook` accept a function or array (`main.js:1088-1109`).

| Hook | Call site | Notes |
|---|---|---|
| `logic` | `main.js:16607` | every logic frame, also during the ascend screen (outside the `!Game.OnAscend` block) |
| `draw` | `main.js:16756` | |
| `reset` | `main.js:3630` | param `hard` |
| `reincarnate` | `main.js:4149` | |
| `ticker` | `main.js:7557-7559` | return array of strings |
| `cps` | `main.js:5151` | receives the **pre-multiplier building sum**, not final CpS (see §10) |
| `cookiesPerClick` | `main.js:4742` | applied before the Cursed finger override at 4744 |
| `click` | `main.js:4789` | |
| `create` | `main.js:16102` | right after `Game.launchMods()` |
| `check` | `main.js:16516` | every 5 s (`Game.T%(Game.fps*5)==0`, `main.js:16315`) |

**`Game.registerMod(id,mod)`** (`main.js:1050-1068`): id sanitized with `id.replace(/\W+/g,' ')`; `'META'` is reserved; duplicate id rejected. If `Game.ready`, `init()` runs immediately followed by `load()`; otherwise init is deferred to `Game.launchMods()` (`main.js:1069-1087`, called at `main.js:16100`).

**Save/load of mod data**
- Save: `mod.save()` must return a string; stored as `id:data;` with `|`→`[P]`, `;`→`[S]` (`main.js:1125-1155`), appended as save section 9 (`main.js:2824-2825`).
- Load: parsed at `main.js:3217-3230`, then `Game.loadModData()` (`main.js:3274`, def `1156-1162`) calls `mod.load(str)` **only if an entry exists for that id** — on first run `load` is never called.
- Data persists in the save even when the mod is absent (`Game.CheckModData`, `main.js:1171-1189`).

**`info.txt`** (`ReadMe.txt:5-30`): `Name`, `ID`, `Author`, `Description`, `ModVersion`, `GameVersion`, `Date`, `Dependencies`, `LanguagePacks`, `Disabled`, `AllowSteamAchievs`.
- Must be valid JSON with `Name` and `ID` or the mod is marked broken (`start.js:412-426`, `steam.js:568-573`). The ReadMe shows fields without braces; the shipped samples are JSON objects.
- ID is sanitized identically (`start.js:417`); duplicate IDs are dropped (`start.js:418`).
- `AllowSteamAchievs`: `if (!mod.info.AllowSteamAchievs) Steam.allowSteamAchievs=false;` — inside `if (file)`, so only mods that have a `main.js` block achievements (`steam.js:595-602`). Language-only mods do not.

**Discovery and order**
- `modDirs=['/mods/local','/mods/workshop']` under `resources/app`, local scanned first; every subfolder (or symlink) containing `info.txt`, excluding `_zipped`; only `main.js` in the folder root is auto-loaded (`start.js:374-400`).
- Workshop items are downloaded to `mods/workshop/_zipped` and extracted; `info.Workshop` id is written into the extracted `info.txt` (`start.js:432-475`).
- Load order comes from the `META:` entry in the save (`steam.js:623-635`), `*` prefix = disabled. New mods are appended at the bottom; then sorted by that list (`steam.js:575-585`).
- `Disabled:1` is only the default for a mod not yet in the save's list; once listed, the save decides (`steam.js:578-580`).
- A mod is force-disabled if any dependency was not loaded earlier, or if launched modless (`steam.js:593`).

**Steam vs web differences**
- Startup order on Steam: mod scripts load → `Game.Launch` → `Game.Init` → `mod.init()` → `create` hook → save load → `mod.load()` (`main.js:16882`, `16100-16117`, `3274`). So `init()` runs **before** the save is loaded; minigames load asynchronously later (`main.js:8633-8650`).
- `Game.Win('Third-party')` is web-only (`if (!App ...)`, `main.js:1063,1086`).
- Steam achievement push is gated by `Steam.allowSteamAchievs` (`steam.js:133,165`); in-game achievements are still earned. On a later load without a blocking mod, all won vanilla achievements are sent (`steam.js:134-140`).
- `mod.dir` is set for asset paths (`steam.js:636-643`); sample usage `this.dir+'/coolCookie.png'` (`mods/local/coolerSampleMod/main.js:43`).
- Renderer has `contextIsolation:true` and only `window.api.send/receive` on channels `toMain`/`fromMain` (`preload.js:1-11`, `start.js:47-52`). No Node `require`/`fs` for mods.
- A `'log to file'` message exists that writes `resources/app/file_outputs/<name>.txt` (`start.js:505-532`) — a possible state-export channel.
- `DEV=0` → no menu, no devtools (`start.js:12,574,583`).
- Save file: `resources/app/save/save.cki` (`start.js:15,165-173`), plus Steam Cloud `save.txt` and localStorage; cloud vs local chosen by `steam.js:98-123`.
- `TopBarOffset=0` on Steam vs 32 on web (`main.js:1979-1981`).

**Automation-relevant gotchas found in passing**
- Click rate limit in `Game.ClickCookie`: `now-Game.lastClick<1000/((e?e.detail:1)===0?3:50)` (`main.js:4770`). Calling with no event → max 50/s; an event with `detail===0` → 3/s.
- Clicks under 1000/15 ms apart accumulate toward "Uncanny clicker" (`main.js:4773-4777`).
- `if (Game.cookiesEarned<Game.cookies) Game.Win('Cheated cookies taste awful')` checked every 5 s (`main.js:16442`).
- Sleep mode: with `prefs.timeout` on and 5 min without input, accumulated lag triggers `Game.Timeout()` (`main.js:16781-16786`, `1937-1945`).

---

## 2. Stock market (`minigameMarket.js`)

**Tick**: `M.secondsPerTick=60` (`market:802`); `M.tickT++` per logic frame, tick at `Game.fps*60` = 1800 frames (`market:885-894`). `M.tickT=0` on load and **no offline catch-up** in `M.load` (`market:724-762`).

**State per good**: `val`, `d` (delta), `mode` 0-5, `dur` (ticks left), `stock`, `last`, `prev`. Mode names appear only in a comment: `['stable','slow rise','slow fall','fast rise','fast fall','chaotic']` (`market:1056`).

**Resting value** (`market:261-264`): `10+10*id+(Game.Objects['Bank'].level-1)` where `id` is the good index (Farm/CRL=0 … You=17, `market:12-123`).

**Per-tick update** (`market:803-877`), `dragonBoost=Game.auraMult('Supreme Intellect')`, each `rand` a fresh unseeded `Math.random()`:

```
globD=0; globP=rand
if (rand < 0.1+0.1*dragonBoost) globD=(rand-0.5)*2
per good:
  last=0
  d *= 0.97+0.01*dragonBoost
  mode0: d*=0.95; d+=0.05*(rand-0.5)
  mode1: d*=0.99; d+=0.05*(rand-0.1)
  mode2: d*=0.99; d-=0.05*(rand-0.1)
  mode3: d+=0.15*(rand-0.1); val+=rand*5
  mode4: d-=0.15*(rand-0.1); val-=rand*5
  mode5: d+=0.3*(rand-0.5)
  val += (resting-val)*0.01
  if (globD!=0 && rand<globP):
     val-=(1+d*rand^3*7)*globD; val-=globD*(1+rand^3*7); d+=globD*(1+rand*4); dur=0
  val += ((rand-0.5)*2)^11 * 3
  d   += 0.1*(rand-0.5)
  if (rand<0.15) val+=(rand-0.5)*3
  if (rand<0.03) val+=(rand-0.5)*(10+10*dragonBoost)
  if (rand<0.1)  d+=(rand-0.5)*(0.3+0.2*dragonBoost)
  mode5: if (rand<0.5) val+=(rand-0.5)*10 ; if (rand<0.2) d=(rand-0.5)*(2+6*dragonBoost)
  mode3 && rand<0.3: d+=(rand-0.5)*0.1; val+=(rand-0.7)*10
  mode3 && rand<0.03: mode=4
  mode4 && rand<0.3: d+=(rand-0.5)*0.1; val+=(rand-0.3)*10
  if (val>100+(bankLevel-1)*3 && d>0) d*=0.9          // soft ceiling
  val+=d
  if (val<5) val+=(5-val)*0.5                          // soft floor
  if (val<5 && d<0) d*=0.95
  val=max(val,1)                                       // hard floor
  dur--
  if (dur<=0):
     dur=floor(10+rand*(690-200*dragonBoost))
     if (rand<dragonBoost && rand<0.5) mode=5
     else if (rand<0.7 && (mode==3||mode==4)) mode=5
     else mode=choose([0,1,1,2,2,3,4,5])
```

- Mode duration: uniform integer 10–699 ticks.
- Transition weights: stable 1/8, slow rise 2/8, slow fall 2/8, fast rise 1/8, fast fall 1/8, chaotic 1/8; from fast rise/fall there is a prior 70% chance of going chaotic.
- A global event forces a re-roll (`dur=0`).
- There is no hard ceiling, only the `d*=0.9` damping above `100+3*(bankLevel-1)`.
- Initial state on reset: random mode, `dur=floor(10+rand*690)`, `val=resting`, `d=rand*0.2-0.1`, then 15 ticks are simulated (`market:776-795`).

**Trading**
- Buy cost: `Game.cookiesPsRawHighest*val*overhead`, `overhead=1+0.01*(20*Math.pow(0.95,M.brokers))` (`market:207-213`). Uses `Game.Spend`.
- Sell: `Game.cookies+=Game.cookiesPsRawHighest*val*n; Game.cookiesEarned=Math.max(Game.cookies,Game.cookiesEarned)` (`market:252-253`). No overhead. Proceeds do not add to `cookiesEarned` unless the bank exceeds it, so profits do not count toward prestige directly.
- Cannot buy and sell the same good in one tick (`me.last`, `market:216,243`).
- Brokers: max `ceil(Grandma.highest/10+Grandma.level)`, price `cookiesPsRawHighest*60*20` (`market:323-324`).

**Storage** (`market:194-202`): `ceil(building.highest*(officeLevel>4?1.5:1)+bonus+building.level*10)`, bonus cumulative +25/+50/+75/+100 for office levels 1/2/3/4 (totals 25, 75, 150, 250).

**Offices** (`market:291-298`, upgrade handler `542-552`): cost is cursors **sacrificed** plus a cursor level requirement: 100/lvl 2, 200/lvl 4, 350/lvl 8, 500/lvl 10, 700/lvl 12.

**Loans** (`market:348-353`, `369-384`; buffs `main.js:14101-14181`):

| Loan | Unlock (`market:1090-1095`) | Boost | Then | Downpayment |
|---|---|---|---|---|
| 1 | officeLevel ≥ 2 | CpS ×1.5 for 2 min | ×0.25 for 4 min | 20% of bank |
| 2 | officeLevel ≥ 4 | ×2 for 0.67 min | ×0.1 for 40 min | 40% |
| 3 | officeLevel ≥ 5 | ×1.2 for 2 days | ×0.8 for 5 days | 50% |

Cannot retake while the loan or its interest buff is active. Interest is triggered by the loan buff's `onDie`.

**Reset**: `M.reset` zeroes office level, brokers, stock and profit on every ascension, not only hard reset (`market:763-796`).

---

## 3. Garden (`minigameGarden.js`)

**Tick timing** (`garden:1490-1494`, `1853-1859`)
- `M.stepT=soil.tick*60` seconds, wall-clock via `Date.now()`.
- Each frame: `M.nextStep=Math.min(M.nextStep,now+M.stepT*1000)`; tick when `now>=M.nextStep`.
- Consequence: switching to a faster soil shortens the pending tick; switching to a slower one does not lengthen it.
- No offline catch-up: at most one tick fires on load.

**Soils** (`garden:877-928`), change cooldown 10 min (`garden:1352`), cannot change while frozen (`garden:1350`):

| Soil | Tick | effMult | weedMult | Farms needed | Special |
|---|---|---|---|---|---|
| dirt | 5 min | 1 | 1 | 0 | |
| fertilizer | 3 min | 0.75 | 1.2 | 50 | |
| clay | 15 min | 1.25 | 1 | 100 | |
| pebbles | 5 min | 0.25 | 0.1 | 200 | 35% auto-unlock seed on natural death (`garden:1893`) |
| woodchips | 5 min | 0.25 | 0.1 | 300 | 3 mutation loops (`garden:1869`) |

**Plot size by farm level** (`garden:1471-1488`): 1: 2×2, 2: 3×2, 3: 3×3, 4: 4×3, 5: 4×4, 6: 5×4, 7: 5×5, 8: 6×5, 9+: 6×6.

**Aging** (`garden:1885-1897`)
- `tile[1]+=randomFloor((me.ageTick+me.ageTickR*Math.random())*M.plotBoost[y][x][0]*dragonBoost)`, `dragonBoost=1+0.05*auraMult('Supreme Intellect')`.
- Immortal plants are capped at `mature+1`; others die at age ≥ 100.
- Stages: bud < 0.333·mature, sprout < 0.666·mature, bloom < mature, mature.
- `mature` is ×0.95 with the 'Seedless to nay' achievement (`garden:620-628`).

**Plant table** (`garden:22-581`). Cost = minutes of CpS; costM = minimum cookies.

| key | ageTick | ageTickR | mature | cost | costM | flags |
|---|---|---|---|---|---|---|
| bakerWheat | 7 | 2 | 35 | 1 | 30 | |
| thumbcorn | 6 | 2 | 20 | 5 | 100 | |
| cronerice | 0.4 | 0.7 | 55 | 15 | 250 | |
| gildmillet | 2 | 1.5 | 40 | 15 | 1500 | |
| clover | 1 | 1.5 | 35 | 25 | 77777 | |
| goldenClover | 4 | 12 | 50 | 125 | 777777777777 | |
| shimmerlily | 5 | 6 | 70 | 60 | 777777 | |
| elderwort | 0.3 | 0.5 | 90 | 180 | 1e8 | immortal, noContam |
| bakeberry | 1 | 1 | 50 | 45 | 1e8 | |
| chocoroot | 4 | 0 | 25 | 15 | 100000 | |
| whiteChocoroot | 4 | 0 | 25 | 15 | 100000 | |
| whiteMildew | 8 | 12 | 70 | 20 | 9999 | fungus |
| brownMold | 8 | 12 | 70 | 20 | 9999 | fungus |
| meddleweed | 10 | 6 | 50 | 1 | 10 | weed, contam 0.05 |
| whiskerbloom | 2 | 2 | 60 | 20 | 1e6 | |
| chimerose | 1 | 1.5 | 30 | 15 | 242424 | |
| nursetulip | 0.5 | 2 | 60 | 40 | 1e9 | |
| drowsyfern | 0.05 | 0.1 | 30 | 90 | 100000 | |
| wardlichen | 5 | 4 | 65 | 10 | 10000 | |
| keenmoss | 4 | 5 | 65 | 50 | 1e6 | |
| queenbeet | 1 | 0.4 | 80 | 90 | 1e9 | noContam |
| queenbeetLump | 0.04 | 0.08 | 85 | 120 | 1e12 | noContam, not plantable |
| duketater | 0.4 | 0.1 | 95 | 480 | 1e12 | noContam |
| crumbspore | 3 | 3 | 65 | 10 | 999 | fungus, contam 0.03, noContam |
| doughshroom | 1 | 2 | 85 | 100 | 1e8 | fungus, contam 0.03, noContam |
| glovemorel | 3 | 18 | 80 | 30 | 10000 | fungus |
| cheapcap | 6 | 16 | 40 | 40 | 100000 | fungus |
| foolBolete | 5 | 25 | 50 | 15 | 10000 | fungus |
| wrinklegill | 1 | 3 | 65 | 20 | 1e6 | fungus |
| greenRot | 12 | 13 | 65 | 60 | 1e6 | fungus |
| shriekbulb | 3 | 1 | 60 | 60 | 4444444444444 | noContam |
| tidygrass | 0.5 | 0 | 40 | 90 | 1e14 | |
| everdaisy | 0.3 | 0 | 75 | 180 | 1e20 | immortal, noContam |
| ichorpuff | 1 | 1.5 | 35 | 120 | 987654321 | fungus |

**Seed cost** (`garden:1097-1101`): `Math.max(me.costM,Game.cookiesPs*me.cost*60)*(Game.HasAchiev('Seedless to nay')?0.95:1)`. Uses the current **buffed** `Game.cookiesPs`, so planting during a Frenzy costs 7× more and during a Clot half.

**Mutation procedure** (`garden:1930-1967`)
- Runs for each empty unlocked tile, `loops` times: `loops=randomFloor((woodchips?3:1)*dragonBoost)*M.loopsMult`. `loopsMult=3` for the one tick triggered by a sugar-lump refill (`garden:1663-1671`).
- Counts the 8 surrounding tiles: `neighs` (any age, A below) and `neighsM` (mature, M below).
- With at least one neighbour: each candidate from `getMuts` is rolled independently. Weeds additionally need `rand<weedMult`; weeds and fungi additionally need `rand<plotBoost[2]`. One of the passing candidates is picked uniformly (`garden:1951-1958`).
- With no neighbours, first loop only: meddleweed with chance `0.002*weedMult*plotBoost[2]` (`garden:1960-1965`).
- Tiles are processed in place in row-major order, so plants spawned or matured earlier in the same tick count for later tiles. Later loops can overwrite an earlier loop's result.

**Mutation table** (`garden:642-691`):

| Condition | Result (probability) | line |
|---|---|---|
| M(bakerWheat)≥2 | bakerWheat 0.2, thumbcorn 0.05, bakeberry 0.001 | 642 |
| M(bakerWheat)≥1 & M(thumbcorn)≥1 | cronerice 0.01 | 643 |
| M(thumbcorn)≥2 | thumbcorn 0.1, bakerWheat 0.05 | 644 |
| M(cronerice)≥1 & M(thumbcorn)≥1 | gildmillet 0.03 | 645 |
| M(cronerice)≥2 | thumbcorn 0.02 | 646 |
| M(bakerWheat)≥1 & M(gildmillet)≥1 | clover 0.03, goldenClover 0.0007 | 647 |
| M(clover)≥1 & M(gildmillet)≥1 | shimmerlily 0.02 | 648 |
| M(clover)≥2 & A(clover)<5 | clover 0.007, goldenClover 0.0001 | 649 |
| M(clover)≥4 | goldenClover 0.0007 | 650 |
| M(shimmerlily)≥1 & M(cronerice)≥1 | elderwort 0.01 | 651 |
| M(wrinklegill)≥1 & M(cronerice)≥1 | elderwort 0.002 | 652 |
| M(bakerWheat)≥1 & A(brownMold)≥1 | chocoroot 0.1 | 653 |
| M(chocoroot)≥1 & A(whiteMildew)≥1 | whiteChocoroot 0.1 | 654 |
| M(whiteMildew)≥1 & A(brownMold)≤1 | brownMold 0.5 | 655 |
| M(brownMold)≥1 & A(whiteMildew)≤1 | whiteMildew 0.5 | 656 |
| M(meddleweed)≥1 & A(meddleweed)≤3 | meddleweed 0.15 | 657 |
| M(shimmerlily)≥1 & M(whiteChocoroot)≥1 | whiskerbloom 0.01 | 659 |
| M(shimmerlily)≥1 & M(whiskerbloom)≥1 | chimerose 0.05 | 660 |
| M(chimerose)≥2 | chimerose 0.005 | 661 |
| M(whiskerbloom)≥2 | nursetulip 0.05 | 662 |
| M(chocoroot)≥1 & M(keenmoss)≥1 | drowsyfern 0.005 | 663 |
| M(cronerice)≥1 & (M(keenmoss)≥1 or M(whiteMildew)≥1) | wardlichen 0.005 | 664 |
| M(wardlichen)≥1 & A(wardlichen)<2 | wardlichen 0.05 | 665 |
| M(greenRot)≥1 & M(brownMold)≥1 | keenmoss 0.1 | 666 |
| M(keenmoss)≥1 & A(keenmoss)<2 | keenmoss 0.05 | 667 |
| M(chocoroot)≥1 & M(bakeberry)≥1 | queenbeet 0.01 | 668 |
| M(queenbeet)≥8 | queenbeetLump 0.001 | 669 |
| M(queenbeet)≥2 | duketater 0.001 | 670 |
| M(crumbspore)≥1 & A(crumbspore)≤1 | crumbspore 0.07 | 672 |
| M(crumbspore)≥1 & M(thumbcorn)≥1 | glovemorel 0.02 | 673 |
| M(crumbspore)≥1 & M(shimmerlily)≥1 | cheapcap 0.04 | 674 |
| M(doughshroom)≥1 & M(greenRot)≥1 | foolBolete 0.04 | 675 |
| M(crumbspore)≥2 | doughshroom 0.005 | 676 |
| M(doughshroom)≥1 & A(doughshroom)≤1 | doughshroom 0.07 | 677 |
| M(doughshroom)≥2 | crumbspore 0.005 | 678 |
| M(crumbspore)≥1 & M(brownMold)≥1 | wrinklegill 0.06 | 679 |
| M(whiteMildew)≥1 & M(clover)≥1 | greenRot 0.05 | 680 |
| M(wrinklegill)≥1 & M(elderwort)≥1 | shriekbulb 0.001 | 682 |
| M(elderwort)≥5 | shriekbulb 0.001 | 683 |
| A(duketater)≥3 | shriekbulb 0.005 | 684 |
| A(doughshroom)≥4 | shriekbulb 0.002 | 685 |
| M(queenbeet)≥5 | shriekbulb 0.001 | 686 |
| A(shriekbulb)==1 | shriekbulb 0.005 | 687 |
| M(bakerWheat)≥1 & M(whiteChocoroot)≥1 | tidygrass 0.002 | 689 |
| M(tidygrass)≥3 & M(elderwort)≥3 | everdaisy 0.002 | 690 |
| M(elderwort)≥1 & M(crumbspore)≥1 | ichorpuff 0.002 | 691 |

**Contamination of existing plants** (`garden:1898-1928`)
- Applies to plants without `noContam`.
- Each contaminant (meddleweed 0.05, crumbspore 0.03, doughshroom 0.03) is rolled; meddleweed also needs `rand<weedMult`. One passing contaminant is chosen.
- The plant is replaced (age 0) if a **mature** contaminant of that type is in one of the 4 cardinal neighbours and `rand<plotBoost[2]`.

**Weed/fungus origin**: weeds appear only in empty tiles with no neighbours. Fungi enter via uprooting meddleweed: `onKill` gives `0.2*(age/100)` chance to leave brownMold or crumbspore (`garden:249-252`).

**Effects** (`garden:781-874`)
- Per plant: `mult = soil.effMult × stage (0.1/0.25/0.5/1) × plotBoost[y][x][1]`, then the per-plant coefficients at `garden:836-867`.
- Additive effects use `+=`, penalties are multiplicative (`*=1-x*mult`).
- All effects are neutral (1) while frozen (`garden:808`).
- Result is `M.effs`, merged into `Game.effs` in `CalculateGains` (`main.js:4939-4952`).

**Neighbour auras** (`garden:696-779`): elderwort age ×1.03, queenbeetLump power ×0.8, nursetulip power ×1.2, shriekbulb power ×0.95, ichorpuff age ×0.5 and power ×0.5 (all range 1); tidygrass weedMult 0 (range 2, 5×5); everdaisy weedMult 0 (range 1). Scaled by the emitter's stage and soil (`garden:772-773`).

**Harvest payouts**, only if age ≥ mature, using buffed `cookiesPs`:

| Plant | Payout | line |
|---|---|---|
| bakeberry | min(3% bank, 30 min CpS) | `garden:145` |
| chocoroot / whiteChocoroot | min(3%, 3 min) | `garden:171,196` |
| queenbeet | min(4%, 60 min) | `garden:347` |
| duketater | min(8%, 2 h) | `garden:394` |
| queenbeetLump | 1 sugar lump | `garden:373` |

Crumbspore and doughshroom pay only on natural death: `min(1%,1 min)*rand` and `min(3%,5 min)*rand` (`garden:419-427`, `444-452`).

**Freeze** (`garden:997-1044`, `1853`)
- No cooldown (`nextFreeze` is unused, `garden:1095`).
- Plants don't age or mutate and give no effects; each cheapcap has a 15% chance to die on freezing.
- Harvesting and planting still work.
- The tick timer is not paused, so a tick fires immediately on unfreeze if its scheduled time passed.

**Sacrifice** (`garden:1497-1517`): requires all 34 seeds. Harvests everything, locks all seeds except baker's wheat, `Game.gainLumps(10)`, awards 'Seedless to nay' (seed cost ×0.95, maturation ×0.95, garden drop rate ×1.05 at `garden:614`).

**Ascension**: plot cleared and soil reset, seeds kept unless hard reset (`garden:1804-1847`).

---

## 4. Grimoire (`minigameGrimoire.js`)

**Max mana** (`grimoire:263-287`), recomputed every 5 frames (`grimoire:485`):
```js
var towers=Math.max(M.parent.amount,1);
var lvl=Math.max(M.parent.level,1);
M.magicM=Math.floor(4+Math.pow(towers,0.6)+Math.log((towers+(lvl-1)*10)/15+1)*15);
M.magic=Math.min(M.magicM,M.magic);
```

**Regen per frame** (`grimoire:486-488`): `M.magicPS=Math.max(0.002,Math.pow(M.magic/Math.max(M.magicM,100),0.5))*0.002`. Runs whenever the minigame is loaded, visible or not (`main.js:16284`). Sugar lump refill gives +100 magic (`grimoire:436-443`), shared 15-minute cooldown (`main.js:4547-4550`).

**Spell cost** (`grimoire:339-345`): `Math.floor((costMin+M.magicM*costPercent)*(1-0.1*auraMult('Supreme Intellect')))`.

| Spell | costMin | costPercent |
|---|---|---|
| Conjure Baked Goods | 2 | 0.4 |
| Force the Hand of Fate | 10 | 0.6 |
| Stretch Time | 8 | 0.2 |
| Spontaneous Edifice | 20 | 0.75 |
| Haggler's Charm | 10 | 0.1 |
| Summon Crafty Pixies | 10 | 0.2 |
| Gambler's Fever Dream | 3 | 0.05 |
| Resurrect Abomination | 20 | 0.1 |
| Diminish Ineptitude | 5 | 0.2 |

**Fail chance** (`grimoire:289-297`): base 0.15; ×0.1 with 'Magic adept'; ×5 with 'Magic inept'; ×(1+0.1·SI); then FtHoF adds `0.15*Game.shimmerTypes['golden'].n` (`grimoire:44-47`).

**RNG seeding** (`grimoire:312-314`):
```js
Math.seedrandom(Game.seed+'/'+M.spellsCastTotal);
if (!spell.fail || Math.random()<(1-failChance)) {out=spell.win();} else {fail=true;out=spell.fail();}
Math.seedrandom();
```
- `Game.seed` is 5 random lowercase letters (`main.js:2053-2060`), stored in the save (`main.js:2672`, `2974`), regenerated on every ascension (`main.js:3494`).
- `spellsCastTotal` is saved (`grimoire:458`) and not reset on ascension (`M.reset`, `grimoire:476-481`).
- The PRNG is David Bau's seedrandom (ARC4), embedded at `main.js:702`.

**Is the next cast predictable? Yes, fully**, given the inputs below. Seeded `Math.random()` call order for FtHoF:

1. `r1`: success iff `r1 < 1-failChance`.
2. Shimmer creation (`main.js:5316-5383`): one call if season is `valentines` or `easter` (`main.js:5336-5352`), then one each for x and y (`main.js:5354-5355`). No wrath roll is consumed because `noWrath`/`wrath` short-circuit the check at `main.js:5325`.
3. Success path (`grimoire:48-65`):
   - start with `['frenzy','multiply cookies']`, plus `'click frenzy'` if no Dragonflight buff (no RNG);
   - `rand<0.1` → push `'cookie storm','cookie storm','blab'`;
   - `Game.BuildingsOwned>=10 && rand<0.25` → push `'building special'` (call consumed only if ≥10 buildings);
   - `rand<0.15` → list replaced by `['cookie storm drop']`;
   - `rand<0.0001` → push `'free sugar lump'`;
   - `choose(choices)`; one more call for `sizeMult` if it is a storm drop.
4. Backfire path (`grimoire:66-76`):
   - start with `['clot','ruin cookies']`;
   - `rand<0.1` → push `'cursed finger','blood frenzy'`;
   - `rand<0.003` → push `'free sugar lump'`;
   - `rand<0.1` → list replaced by `['blab']`;
   - `choose`.

Inputs needed: `Game.seed`, `M.spellsCastTotal`, current fail chance, `Game.season`, `Game.BuildingsOwned>=10`, presence of the Dragonflight buff. A mod can reproduce this non-destructively by seeding the same string, replaying the calls, then calling `Math.seedrandom()`.

Caveats:
- For `'building special'` the **building** is chosen at click time with unseeded RNG among buildings with amount ≥ 10 (`main.js:5493-5514`). It falls back to frenzy if none qualify.
- Every successful cast of any spell increments `spellsCastTotal` (`grimoire:317-320`). Casts returning -1 (e.g. Stretch Time with no buffs, `grimoire:96`) do not, and cost no magic.
- `r1` is the same for whichever spell is cast at a given counter, so changing the fail chance (Diminish Ineptitude, golden cookies on screen) can flip the outcome.
- Gambler's Fever Dream picks its spell with the seeded RNG, then 1 s later casts it with `{cost:half, failChanceMax:0.5, passthrough:true}` (`grimoire:195-216`). `failChanceMax` is applied as `Math.max(failChance,0.5)` (`grimoire:311`). The inner cast uses the already-incremented counter as seed and does not increment it again.
- FtHoF cookies have no `spawnLead`, so clicking them does not count toward golden clicks or reset the natural spawn timer (`main.js:5396`, `5234`).

**Buying/selling towers (dual-cast basis)**
- Selling lowers `magicM`, which lowers every spell's cost and clamps `M.magic` down to the new max.
- Buying back raises `magicM` but does not add magic.
- `magicM` only refreshes every 5 logic frames unless `M.computeMagicM()` is called directly.
- Condition for a second cast after selling: `min(magicM_low, magicM_high-cost_high) >= floor(10+0.6*magicM_low)`.
- **[derived]** Sample values without Supreme Intellect:

| Tower level | Towers before | magicM / cost | Magic left | Sell to | magicM / cost after |
|---|---|---|---|---|---|
| 1 | 307 | 81 / 58 | 23 | 21 | 23 / 23 |
| 5 | 309 | 83 / 59 | 24 | 1 | 24 / 24 |
| 10 | 460 | 98 / 68 | 30 | 1 | 34 / 30 |
| 20 | 645 | 113 / 77 | 36 | 1 | 44 / 36 |

**Other spell numbers**
- Conjure Baked Goods: `Math.max(7,Math.min(Game.cookies*0.15,Game.cookiesPs*60*30))` (`grimoire:22`); backfire is a 15-minute clot plus a loss of `min(15% bank, 15 min CpS)+13` (`grimoire:29-32`).
- Spontaneous Edifice quirk: `buyFree` tests `Game.cookies>=price` where `price` is not a local variable (`main.js:7950-7966`). It appears to resolve to the `Game.Object` constructor's `price` argument; this was not run to confirm.

---

## 5. Golden cookies / shimmers (`main.js`)

**Spawn timing** (`main.js:5266-5283`, `5681-5738`)
- Per frame while none is spawned: `me.time++`, spawn if `Math.random()<Math.pow(Math.max(0,(me.time-me.minTime)/(me.maxTime-me.minTime)),5)`.
- `minTime=ceil(fps*60*5*m)`, `maxTime=ceil(fps*60*15*m)` — 5 and 15 minutes at m=1.
- 'Distilled essence of redoubled luck': 1% chance of a second cookie on spawn (`main.js:5279`).
- 'Golden switch [off]' disables spawning (`main.js:5675`).

| Modifier of `m` | Factor |
|---|---|
| Lucky day | /2 |
| Serendipity | /2 |
| Golden goose egg | ×0.95 |
| Heavenly luck | ×0.95 |
| Green yeast digestives | ×0.99 |
| Arcane Aura | ×(1−0.05·auraMult) |
| Sugar blessing buff | ×0.9 |
| Season star upgrades | ×0.98 (easter, halloween, valentines), ×0.95 (fools) |
| Garden | ×1/eff('goldenCookieFreq') or wrath equivalent |
| Jeremy | ×1.10 / 1.06 / 1.03 |
| Mokalsium | ×1.15 / 1.10 / 1.05 |
| Selebrak, in a season | ×0.97 / 0.98 / 0.99 (fools: 0.955 / 0.97 / 0.985) |
| Active chain | m=0.05 |

**On-screen lifetime** (`main.js:5369-5381`): 13 s, ×2 Lucky day, ×2 Serendipity, ×1.05 Decisive fate, ×1.01 each Lucky digit/number/payout, × garden duration effect, ×0.95 per other golden cookie on screen. During a chain: `max(2,10/chain)`.

**Wrath determination** (`main.js:5325`): elderWrath 1 → 1/3, 2 → 2/3, 3 → always; always with Skruuia slotted.

**Outcome pool** (`main.js:5425-5453`), built then `choose()` uniformly:

| Entry | Golden | Wrath |
|---|---|---|
| Base | frenzy, multiply cookies | clot, multiply cookies, ruin cookies |
| Skruuia | — | + clot, ruin, clot, ruin |
| chain cookie, cookie storm | 3% if `cookiesEarned>=100000` | 30% adds blood frenzy + chain + storm; otherwise the 3% roll |
| everything must go | 5% in fools season | same |
| click frenzy | `rand<0.1 && (rand<0.05 \|\| !Dragonflight)` | same |
| cursed finger | — | 10% |
| building special | 25% if `BuildingsOwned>=10` | same |
| free sugar lump | 0.05% if lumps unlocked | same |
| dragon harvest / dragonflight | gate `rand<0.15 \|\| rand<0.05`, then each with probability `auraMult` of its aura | gate `rand<0.05` |
| blab | 0.01% | same |

After building the list: 80% chance to remove the first occurrence of the previous outcome (`main.js:5447`). An active chain forces 'chain cookie'; a forced shimmer uses its forced effect. Wrath cookies never have plain 'frenzy'.

**Multipliers**
- `effectDurMod` (`main.js:5459-5477`): ×2 Get lucky, ×1.1 Lasting fortune, ×1.01 each for Lucky digit/number/payout and Green yeast digestives, ×(1+0.05·auraMult('Epoch Manipulator')), × garden effect-duration, Vomitrax ×1.07/1.05/1.02.
- Gain `mult` (`main.js:5480-5488`): ×(1+0.1·aura) Ancestral Metamorphosis for golden or Unholy Dominion for wrath, ×1.01 Green yeast digestives, ×1.03 Dragon fang, × garden gain effect.
- Discrepancy: the Epoch Manipulator aura description says cookies "stay 5% longer" (`main.js:14839`) but the code applies it to effect duration.

**Effects** (`main.js:5493-5602`; buff definitions `13862-13972`):

| Effect | Value |
|---|---|
| Frenzy | CpS ×7, `ceil(77*effectDurMod)` s |
| Dragon Harvest | ×15 (`Math.ceil(pow*1.1)` with Dragon fang), `ceil(60*eff)` s |
| Elder frenzy | ×666, `ceil(6*eff)` s |
| Clot | ×0.5, `ceil(66*eff)` s |
| Click frenzy | clicks ×777, `ceil(13*eff)` s |
| Dragonflight | clicks ×1111 (`Math.ceil(pow*1.1)` with Dragon fang), `ceil(10*eff)` s; 80% chance to kill Click frenzy |
| Cursed finger | `ceil(10*eff)` s, CpS ×0, each click worth `Game.cookiesPs*ceil(10*eff)` captured at pop time |
| Building special | `ceil(30*eff)` s, ×(`amount/10+1`) for a random building with ≥10; on wrath cookies 30% chance it is the debuff (÷ same) |
| Cookie storm | `ceil(7*eff)` s; each frame 50% chance of a drop worth `max(mult*cookiesPs*60*k, k)`, k=1..7 (`main.js:5257-5264`, `5599`) |
| Everything must go | buildings 5% cheaper, `ceil(8*eff)` s |
| Lucky | `mult*Math.min(Game.cookies*0.15,Game.cookiesPs*60*15)+13` (`main.js:5536`) |
| Ruin | `min(5% bank, 10 min CpS)+13` (`main.js:5542`) |
| Chain | see below |

- **[derived]** Lucky is maxed when bank ≥ 6000 × current CpS (900/0.15); `cookiesPs` includes active buffs, so 42,000 × base CpS under Frenzy.
- Chain (`main.js:5568-5592`): starts at `chain=1+max(0,ceil(log10(cookies))-10)`; payout `max(digit, min(floor(1/9*10^chain*digit*mult), maxPayout))`, digit 7 (6 for wrath), `maxPayout=min(6 h CpS, 50% bank)*mult`. Ends on a 1% roll or when the next payout ≥ maxPayout.

**Buff stacking** (`main.js:13748-13793`)
- Buffs are keyed by name. Re-gaining an existing buff changes only its **time**: `add` adds, `max` takes the larger, otherwise replaces. The power is not updated.
- Frenzy, Elder frenzy, Clot, Dragon Harvest, Click frenzy, Dragonflight, Cursed finger, Cookie storm and building buffs are `add:true`. Devastation, loans and the grimoire buffs are `max:true`.
- Differently named buffs multiply: all `multCpS` (`main.js:5157-5160`) and all `multClick` (`main.js:4732-4735`). Each building has its own buff name (`main.js:5886-5907`), so building specials of different buildings stack.
- Dragon's Fortune: ×(1+1.23·auraMult) per golden cookie on screen (`main.js:5108-5110`).

---

## 6. Sugar lumps (`main.js:4373-4650`)

**Unlock**: total cookies ≥ 1e9 (`main.js:4541-4545`).

**Timing** (`computeLumpTimes`, `main.js:4412-4432`), wall-clock so they grow offline:
- mature 20 h, ripe 23 h, overripe (auto-harvest) = ripe + 1 h.
- Stevia Caelestis: ripe −1 h. Diabetica Daemonicus: mature −1 h. Ichor syrup: mature −7 min.
- Sugar aging process: ripe −6 s per grandma, capped at 600.
- Rigidel: ripe −1 h / −40 min / −20 min, only when `Game.BuildingsOwned%10==0`.
- Dragon's Curve: mature and ripe divided by (1+0.05·auraMult).

**Harvest** (`main.js:4465-4484`): before mature nothing; between mature and ripe `choose([0,1])`; between ripe and overripe 1; auto-harvest gives 1 (`main.js:4609-4614`). Offline: `floor(age/overripeAge)` lumps, only the first uses the stored type (`main.js:4433-4453`).

**Type selection** (`main.js:4522-4539`), done right after each harvest:
```js
Math.seedrandom(Game.seed+'/'+Game.lumpT);
var types=[0]; var loop=1; loop+=Game.auraMult('Dragon\'s Curve'); loop=randomFloor(loop);
for (...) {
  if (Math.random()<(Game.Has('Sucralosia Inutilis')?0.15:0.1)) types.push(1); // bifurcated
  if (Math.random()<3/1000) types.push(2);                                     // golden
  if (Math.random()<0.1*Game.elderWrath) types.push(3);                        // meaty
  if (Math.random()<1/50) types.push(4);                                       // caramelized
}
Game.lumpCurrentType=choose(types);
```
- Normal (0) is always in the list and the pick is uniform, so final odds are lower than the push odds.
- `Game.lumpT` is `Date.now()` at harvest (`main.js:4488`), so the next lump's type is a deterministic function of the seed and the harvest millisecond.

**Yields** (`harvestLumps`, `main.js:4485-4521`), unseeded:

| Type | Yield multiplier | Extra |
|---|---|---|
| Normal | 1 | |
| Bifurcated | `choose([1,2])`; with Sucralosia a 5% forced double first | |
| Golden | `choose([2,3,4,5,6,7])` | `Earn(min(24 h CpS, bank))`, 24 h Sugar blessing |
| Meaty | `choose([0,0,1,2,2])` | |
| Caramelized | `choose([1,2,3])` | `Game.lumpRefill=0` |

**Other sources**: garden sacrifice 10, juicy queenbeet 1, golden cookie 'free sugar lump'.

**Uses seen**: building level-up costs `level+1` lumps (`main.js:8104-8105`); minigame refills 1 lump with a shared 15-minute cooldown; Sugar baking +1% CpS per lump up to 100 (`main.js:5095`).

---

## 7. Ascension

**Prestige formula** (`main.js:3967-3976`):
```js
Game.HCfactor=3;
Game.HowMuchPrestige=function(cookies){return Math.pow(cookies/1000000000000,1/Game.HCfactor);}
Game.HowManyCookiesReset=function(chips){return Math.pow(chips,Game.HCfactor)*1000000000000;}
```
- On ascend: `prestige=floor(HowMuchPrestige(Game.cookiesReset+Game.cookiesEarned))`; the difference is added to both prestige and heavenly chips (`main.js:3978-3991`, called at `4094`).
- The live "ascend now" calculation is at `main.js:16539-16543`.

**CpS effect** (`main.js:4954`): `mult+=prestige*0.01*Game.heavenlyPower*Game.GetHeavenlyMultiplier()`.
- Heavenly multiplier (`main.js:3993-4014`): 0.05 + 0.20 + 0.25 + 0.25 + 0.25 for the five heavenly-chip upgrades.
- Then ×(1+0.05·Dragon God), ×1.01 each Lucky digit/number/payout, Dotjeiess ×0.7/0.8/0.9.

**What `Game.Reset` does** (`main.js:3459-3650`)

Reset:
- New `Game.seed`; `cookiesReset+=cookiesEarned`; cookies, clicks, handmade zeroed; `cookiesPsRawHighest=0`.
- Pledges, elder wrath, research, season; Santa and dragon level and both auras.
- Buildings' `amount/bought/highest/free/totalCookies`.
- All non-prestige upgrades; all buffs.
- Wrinklers, via `Game.ResetWrinklers()` (`main.js:3532`). No `CollectWrinklers` call exists in `Ascend` or `Reset`, so unpopped wrinkler contents are lost.
- Minigames soft reset: market fully, pantheon slots and swaps, garden plot, grimoire magic.

Kept:
- Prestige upgrades and achievements.
- Building **levels** (not touched in the loop at `main.js:3551-3559`), sugar lumps.
- Garden seeds, `spellsCastTotal`.
- Garden-drop upgrades flagged `lasting` stay unlocked (`main.js:3565`, `11092-11100`).
- With Keepsakes each season drop has a 1/5 chance to stay unlocked (`main.js:3567`); with 'O Fortuna' fortune upgrades have a 40% chance (`main.js:3569`).

**Carry-over**
- Permanent upgrade slots I–V cost 100 / 20,000 / 3,000,000 / 400,000,000 / 50,000,000,000 chips (`main.js:10514-10518`).
- Eligible: `me.bought && me.unlocked && !me.noPerm && (me.pool=='' || me.pool=='cookie')`, not already slotted (`main.js:10543-10547`). The heavenly-chip upgrades and 'Bingo center/Research facility' are `noPerm`.
- Slotted upgrades are `earn()`ed on reset (`main.js:3584-3588`).
- Starter kit gives 10 free cursors, Starter kitchen 5 free grandmas (`main.js:3591-3592`).
- Born again mode: `Game.Has` returns 0 for prestige and fortune upgrades (`main.js:9697-9702`), no prestige CpS, no building-level bonus, minigame logic off (`main.js:16284`).

Not extracted: heavenly upgrade tree costs and the offline-production formula (`main.js:3322-3368`).

---

## 8. Pantheon and Dragon

**Slot level** (`pantheon:295-307`): `Game.hasGod(key)` returns 1 diamond, 2 ruby, 3 jade, or false. With Supreme Intellect it returns `Math.max(1,i)`, so ruby acts as diamond and jade as ruby.

**Gods** (values for diamond / ruby / jade):

| God (key) | Effect | Source |
|---|---|---|
| Holobore (`asceticism`) | CpS ×1.15 / 1.10 / 1.05 | `main.js:4989-4992` |
| | Popping any golden-type shimmer unslots it and calls `Game.useSwap(1000000)` (swaps → 0) | `main.js:5419-5422` |
| Vomitrax (`decadence`) | GC effect duration ×1.07 / 1.05 / 1.02; buildings ×0.93 / 0.95 / 0.98 | `main.js:5473-5476`, `4999-5002` |
| Godzamok (`ruin`) | Selling gives 'Devastation' for 10 s, click mult `1+sold*0.01` / `0.005` / `0.0025` | `main.js:7885-7901` |
| Cyclius (`ages`) | CpS ×(1+0.15·sin(2π·t/period)), period 3 h / 12 h / 24 h, `t=Date.now()/1000` | `main.js:4994-4997` |
| Selebrak (`seasons`) | Season switch cost ×2 / 1.5 / 1.25 | `main.js:12436-12439` |
| | GC timer in season ×0.97 / 0.98 / 0.99 | `main.js:5710-5722` |
| | Reindeer timer ×0.9 / 0.95 / 0.97; drop fail rates ×0.9 / 0.95 / 0.97 | `main.js:5848-5851`, `5803`, `10439`, `14494` |
| | Heart biscuit power ×1.3 / 1.2 / 1.1 | `main.js:10295-10298` |
| Dotjeiess (`creation`) | Building prices ×0.93 / 0.95 / 0.98; heavenly multiplier ×0.7 / 0.8 / 0.9 | `main.js:8508-8511`, `4008-4011` |
| Muridal (`labor`) | Click ×1.15 / 1.10 / 1.05; buildings ×0.97 / 0.98 / 0.99 | `main.js:4726-4729`, `5009-5012` |
| Jeremy (`industry`) | Buildings ×1.10 / 1.06 / 1.03; GC timer ×1.10 / 1.06 / 1.03 | `main.js:5004-5007`, `5699-5702` |
| Mokalsium (`mother`) | Milk ×1.10 / 1.05 / 1.03; GC timer ×1.15 / 1.10 / 1.05 | `main.js:5025-5028`, `5703-5706` |
| Skruuia (`scorn`) | All golden cookies are wrath; adds clot, ruin, clot, ruin to the pool | `main.js:5325`, `5428` |
| | Wrinkler spawn chance ×2.5 / 2 / 1.5; pop payout ×1.15 / 1.10 / 1.05 | `main.js:14368-14371`, `14475-14478` |
| Rigidel (`order`) | Lump ripening −1 h / −40 min / −20 min when `BuildingsOwned%10==0` | `main.js:4421-4427` |

- Godzamok detail: if Devastation is already active, selling does `old.multClick+=sold*rate` and does **not** refresh the duration. `sold` is per `sell()` call.
- Skruuia detail: the "digest more" bonus is applied at pop, not to the suck rate.
- Building multipliers apply per building at `main.js:5058`, not in Born again mode.
- Cyclius is only re-evaluated when gains are recalculated, at least every 10 s (`main.js:16309`).

**Swaps** (`pantheon:135-138`, `194-199`, `230-280`, `479-488`)
- 3 swaps max. Slotting via drag costs 1 and sets `swapT=Date.now()`. Unslotting is free.
- Dragging into a slot is refused at 0 swaps (`pantheon:236`).
- Regeneration, wall-clock, timer restarts at each swap: 1 h when at 2 swaps, 4 h when at 1, 16 h when at 0.
- Lump refill sets swaps to 3 (`pantheon:422-429`).
- `M.slotGod(god,slot)` itself does not check or consume swaps, nor move the DOM element (`pantheon:201-213`). Only the drag handler does.

**Dragon levels** (`main.js:14773-14823`, costs patched at `14853-14867`)
- Levels 0–4 cost 1M, 2M, 4M, 8M, 16M cookies.
- Levels 5–24 each sacrifice 100 of building `ObjectsById[level-5]` (Cursor … You).
- Level 25 sacrifices 50 of every building and unlocks the Dragon cookie; level 26 sacrifices 200 of every building and gives the second aura.
- Aura `i` is selectable at `dragonLevel>=i+4` (`main.js:14892`); second slot at level ≥ 27 (`main.js:15018`).
- Switching aura sacrifices 1 of the highest-tier owned building, free if unchanged or no buildings (`main.js:14900-14909`).

**`Game.auraMult(name)`** (`main.js:14873-14879`): 1 if equipped in either slot, +0.1 if Reality Bending is equipped and that aura is unlocked.

| # | Aura | Effect in code | Source |
|---|---|---|---|
| 1 | Breath of Milk | milk ×(1+0.05·a) | `main.js:5022` |
| 2 | Dragon Cursor | clicks ×(1+0.05·a) | `main.js:4738` |
| 3 | Elder Battalion | grandma CpS ×(1+0.01·a·non-grandma buildings) | `main.js:8777` |
| 4 | Reaper of Fields | enables Dragon Harvest outcome | `main.js:5442` |
| 5 | Earth Shatterer | sell refund 0.25×(1+a) | `main.js:7818-7824` |
| 6 | Master of the Armory | upgrade prices ×(1−0.02·a) | `main.js:9426` |
| 7 | Fierce Hoarder | building prices ×(1−0.02·a) | `main.js:8500` |
| 8 | Dragon God | heavenly multiplier ×(1+0.05·a) | `main.js:4002` |
| 9 | Arcane Aura | GC timer ×(1−0.05·a) | `main.js:5689` |
| 10 | Dragonflight | enables Dragonflight outcome | `main.js:5444` |
| 11 | Ancestral Metamorphosis | golden gains ×(1+0.1·a) | `main.js:5484` |
| 12 | Unholy Dominion | wrath gains ×(1+0.1·a) | `main.js:5483` |
| 13 | Epoch Manipulator | GC effect duration ×(1+0.05·a) | `main.js:5467` |
| 14 | Mind Over Matter | drop rate ×(1+0.25·a) | `main.js:5181` |
| 15 | Radiant Appetite | CpS ×(1+a) | `main.js:5098` |
| 16 | Dragon's Fortune | CpS ×(1+1.23·a) per golden cookie on screen | `main.js:5108-5110` |
| 17 | Dragon's Curve | lump times ÷(1+0.05·a); type loops `randomFloor(1+a)` | `main.js:4429`, `4528` |
| 18 | Reality Bending | 10% of every other unlocked aura | `main.js:14877` |
| 19 | Dragon Orbs | selling the highest-tier building with no buffs and no golden cookie: `0.1·a` chance to spawn one | `main.js:7902-7916` |
| 20 | Supreme Intellect | grimoire cost −10% and fail +10%; market more chaotic; garden +5% aging and loops; pantheon slot shift | `grimoire:294,343`, `market:805`, `garden:1866`, `pantheon:302` |
| 21 | Dragon Guts | +`round(2·a)` wrinklers, suck rate ×(1+0.2·a), pop ×(1+0.2·a) | `main.js:14275`, `5126`, `14469` |

---

## 9. Wrinklers (`main.js:14264-14540`)

- **Capacity**: 10, +2 with Elder spice, +`round(auraMult('Dragon Guts')*2)`, hard cap 14 (`main.js:14264-14277`).
- **Spawn**: per frame and per empty slot, requires `Game.elderWrath>0` (`main.js:14361-14377`):
  - `chance=0.00001*Game.elderWrath`
  - × `Game.eff('wrinklerSpawn')` (garden), ×5 Unholy bait, Skruuia ×2.5 / 2 / 1.5
  - 'Wrinkler doormat' sets chance to 0.1
- **Approach**: `me.close+=(1/Game.fps)/10` — 10 s to reach the cookie, then it starts sucking (`main.js:14381-14390`).
- **Wither** (`main.js:5116-5128`): `suckRate=1/20 × eff('wrinklerEat') × (1+0.2·Dragon Guts)`; `Game.cpsSucked=Math.min(1,sucking*suckRate)`.
- **Per frame**: player gets `Earn(cookiesPs/fps)` then `Dissolve(cookiesPs/fps*cpsSucked)` (`main.js:16275`, `16290-16293`). Each sucking wrinkler gets `me.sucked+=(Game.cookiesPs/Game.fps)*Game.cpsSucked` (`main.js:14393`) — the full withered total, not a share.
- **Pop payout** (`main.js:14467-14479`, earned at `14513`): `sucked × (1+0.2·Dragon Guts) × 1.1 × 1.05 (Sacrilegious corruption) × 3 (shiny) × 1.05 (Wrinklerspawn) × Skruuia 1.15 / 1.10 / 1.05`.
- **[derived]** 10 wrinklers, no modifiers: 50% withered, each stores 0.5 × CpS, popping all returns 5.5 × CpS plus the 0.5 kept, about 6× effective CpS.
- **Shiny**: `if (Math.random()<0.0001) me.type=1` per spawn (`main.js:14324`). No modifier to this chance was found.
- **HP**: 2.1, click −0.75, regen +0.04 per frame, pops at `hp<=0.5` (`main.js:14264`, `14399`, `14430`, `14457`). `Game.CollectWrinklers()` sets hp to 0 on all (`main.js:14285-14291`).
- Selling the last grandma collects wrinklers (`main.js:8785-8794`).

---

## 10. CpS computation (`Game.CalculateGains`, `main.js:4934-5172`)

**Structure, in order**

1. Merge minigame `effs` into `Game.effs` (`4939-4952`).
2. Build `mult` (`4954-4984`): prestige term, garden CpS effect, heralds, every owned cookie upgrade as `(1+power*0.01)`, then assorted flat upgrade multipliers.
3. Pantheon: Holobore and Cyclius into `mult`; Vomitrax, Jeremy and Muridal into `buildMult` (`4986-5013`).
4. Santa's legacy (`5015`).
5. `Game.milkProgress=Game.AchievementsOwned/25`; `milkMult`; kitten product `catMult` (`5018-5052`).
6. Per building (`5054-5063`): `storedCps=me.cps(me)`, then `*(1+me.level*0.01)*buildMult`; `storedTotalCps=amount*storedCps`; summed into `Game.cookiesPs`.
   - Building `cps` functions use tier upgrades, synergies that read **other buildings' amounts**, and grandma links (`GetTieredCpsMult`, `main.js:9890-9915`).
   - Cursor and grandma formulas read all building amounts (`main.js:8679-8701`, `8745-8781`).
7. `mult*=catMult`, egg multipliers, Sugar baking, Radiant Appetite (`5069-5098`).
8. Snapshot `rawCookiesPs=Game.cookiesPs*mult` → CpS achievements, `Game.cookiesPsRaw`, `Game.cookiesPsRawHighest=Math.max(...)` (`5100-5106`).
9. Dragon's Fortune per on-screen golden cookie, bakery-name penalty, wrinkler `cpsSucked`, Elder Covenant ×0.95, Golden switch, Shimmering veil, debug upgrades (`5108-5148`).
10. `Game.cookiesPs=Game.runModHookOnValue('cps',Game.cookiesPs)` (`5151`) — the hook sees the pre-multiplier sum.
11. `Game.unbuffedCps=Game.cookiesPs*mult` (`5155`), then all buffs' `multCpS` (`5157-5160`).
12. `Game.globalCpsMult=mult; Game.cookiesPs*=mult` (`5162-5163`).
13. `Game.computedMouseCps=Game.mouseCps()` (`5167`), `Game.computeLumpTimes()` (`5169`), `Game.recalculateGains=0`.

Called from `Game.Logic` when `Game.recalculateGains` is set (`main.js:16274`), forced every 10 s (`main.js:16309`). Wrinkler withering is not part of `Game.cookiesPs`.

**Click value** (`Game.mouseCps`, `main.js:4671-4746`): the mouse upgrades each add `Game.cookiesPs*0.01`, using final buffed CpS. It is only refreshed inside `CalculateGains`.

**Is toggling `bought`/`amount` and recalculating accurate?**

It runs the real formula; the game does exactly this in `Game.DebugUpgradeCpS` (`main.js:16075-16096`). But it has side effects and blind spots.

Persistent side effects:
- `Game.cookiesPsRawHighest` ratchets up and never comes back down in that ascension (`main.js:5106`, saved at `2758`). It sets the cookie value of every stock trade and the broker price (`market:211,252,324`).
- CpS-threshold achievements can be awarded from the simulated state (`main.js:5101-5104`). `Game.Win` is permanent, raises `AchievementsOwned` (milk, so real CpS) and pushes the Steam achievement (`main.js:12593-12609`).
- Mod `cps` and `cookiesPerClick` hooks run on every call.

Transient side effects: overwrites every building's `storedCps`/`storedTotalCps`, `Game.effs`, `cpsSucked`, `globalCpsMult`, `unbuffedCps` (season switch prices use it, `main.js:12443`), `computedMouseCps`, and lump times. A second recalculation after restoring state is required.

What a toggle misses:
- `buy()` side effects: `buyFunction` unlocks and tier achievements, `highest` (stock storage, broker cap), `Game.BuildingsOwned` (`main.js:7842-7851`). `BuildingsOwned` is what Rigidel's check reads, and it is not derived from `amount`.
- Achievements a real purchase would grant, which raise milk and kitten multipliers.
- Upgrades with no CpS term (golden cookie frequency, duration, prices) show zero delta.

Comparability:
- `Game.cookiesPs` includes active buffs and Dragon's Fortune; compare under identical buff state, or use `Game.cookiesPsRaw` or `Game.unbuffedCps`.
- Cyclius and Century egg depend on `Date.now()` (`main.js:4994-4997`, `5084-5090`).
- Building prices: `basePrice*1.15^max(0,amount-free)`, modified by `Game.modifyBuildingPrice`, then `ceil` (`main.js:7791-7796`, `8492-8514`). Upgrade prices: `main.js:9409-9431`.

---

## Not found or not examined

- Market: no offline tick simulation exists in this version's `M.load`.
- Shiny wrinkler odds: no modifiers found.
- Not examined: reindeer beyond the Selebrak lines, Santa levels, season drop tables, heavenly upgrade costs, the offline CpS formula, and how golden cookie `minTime`/`maxTime` are initialised on save load.
- The `buyFree` closure-variable reading (§4) is from reading the code only.
