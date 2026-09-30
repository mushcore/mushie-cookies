# M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the upstream Frozen Cookies code into a self-contained, crash-proof Steam mod called Mushie Cookies, with a test harness that runs the real game at about 1,000 times real time.

**Architecture:** Legacy `fc_*.js` files move to `src/legacy/` and keep running as global scripts. New code lives in ES modules under `src/`, is bundled by esbuild, and is exposed to legacy code as the global `MushieCookies`. One build step concatenates vendored libraries, the new bundle and the legacy files into the single `main.js` the Steam loader runs.

**Tech Stack:** JavaScript (ES modules, JSDoc types), esbuild, Node built-in test runner, playwright-core driving the locally installed Chrome.

**Spec:** `docs/superpowers/specs/2026-09-29-mushie-cookies-design.md`. Research the spec rests on: `docs/research/frozen-cookies-audit.md` (bug list in its section 6), `docs/research/game-mechanics-2.053.md`.

## Global Constraints

- Target game version: Cookie Clicker v2.053, Steam build.
- No network request at load or at runtime. Every library is vendored under `vendor/`.
- Fair play: the mod may read any game state; it acts only through actions a player can take; it never writes cookies, lumps, timers, buffs or RNG state, never save-scums, never grants achievements directly.
- `AllowSteamAchievs` is `1`.
- Mod name `Mushie Cookies`, mod id `mushie_cookies`.
- New code is driven by the game's `logic` hook and counts frames. New code never calls `setTimeout`, `setInterval` or reads wall-clock time for scheduling.
- Public repository: no local absolute paths, no usernames, no game files committed. The game's location comes from the `COOKIE_CLICKER_APP` environment variable or the untracked file `.mushie.local.json`.
- Code may be copied only from MIT-licensed projects, with attribution in `NOTICE.md`.
- Commits carry no co-author or tool attribution trailer.
- Tests that need the game skip with a clear message when the game location is not configured.

## Review Focus

1. **A subsystem throws on every tick.** The other subsystems keep running, the failing one is switched off after five consecutive failures, and the failure is visible in `MushieCookies.status()`. Pinned in Task 4.
2. **A what-if calculation throws halfway.** No phantom building, upgrade, achievement or season change is left in the live game. Pinned in Task 5.
3. **The mod is loaded with every setting at its default.** Nothing is bought, sold, cast or ascended, however many cookies are in the bank. Pinned in Task 9.
4. **The machine is offline.** The mod loads and runs with every non-local request blocked. Pinned in Task 3.
5. **The game location is not configured**, as on a fresh clone. `npm test` passes; game tests skip and say why. Pinned in Task 2.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Scripts and dev dependencies |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `.mushie.local.json` |
| `NOTICE.md` | Attribution for upstream and vendored libraries |
| `README.md` | What Mushie Cookies is, how to build and install |
| `vendor/*.js` | Pinned third-party libraries |
| `tools/localConfig.mjs` | Resolves the game location |
| `tools/build.mjs` | Produces `dist/MushieCookies/main.js` and `info.txt` |
| `tools/deploy.mjs` | Copies the build into the game's `mods/local/` |
| `src/main.js` | Entry of the new bundle; defines what `MushieCookies` exposes |
| `src/core/guard.js` | Error isolation with a consecutive-failure circuit breaker |
| `src/core/loop.js` | Frame-driven scheduler |
| `src/core/sim.js` | Snapshot, restore and guarded what-if |
| `src/legacy/fc_bootstrap.js` | Defines the `FrozenCookies` global the legacy files expect |
| `src/legacy/fc_boot.js` | Waits for the game and registers the mod |
| `src/legacy/*.js` | Upstream files, moved unchanged in Task 1 |
| `test/unit/*.test.mjs` | Pure-logic tests, no game needed |
| `test/harness/server.mjs` | Serves the installed game with the Steam glue stubbed |
| `test/harness/virtualTime.mjs` | In-page virtual clock, timers and seeded RNG |
| `test/harness/game.mjs` | `launchGame()` and the handle tests drive |
| `test/game/*.test.mjs` | Tests that run the real game |

---

### Task 1: Restructure, vendor, build, deploy

**Files:**
- Move: `fc_*.js`, `cc_upgrade_prerequisites.js` → `src/legacy/`
- Delete: `frozen_cookies.js`, `fc_bookmarklet_loader.js`, `fc_userscript_loader.user.js`, `index.html`, `_config.yml`, `.prettierignore`, `Steam/`
- Create: `package.json`, `.gitignore`, `NOTICE.md`, `vendor/`, `tools/localConfig.mjs`, `tools/build.mjs`, `tools/deploy.mjs`, `src/main.js`, `src/legacy/fc_bootstrap.js`, `src/legacy/fc_boot.js`
- Test: `test/unit/build.test.mjs`

**Interfaces:**
- Produces: `gameAppDir(): string | null` from `tools/localConfig.mjs`; `npm run build` writing `dist/MushieCookies/main.js` and `dist/MushieCookies/info.txt`; the global `MushieCookies` with a `version` string.

- [ ] **Step 1: Move legacy files and delete upstream loaders**

```bash
mkdir -p src/legacy
git mv fc_bank.js fc_button.js fc_gods.js fc_infobox.js fc_main.js fc_preferences.js fc_spells.js cc_upgrade_prerequisites.js src/legacy/
git rm -q -r frozen_cookies.js fc_bookmarklet_loader.js fc_userscript_loader.user.js index.html _config.yml .prettierignore Steam
```

- [ ] **Step 2: Find the Chrome version inside the game's Electron**

Run, from the game's install folder: `strings "Cookie Clicker.exe" | grep -m1 -o -E "Chrome/[0-9]+"`.
Use that major version as the esbuild target in Step 5. If the command finds nothing, use `chrome80`.

- [ ] **Step 3: Write `package.json` and `.gitignore`**

```json
{
  "name": "mushie-cookies",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Self-contained Cookie Clicker automation mod for Steam. Fork of Frozen Cookies.",
  "scripts": {
    "build": "node tools/build.mjs",
    "deploy": "node tools/build.mjs && node tools/deploy.mjs",
    "test": "node --test \"test/unit/*.test.mjs\"",
    "test:game": "node tools/build.mjs && node --test --test-concurrency=1 \"test/game/*.test.mjs\"",
    "test:all": "npm test && npm run test:game"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "playwright-core": "^1.55.0"
  }
}
```

`.gitignore`:

```
node_modules/
dist/
.mushie.local.json
```

Run: `npm install`

- [ ] **Step 4: Vendor the three libraries that are still used**

jQuery UI and jqPlot are used only by the stats chart, which Task 3 removes, so they are not vendored.

```bash
mkdir -p vendor
curl -sSfL https://code.jquery.com/jquery-3.6.0.min.js -o vendor/jquery-3.6.0.min.js
curl -sSfL https://cdnjs.cloudflare.com/ajax/libs/underscore.js/1.8.3/underscore-min.js -o vendor/underscore-1.8.3.min.js
curl -sSfL https://cdnjs.cloudflare.com/ajax/libs/jcanvas/20.1.1/min/jcanvas.min.js -o vendor/jcanvas-20.1.1.min.js
```

Verify jQuery against the hash upstream pinned:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('vendor/jquery-3.6.0.min.js')).digest('base64'))"
```

Expected: `/xUj+3OJU5yExlq6GSYGSHk7tPXikynS7ogEvDej/m4=`

- [ ] **Step 5: Write the tools and the two legacy shims**

`tools/localConfig.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';

const LOCAL_FILE = '.mushie.local.json';

/** Folder that contains the game's `src/main.js`, or null when not configured. */
export function gameAppDir(cwd = process.cwd(), env = process.env) {
    let dir = env.COOKIE_CLICKER_APP;
    const file = path.join(cwd, LOCAL_FILE);
    if (!dir && fs.existsSync(file)) {
        dir = JSON.parse(fs.readFileSync(file, 'utf8')).gameApp;
    }
    if (!dir) return null;
    return fs.existsSync(path.join(dir, 'src', 'main.js')) ? path.resolve(dir) : null;
}

export const NOT_CONFIGURED =
    'game location not configured: set COOKIE_CLICKER_APP or create .mushie.local.json ' +
    'with {"gameApp": "<path to the game\'s resources/app folder>"}';
```

`tools/build.mjs`:

```js
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outDir = path.join(root, 'dist', 'MushieCookies');

const VENDOR = ['jquery-3.6.0.min.js', 'underscore-1.8.3.min.js', 'jcanvas-20.1.1.min.js'];
// Order matters: legacy files are global scripts that reference each other at call time,
// and fc_boot.js must run last.
const LEGACY = [
    'fc_bootstrap.js',
    'fc_preferences.js',
    'cc_upgrade_prerequisites.js',
    'fc_main.js',
    'fc_gods.js',
    'fc_spells.js',
    'fc_bank.js',
    'fc_button.js',
    'fc_infobox.js',
    'fc_boot.js',
];
const TARGET = 'chrome80'; // replaced by the value found in Step 2

const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const bundled = await build({
    entryPoints: [path.join(root, 'src', 'main.js')],
    bundle: true,
    format: 'iife',
    globalName: 'MushieCookies',
    target: TARGET,
    write: false,
    legalComments: 'none',
    define: { __MUSHIE_VERSION__: JSON.stringify(pkg.version) },
});

const parts = [
    `/* Mushie Cookies ${pkg.version}. Built file: edit the sources, not this. */`,
    ...VENDOR.map((f) => `/* vendor/${f} */\n${read('vendor', f)}`),
    `/* src (bundled) */\n${bundled.outputFiles[0].text}`,
    ...LEGACY.map(
        (f) => `/* src/legacy/${f} */\n${read('src', 'legacy', f).replaceAll('__MUSHIE_VERSION__', pkg.version)}`
    ),
];

const info = {
    Name: 'Mushie Cookies',
    ID: 'mushie_cookies',
    Author: 'mushcore. Fork of Frozen Cookies by Icehawk78, Mtarnuhal, erbkaiser and contributors',
    Description: 'Plays Cookie Clicker by itself. Self-contained: loads nothing from the network.',
    ModVersion: pkg.version,
    GameVersion: 2.053,
    Date: new Date().toLocaleDateString('en-GB'),
    Dependencies: [],
    Disabled: 0,
    AllowSteamAchievs: 1,
};

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'main.js'), parts.join('\n;\n') + '\n');
fs.writeFileSync(path.join(outDir, 'info.txt'), JSON.stringify(info, null, '\t') + '\n');
console.log(`built ${path.relative(root, outDir)} (${pkg.version})`);
```

`tools/deploy.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { gameAppDir, NOT_CONFIGURED } from './localConfig.mjs';

const root = path.resolve(import.meta.dirname, '..');
const from = path.join(root, 'dist', 'MushieCookies');
const app = gameAppDir(root);
if (!app) {
    console.error(NOT_CONFIGURED);
    process.exit(1);
}
if (!fs.existsSync(path.join(from, 'main.js'))) {
    console.error('nothing to deploy: run "npm run build" first');
    process.exit(1);
}
const to = path.join(app, 'mods', 'local', 'MushieCookies');
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log('deployed to the game\'s mods/local/MushieCookies');
```

`src/main.js`:

```js
/* global __MUSHIE_VERSION__ */
export const version = __MUSHIE_VERSION__;
```

`src/legacy/fc_bootstrap.js`:

```js
// The global the legacy files attach everything to. Upstream created it in its remote loader.
var FrozenCookies = {
    baseUrl: "",
    branch: "mushie-",
    version: "__MUSHIE_VERSION__",
};
```

`src/legacy/fc_boot.js`:

```js
// Register once the game has finished loading, as upstream's loader did.
(function () {
    var waiting = setInterval(function () {
        if (typeof Game !== "undefined" && Game.ready) {
            clearInterval(waiting);
            registerMod("mushie_cookies");
        }
    }, 250);
})();
```

- [ ] **Step 6: Write the failing build test**

`test/unit/build.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const out = path.join(root, 'dist', 'MushieCookies');

test('build produces one main.js and a valid info.txt', () => {
    execFileSync(process.execPath, ['tools/build.mjs'], { cwd: root });
    assert.deepEqual(fs.readdirSync(out).sort(), ['info.txt', 'main.js']);
    const info = JSON.parse(fs.readFileSync(path.join(out, 'info.txt'), 'utf8'));
    assert.equal(info.ID, 'mushie_cookies');
    assert.equal(info.Name, 'Mushie Cookies');
    assert.equal(info.AllowSteamAchievs, 1);
});

test('built file is self-contained', () => {
    const js = fs.readFileSync(path.join(out, 'main.js'), 'utf8');
    assert.ok(!js.includes('__MUSHIE_VERSION__'), 'version placeholder was not replaced');
    for (const banned of ['getScript(', 'Game.LoadMod(', 'github.erbkaiser.com', 'erbkaiser.github.io', 'cdnjs.cloudflare.com', 'ajax.googleapis.com', 'code.jquery.com']) {
        assert.ok(!js.includes(banned), `built file still contains "${banned}"`);
    }
});

test('built file parses as a classic script', () => {
    const js = fs.readFileSync(path.join(out, 'main.js'), 'utf8');
    assert.doesNotThrow(() => new Function(js));
});
```

- [ ] **Step 7: Run the test**

Run: `npm test`
Expected: three passing tests. A failure on a banned string names the string; remove its source from the legacy file it came from.

- [ ] **Step 8: Write `NOTICE.md`**

```markdown
# Notices

Mushie Cookies is a fork of Frozen Cookies.

| Work | Authors | Source | License |
|---|---|---|---|
| Frozen Cookies | Icehawk78, Mtarnuhal, erbkaiser and contributors | https://github.com/erbkaiser/FrozenCookies | None stated upstream |
| jQuery 3.6.0 | OpenJS Foundation and contributors | https://jquery.com | MIT |
| Underscore 1.8.3 | Jeremy Ashkenas and contributors | https://underscorejs.org | MIT |
| jCanvas 20.1.1 | Caleb Evans | https://projects.calebevans.me/jcanvas | MIT |

Cookie Clicker is by Orteil and Opti. No game files are included in this repository.
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Restructure into src/legacy, vendor libraries, add build and deploy"
```

---

### Task 2: Time-lapse harness

**Files:**
- Create: `test/harness/server.mjs`, `test/harness/virtualTime.mjs`, `test/harness/game.mjs`
- Test: `test/game/harness.test.mjs`

**Interfaces:**
- Consumes: `gameAppDir()`, `NOT_CONFIGURED` from `tools/localConfig.mjs`.
- Produces, from `test/harness/game.mjs`:
  - `launchGame(options?: { seed?: string, headless?: boolean }): Promise<GameHandle | null>`; `null` when the game location is not configured.
  - `GameHandle.eval(fn, arg?)`: runs `fn` in the page and returns its result.
  - `GameHandle.advance(frames: number)`, `GameHandle.advanceSeconds(seconds: number)`: move virtual time forward, running one game logic frame per frame.
  - `GameHandle.loadMod(file: string, id: string)`: injects a built mod and waits until `Game.mods[id]` exists.
  - `GameHandle.errors: string[]`, `GameHandle.blocked: string[]`, `GameHandle.clearLogs()`.
  - `GameHandle.close()`.
  - `skipReason(): string | false` for use as a test's `skip` option.

- [ ] **Step 1: Write the server**

`test/harness/server.mjs`:

```js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
    '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

/** Serves the installed game read-only. The Steam glue is replaced by an empty script, so the game runs in its web mode. */
export async function startServer(appDir) {
    const base = path.resolve(appDir);
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        if (url === '/steam/steam.js') {
            res.writeHead(200, { 'content-type': 'text/javascript' });
            return res.end('/* Steam glue stubbed by the test harness */');
        }
        const file = path.resolve(base, '.' + url);
        if (file !== base && !file.startsWith(base + path.sep)) {
            res.writeHead(403);
            return res.end();
        }
        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end();
            }
            res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
            res.end(data);
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    return { origin, close: () => new Promise((resolve) => server.close(resolve)) };
}
```

- [ ] **Step 2: Write the virtual time shim**

`test/harness/virtualTime.mjs`. The exported function runs inside the page, before any game script, so it must not reference anything outside its own body.

```js
/**
 * Replaces the clock, timers and the unseeded RNG with virtual ones.
 * Until takeover() the clock follows real time from a fixed epoch and timers are real, so the game boots normally.
 * After takeover() time moves only through advance().
 */
export function installVirtualTime({ epoch }) {
    const RealDate = Date;
    const bootedAt = RealDate.now();
    const real = {
        setTimeout: window.setTimeout.bind(window),
        setInterval: window.setInterval.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
        clearInterval: window.clearInterval.bind(window),
        raf: window.requestAnimationFrame.bind(window),
        perfNow: performance.now.bind(performance),
    };
    const vt = { active: false, now: epoch, timers: new Map(), nextId: 1e9, frames: 0 };
    const clock = () => (vt.active ? vt.now : epoch + (RealDate.now() - bootedAt));

    class VirtualDate extends RealDate {
        constructor(...args) {
            if (args.length === 0) super(clock());
            else super(...args);
        }
        static now() {
            return clock();
        }
    }
    window.Date = VirtualDate;
    performance.now = () => (vt.active ? vt.now - epoch : real.perfNow());

    const schedule = (fn, ms, args, every) => {
        const id = vt.nextId++;
        const run = typeof fn === 'function' ? fn : new Function(String(fn));
        vt.timers.set(id, { run, args, at: vt.now + Math.max(0, Number(ms) || 0), every });
        return id;
    };
    window.setTimeout = (fn, ms, ...args) =>
        vt.active ? schedule(fn, ms, args, 0) : real.setTimeout(fn, ms, ...args);
    window.setInterval = (fn, ms, ...args) =>
        vt.active ? schedule(fn, ms, args, Math.max(1, Number(ms) || 0)) : real.setInterval(fn, ms, ...args);
    window.clearTimeout = window.clearInterval = (id) => {
        if (vt.timers.delete(id)) return;
        real.clearTimeout(id);
        real.clearInterval(id);
    };
    window.requestAnimationFrame = (fn) =>
        vt.active ? schedule(() => fn(vt.now - epoch), 16, [], 0) : real.raf(fn);

    const runDue = () => {
        // A timer that re-arms itself with a zero delay could spin forever; 1000 firings per frame is far above real use.
        for (let fired = 0; fired < 1000; fired++) {
            let next = null;
            let nextId = 0;
            for (const [id, t] of vt.timers) {
                if (t.at <= vt.now && (next === null || t.at < next.at || (t.at === next.at && id < nextId))) {
                    next = t;
                    nextId = id;
                }
            }
            if (next === null) return;
            if (next.every) next.at += next.every;
            else vt.timers.delete(nextId);
            next.run(...next.args);
        }
    };

    vt.takeover = (seed) => {
        vt.now = epoch + 10 * 60 * 1000; // fixed, and later than any real boot
        vt.active = true;
        window.Game.Loop = function () {}; // the real frame loop is replaced by advance()
        const seedrandom = Math.seedrandom;
        let reseeds = 0;
        Math.seedrandom = function (s) {
            return seedrandom.call(Math, s === undefined ? `vt/${seed}/${reseeds++}` : s);
        };
        Math.seedrandom();
    };

    vt.advance = (frames) => {
        const frameMs = 1000 / window.Game.fps;
        for (let i = 0; i < frames; i++) {
            vt.now += frameMs;
            vt.frames++;
            runDue();
            window.Game.Logic();
        }
    };

    window.__vt = vt;
}
```

- [ ] **Step 3: Write the game handle**

`test/harness/game.mjs`:

```js
import { chromium } from 'playwright-core';
import path from 'node:path';
import { gameAppDir, NOT_CONFIGURED } from '../../tools/localConfig.mjs';
import { startServer } from './server.mjs';
import { installVirtualTime } from './virtualTime.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
// Mid-June: no seasonal event is active, so runs do not depend on the day they are executed.
const EPOCH = Date.UTC(2026, 5, 15, 12, 0, 0);
const CHUNK = 9000; // five game minutes per round trip keeps the page responsive to script loads

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Use as a test's `skip` option. */
export function skipReason() {
    return gameAppDir(root) ? false : NOT_CONFIGURED;
}

export async function launchGame({ seed = 'mushie', headless = true } = {}) {
    const appDir = gameAppDir(root);
    if (!appDir) return null;
    const server = await startServer(appDir);
    const browser = await chromium.launch({ channel: process.env.MUSHIE_BROWSER || 'chrome', headless });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const blocked = [];
    const errors = [];
    await context.route(
        (url) => !url.href.startsWith(server.origin + '/'),
        (route) => {
            blocked.push(route.request().url());
            return route.abort();
        }
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push('console: ' + m.text());
    });
    await page.addInitScript(installVirtualTime, { epoch: EPOCH });
    await page.addInitScript(() => {
        try {
            localStorage.setItem('CookieClickerLang', 'EN');
        } catch (e) {}
    });
    await page.goto(server.origin + '/src/index.html');
    await page.waitForFunction(() => window.Game && window.Game.ready, null, { timeout: 60000 });
    await page.evaluate((s) => window.__vt.takeover(s), seed);
    await sleep(150); // lets the one real frame-loop timer that was already pending fire and die
    await page.evaluate(() => window.Game.HardReset(2)); // every run starts from the same state and timestamps

    const handle = {
        page,
        errors,
        blocked,
        clearLogs() {
            errors.length = 0;
            blocked.length = 0;
        },
        eval: (fn, arg) => page.evaluate(fn, arg),
        async advance(frames) {
            for (let left = frames; left > 0; left -= CHUNK) {
                await page.evaluate((n) => window.__vt.advance(n), Math.min(left, CHUNK));
            }
        },
        advanceSeconds: (seconds) => handle.advance(Math.round(seconds * 30)),
        async loadMod(file, id) {
            await page.addScriptTag({ path: file });
            for (let tries = 0; tries < 100; tries++) {
                await handle.advance(15);
                if (await page.evaluate((modId) => !!window.Game.mods[modId], id)) return;
                await sleep(20);
            }
            throw new Error(`mod "${id}" did not register. Page errors: ${errors.join(' | ') || 'none'}`);
        },
        /** Polls in real time; for things the browser loads asynchronously, such as minigame scripts. */
        async waitFor(fn, arg, timeoutMs = 15000) {
            const until = Date.now() + timeoutMs;
            while (Date.now() < until) {
                if (await page.evaluate(fn, arg)) return;
                await sleep(25);
            }
            throw new Error('waitFor timed out');
        },
        async close() {
            await browser.close();
            await server.close();
        },
    };
    handle.clearLogs();
    return handle;
}
```

- [ ] **Step 4: Write the failing harness tests**

`test/game/harness.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchGame, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('boots the installed game in web mode', { skip }, async () => {
    const game = await launchGame();
    try {
        const state = await game.eval(() => ({
            version: Game.version, web: App === 0, buildings: Game.ObjectsById.length, cookies: Game.cookies,
        }));
        assert.equal(state.version, 2.053);
        assert.equal(state.web, true);
        assert.equal(state.buildings, 20);
        assert.equal(state.cookies, 0);
    } finally {
        await game.close();
    }
});

test('one simulated hour earns exactly CpS times 3600', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.eval(() => {
            Game.Earn(1e6);
            Game.Objects['Cursor'].buy(10);
            Game.Objects['Grandma'].buy(10);
            Game.CalculateGains();
            Game.goldenCookieBuildingBuffs = Game.goldenCookieBuildingBuffs; // no-op; keeps the fixture explicit
            Game.shimmerTypes.golden.maxTime = Infinity; // no golden cookies, so income is purely passive
            Game.shimmerTypes.golden.minTime = Infinity;
        });
        const before = await game.eval(() => ({ earned: Game.cookiesEarned, cps: Game.cookiesPs, T: Game.T }));
        await game.advanceSeconds(3600);
        const after = await game.eval(() => ({ earned: Game.cookiesEarned, T: Game.T }));
        assert.equal(after.T - before.T, 108000);
        assert.ok(before.cps > 0);
        const expected = before.cps * 3600;
        assert.ok(Math.abs(after.earned - before.earned - expected) / expected < 1e-6);
    } finally {
        await game.close();
    }
});

test('two runs with the same seed are identical, a different seed differs', { skip }, async () => {
    const run = async (seed) => {
        const game = await launchGame({ seed });
        try {
            await game.eval(() => {
                Game.Earn(1e9);
                Game.Objects['Cursor'].buy(50);
            });
            await game.advanceSeconds(2 * 3600);
            return await game.eval(() => ({
                seed: Game.seed,
                spawned: Game.shimmerTypes.golden.time,
                missed: Game.missedGoldenClicks,
                randoms: [Math.random(), Math.random(), Math.random()],
            }));
        } finally {
            await game.close();
        }
    };
    const a = await run('alpha');
    const b = await run('alpha');
    const c = await run('beta');
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.randoms, c.randoms);
});

test('timers created after takeover run on virtual time', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.eval(() => {
            window.__ticks = 0;
            setInterval(() => window.__ticks++, 1000);
        });
        await game.advanceSeconds(10);
        assert.equal(await game.eval(() => window.__ticks), 10);
    } finally {
        await game.close();
    }
});
```

Write `.mushie.local.json` locally (it is ignored by git) so the tests run on this machine:

```json
{ "gameApp": "<path to the game's resources/app folder>" }
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:game`
Expected: four passing tests. If `Game.HardReset(2)` is not the no-prompt form in this version, read `Game.HardReset` in the game's `main.js` and use the call that resets without a prompt.

- [ ] **Step 6: Confirm the skip path**

Run: `COOKIE_CLICKER_APP= npx -y cross-env-shell "mv .mushie.local.json .mushie.local.json.off && npm run test:game; mv .mushie.local.json.off .mushie.local.json"`
Expected: four skipped tests, each showing the "game location not configured" message, and exit code 0.

- [ ] **Step 7: Commit**

```bash
git add test/harness test/game/harness.test.mjs
git commit -m "Add time-lapse harness that runs the installed game on virtual time"
```

---

### Task 3: Offline boot

**Files:**
- Modify: `src/legacy/fc_main.js` (remove the stats chart and the self-awarded achievement), `src/legacy/fc_preferences.js` (remove the `trackStats` preference), `src/legacy/fc_button.js` (remove the README link to upstream)
- Test: `test/game/offline.test.mjs`

**Interfaces:**
- Consumes: `launchGame`, `skipReason`, `GameHandle.loadMod`.
- Produces: a built mod that registers as `mushie_cookies` in the harness.

- [ ] **Step 1: Write the failing test**

`test/game/offline.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launchGame, skipReason } from '../harness/game.mjs';

const skip = skipReason();
const MOD = path.resolve(import.meta.dirname, '..', '..', 'dist', 'MushieCookies', 'main.js');

test('mod loads and runs with the network blocked', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.loadMod(MOD, 'mushie_cookies');
        await game.advanceSeconds(120);
        assert.deepEqual(game.blocked, [], 'the mod tried to reach the network');
        assert.deepEqual(game.errors, []);
        const state = await game.eval(() => ({
            version: MushieCookies.version,
            legacy: typeof FrozenCookies === 'object' && typeof autoCookie === 'function',
            thirdParty: Game.Achievements['Third-party'].won,
        }));
        assert.match(state.version, /^\d+\.\d+\.\d+$/);
        assert.equal(state.legacy, true);
        assert.equal(state.thirdParty, 1, 'in web mode the game itself awards this when any mod registers');
    } finally {
        await game.close();
    }
});
```

- [ ] **Step 2: Run it and read the failures**

Run: `npm run test:game`
Expected: FAIL. The failures list what still reaches for the network or a removed library. Fix each at its source in the following steps.

- [ ] **Step 3: Remove the stats chart**

The chart is the only user of jQuery UI and jqPlot. In `src/legacy/fc_main.js` delete:
- the functions `statSpeed`, `saveStats`, `viewStatGraphs` (upstream lines 2461-2560);
- every call to `saveStats()` and every branch on `FrozenCookies.trackStats` (upstream lines 2716-2717, 3159-3165, 3683-3695);
- the `statBot` block in `FCStart` (upstream lines 3361-3364);
- the two `FrozenCookies.trackedStats = []` assignments (upstream lines 221 and 468) and the `trackStats = 0` preset line (upstream line 963).

In `src/legacy/fc_preferences.js` delete the `trackStats` entry (upstream lines 559-572).

Check: `grep -n -E "trackStats|trackedStats|saveStats|statSpeed|viewStatGraphs|statBot|jqplot|\.dialog\(" src/legacy/*.js` prints nothing.

- [ ] **Step 4: Remove the self-awarded achievement and the upstream link**

In `src/legacy/fc_main.js` delete these two lines (upstream lines 283-284):

```js
    // Give free achievements!
    if (!Game.HasAchiev("Third-party")) Game.Win("Third-party");
```

In `src/legacy/fc_button.js`, change the README link (upstream line 1161) to `https://github.com/mushcore/mushie-cookies#readme`.

- [ ] **Step 5: Run the tests**

Run: `npm run test:all`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Load fully offline; remove stats chart and self-awarded achievement"
```

---

### Task 4: Error isolation and the frame loop

**Files:**
- Create: `src/core/guard.js`, `src/core/loop.js`
- Modify: `src/main.js`, `src/legacy/fc_main.js` (`registerMod`, `autoCookie`, `FCStart`)
- Test: `test/unit/guard.test.mjs`, `test/unit/loop.test.mjs`, `test/game/isolation.test.mjs`

**Interfaces:**
- Produces, from `src/core/guard.js`:
  - `createGuard(options?: { maxFailures?: number, onError?: (name: string, error: Error, disabled: boolean) => void })` returning `{ guard(name, fn), status(), revive(name) }`.
  - `guard(name, fn)` returns a function with `fn`'s signature that returns `undefined` when `fn` throws or when `name` is disabled.
  - `status()` returns `{ [name]: { runs, failures, streak, disabled, lastError: string | null } }`.
- Produces, from `src/core/loop.js`:
  - `createLoop(guards)` returning `{ add(name, tick, options?: { everyFrames?: number, enabled?: () => boolean }), run(frame: number) }`.
- Produces, on the global: `MushieCookies.guard(name, fn)`, `MushieCookies.loop`, `MushieCookies.status()`, `MushieCookies.revive(name)`.

- [ ] **Step 1: Write the failing unit tests**

`test/unit/guard.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuard } from '../../src/core/guard.js';

test('passes arguments, this and the return value through', () => {
    const { guard } = createGuard();
    const obj = { base: 10, add: guard('add', function (a, b) { return this.base + a + b; }) };
    assert.equal(obj.add(1, 2), 13);
});

test('a throwing function returns undefined and is counted', () => {
    const seen = [];
    const { guard, status } = createGuard({ onError: (name, error, disabled) => seen.push([name, error.message, disabled]) });
    const boom = guard('boom', () => { throw new Error('nope'); });
    assert.equal(boom(), undefined);
    assert.deepEqual(seen, [['boom', 'nope', false]]);
    assert.deepEqual(status().boom, { runs: 0, failures: 1, streak: 1, disabled: false, lastError: 'nope' });
});

test('disables after maxFailures consecutive failures and stops calling', () => {
    let calls = 0;
    const { guard, status } = createGuard({ maxFailures: 3 });
    const boom = guard('boom', () => { calls++; throw new Error('x'); });
    for (let i = 0; i < 10; i++) boom();
    assert.equal(calls, 3);
    assert.equal(status().boom.disabled, true);
});

test('a success resets the streak', () => {
    let fail = true;
    const { guard, status } = createGuard({ maxFailures: 3 });
    const flaky = guard('flaky', () => { if (fail) throw new Error('x'); return 'ok'; });
    flaky(); flaky();
    fail = false;
    assert.equal(flaky(), 'ok');
    fail = true;
    flaky(); flaky();
    assert.equal(status().flaky.disabled, false);
    assert.equal(status().flaky.failures, 4);
});

test('revive re-enables a disabled name', () => {
    let fail = true;
    const { guard, status, revive } = createGuard({ maxFailures: 1 });
    const f = guard('f', () => { if (fail) throw new Error('x'); return 1; });
    f();
    assert.equal(status().f.disabled, true);
    fail = false;
    revive('f');
    assert.equal(f(), 1);
});

test('two functions under one name share a breaker', () => {
    const { guard, status } = createGuard({ maxFailures: 2 });
    const a = guard('shared', () => { throw new Error('a'); });
    const b = guard('shared', () => { throw new Error('b'); });
    a(); b();
    assert.equal(status().shared.disabled, true);
});

test('a non-Error throw is reported as a string', () => {
    const { guard, status } = createGuard();
    guard('s', () => { throw 'plain'; })();
    assert.equal(status().s.lastError, 'plain');
});

test('an onError that throws does not escape', () => {
    const { guard } = createGuard({ onError: () => { throw new Error('reporter broke'); } });
    assert.doesNotThrow(guard('x', () => { throw new Error('x'); }));
});
```

`test/unit/loop.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuard } from '../../src/core/guard.js';
import { createLoop } from '../../src/core/loop.js';

test('runs systems on their own cadence', () => {
    const loop = createLoop(createGuard());
    const ran = { every: 0, third: 0 };
    loop.add('every', () => ran.every++);
    loop.add('third', () => ran.third++, { everyFrames: 3 });
    for (let frame = 1; frame <= 9; frame++) loop.run(frame);
    assert.deepEqual(ran, { every: 9, third: 3 });
});

test('a failing system does not stop the ones after it', () => {
    const guards = createGuard({ maxFailures: 5 });
    const loop = createLoop(guards);
    let after = 0;
    loop.add('bad', () => { throw new Error('bad'); });
    loop.add('good', () => after++);
    for (let frame = 1; frame <= 20; frame++) loop.run(frame);
    assert.equal(after, 20);
    assert.equal(guards.status().bad.disabled, true);
    assert.equal(guards.status().bad.failures, 5);
});

test('a disabled-by-setting system is skipped and not counted as a failure', () => {
    const guards = createGuard();
    const loop = createLoop(guards);
    let on = false, ran = 0;
    loop.add('opt', () => ran++, { enabled: () => on });
    loop.run(1);
    on = true;
    loop.run(2);
    assert.equal(ran, 1);
    assert.equal(guards.status().opt.failures, 0);
});

test('a throwing enabled check is isolated like a throwing tick', () => {
    const guards = createGuard();
    const loop = createLoop(guards);
    let after = 0;
    loop.add('bad', () => {}, { enabled: () => { throw new Error('check broke'); } });
    loop.add('good', () => after++);
    loop.run(1);
    assert.equal(after, 1);
    assert.equal(guards.status().bad.failures, 1);
});

test('rejects duplicate names and bad cadences', () => {
    const loop = createLoop(createGuard());
    loop.add('a', () => {});
    assert.throws(() => loop.add('a', () => {}), /duplicate/);
    assert.throws(() => loop.add('b', () => {}, { everyFrames: 0 }), /everyFrames/);
    assert.throws(() => loop.add('c', () => {}, { everyFrames: 1.5 }), /everyFrames/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test`
Expected: FAIL with "Cannot find module" for `guard.js` and `loop.js`.

- [ ] **Step 3: Implement**

`src/core/guard.js`:

```js
/**
 * Error isolation. A guarded function never throws; after `maxFailures` consecutive failures
 * everything sharing its name is switched off until revived.
 */
export function createGuard({ maxFailures = 5, onError = () => {} } = {}) {
    const states = new Map();
    const stateOf = (name) => {
        if (!states.has(name)) states.set(name, { runs: 0, failures: 0, streak: 0, disabled: false, lastError: null });
        return states.get(name);
    };

    function guard(name, fn) {
        const s = stateOf(name);
        return function guarded(...args) {
            if (s.disabled) return undefined;
            try {
                const result = fn.apply(this, args);
                s.runs++;
                s.streak = 0;
                return result;
            } catch (error) {
                s.failures++;
                s.streak++;
                s.lastError = error instanceof Error ? error.message : String(error);
                if (s.streak >= maxFailures) s.disabled = true;
                try {
                    onError(name, error instanceof Error ? error : new Error(String(error)), s.disabled);
                } catch (reporterError) {
                    // A broken reporter must not defeat the isolation it reports on.
                }
                return undefined;
            }
        };
    }

    function status() {
        const out = {};
        for (const [name, s] of states) out[name] = { ...s };
        return out;
    }

    function revive(name) {
        const s = stateOf(name);
        s.disabled = false;
        s.streak = 0;
    }

    return { guard, status, revive };
}
```

`src/core/loop.js`:

```js
/** Frame-driven scheduler. Each system is isolated by the guard set it is given. */
export function createLoop(guards) {
    const systems = [];

    function add(name, tick, { everyFrames = 1, enabled = () => true } = {}) {
        if (systems.some((s) => s.name === name)) throw new Error(`duplicate system: ${name}`);
        if (!Number.isInteger(everyFrames) || everyFrames < 1) {
            throw new Error(`everyFrames must be a positive integer, got ${everyFrames}`);
        }
        const step = guards.guard(name, (frame) => {
            if (enabled()) tick(frame);
        });
        systems.push({ name, everyFrames, step });
    }

    function run(frame) {
        for (const s of systems) {
            if (frame % s.everyFrames === 0) s.step(frame);
        }
    }

    return { add, run };
}
```

A system whose `enabled()` returns false still counts as a run in `status()`. That is intended: `runs` means "reached without error".

`src/main.js`:

```js
/* global __MUSHIE_VERSION__ */
import { createGuard } from './core/guard.js';
import { createLoop } from './core/loop.js';

export const version = __MUSHIE_VERSION__;

const guards = createGuard({
    maxFailures: 5,
    onError(name, error, disabled) {
        console.error(`[Mushie Cookies] ${name} failed: ${error.message}` + (disabled ? ' (switched off after repeated failures)' : ''));
    },
});

export const guard = guards.guard;
export const status = guards.status;
export const revive = guards.revive;
export const loop = createLoop(guards);
```

- [ ] **Step 4: Run the unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Wire the loop and harden the legacy timers**

In `src/legacy/fc_main.js`, inside `registerMod`'s `init`, add as the first statement:

```js
            Game.registerHook("logic", function () {
                MushieCookies.loop.run(Game.T);
            });
```

Rename the existing function `autoCookie` to `autoCookieBody`, remove from it the two blocks that reschedule with `setTimeout(autoCookie, ...)` and the `FrozenCookies.processing` reads and writes, and have it return `itemBought`. Then add:

```js
function autoCookie() {
    var itemBought = false;
    if (!FrozenCookies.processing && !Game.OnAscend && !Game.AscendTimer) {
        FrozenCookies.processing = true;
        try {
            itemBought = !!MushieCookies.guard("legacy:autoCookie", autoCookieBody)();
        } finally {
            FrozenCookies.processing = false;
        }
    }
    if (FrozenCookies.frequency) {
        FrozenCookies.cookieBot = setTimeout(autoCookie, itemBought ? 0 : FrozenCookies.frequency);
    }
}
```

When the guard switches `legacy:autoCookie` off, the timer keeps ticking cheaply and does nothing, so reviving it needs no restart.

In `FCStart`, wrap the callback of every `setInterval` and `setTimeout` in `MushieCookies.guard("legacy:<name>", <callback>)`, where `<name>` is the callback's own function name. Also add the two missing clears at the top of `FCStart`, next to the existing ones:

```js
    if (FrozenCookies.frenzyClickBot) {
        clearInterval(FrozenCookies.frenzyClickBot);
        FrozenCookies.frenzyClickBot = 0;
    }
    if (FrozenCookies.autoSweetBot) {
        clearInterval(FrozenCookies.autoSweetBot);
        FrozenCookies.autoSweetBot = 0;
    }
```

Check: `grep -n -E "set(Interval|Timeout)\(" src/legacy/fc_main.js` shows every callback wrapped in `MushieCookies.guard(` except the one inside the new `autoCookie`.

- [ ] **Step 6: Write the failing isolation test**

`test/game/isolation.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launchGame, skipReason } from '../harness/game.mjs';

const skip = skipReason();
const MOD = path.resolve(import.meta.dirname, '..', '..', 'dist', 'MushieCookies', 'main.js');

test('a system that always throws is switched off and the rest keep running', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.loadMod(MOD, 'mushie_cookies');
        await game.eval(() => {
            window.__good = 0;
            MushieCookies.loop.add('test:bad', () => { throw new Error('always'); });
            MushieCookies.loop.add('test:good', () => window.__good++);
        });
        game.clearLogs();
        await game.advance(60);
        const out = await game.eval(() => ({ good: window.__good, bad: MushieCookies.status()['test:bad'] }));
        assert.equal(out.good, 60);
        assert.equal(out.bad.disabled, true);
        assert.equal(out.bad.failures, 5);
        assert.equal(game.errors.filter((e) => e.includes('test:bad')).length, 5, 'each failure is reported once');
    } finally {
        await game.close();
    }
});

test('the legacy main loop survives an exception and keeps its timer', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.loadMod(MOD, 'mushie_cookies');
        await game.eval(() => {
            window.__calls = 0;
            const real = window.updateCaches;
            window.updateCaches = function () {
                window.__calls++;
                if (window.__calls <= 2) throw new Error('injected');
                return real.apply(this, arguments);
            };
        });
        await game.advanceSeconds(5);
        const out = await game.eval(() => ({
            calls: window.__calls,
            processing: FrozenCookies.processing,
            state: MushieCookies.status()['legacy:autoCookie'],
        }));
        assert.ok(out.calls > 10, `loop stopped after ${out.calls} calls`);
        assert.equal(out.processing, false);
        assert.equal(out.state.failures, 2);
        assert.equal(out.state.disabled, false);
    } finally {
        await game.close();
    }
});
```

- [ ] **Step 7: Run all tests**

Run: `npm run test:all`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Isolate errors: guarded legacy timers and a frame-driven loop"
```

---

### Task 5: Safe what-if calculations

**Files:**
- Create: `src/core/sim.js`
- Modify: `src/main.js`, `src/legacy/fc_main.js` (`buildingStats`, `upgradeStats`, `buildingToggle`, `upgradeToggle`, `setOverrides`, `fcWin`)
- Modify: `src/legacy/fc_preferences.js` (remove `showAchievements`)
- Test: `test/unit/sim.test.mjs`, `test/game/sim.test.mjs`

**Interfaces:**
- Produces, from `src/core/sim.js`:
  - `takeSnapshot(game): Snapshot`
  - `restoreSnapshot(game, snapshot): void`
  - `diffSnapshots(a, b): string[]`, empty when equal
  - `simulate(game, { apply: () => void, measure: () => T, revert?: () => void }): T`
- Produces, on the global: `MushieCookies.simulate`, `MushieCookies.takeSnapshot`, `MushieCookies.diffSnapshots`.

`Snapshot` covers every field a what-if is allowed to disturb: `cookiesPsRawHighest`, `BuildingsOwned`, `UpgradesOwned`, `AchievementsOwned`, `season`, `elderWrath`, `pledges`, and per building `amount` and `bought`, per upgrade `bought` and `unlocked`, per achievement `won`.

- [ ] **Step 1: Write the failing unit tests**

`test/unit/sim.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeSnapshot, restoreSnapshot, diffSnapshots, simulate } from '../../src/core/sim.js';

function fakeGame() {
    const game = {
        cookiesPsRawHighest: 100, cookiesPsRaw: 100, cookiesPs: 100,
        BuildingsOwned: 3, UpgradesOwned: 1, AchievementsOwned: 1,
        season: '', elderWrath: 0, pledges: 0, recalculateGains: 0,
        ObjectsById: [{ amount: 2, bought: 2 }, { amount: 1, bought: 1 }],
        UpgradesById: [{ bought: 1, unlocked: 1 }, { bought: 0, unlocked: 0 }],
        AchievementsById: [{ won: 1 }, { won: 0 }],
        wins: [],
        Win(name) { this.wins.push(name); },
        CalculateGains() {
            this.cookiesPsRaw = this.ObjectsById.reduce((sum, b) => sum + b.amount * 50, 0) * (this.UpgradesById[1].bought ? 2 : 1);
            this.cookiesPs = this.cookiesPsRaw;
            if (this.cookiesPsRaw >= 200) this.Win('Fast baker');
            this.cookiesPsRawHighest = Math.max(this.cookiesPsRawHighest, this.cookiesPsRaw);
            this.recalculateGains = 0;
        },
    };
    game.CalculateGains();
    return game;
}

test('snapshot round trip leaves no difference', () => {
    const game = fakeGame();
    const snap = takeSnapshot(game);
    game.ObjectsById[0].amount = 99;
    game.UpgradesById[1].bought = 1;
    game.AchievementsById[1].won = 1;
    game.season = 'easter';
    assert.deepEqual(diffSnapshots(snap, takeSnapshot(game)).sort(), ['achievement 1 won', 'building 0 amount', 'season', 'upgrade 1 bought']);
    restoreSnapshot(game, snap);
    assert.deepEqual(diffSnapshots(snap, takeSnapshot(game)), []);
});

test('simulate returns the measurement and restores everything', () => {
    const game = fakeGame();
    const before = takeSnapshot(game);
    const cps = simulate(game, {
        apply() { game.ObjectsById[0].amount += 1; game.ObjectsById[0].bought += 1; game.BuildingsOwned += 1; },
        measure: () => game.cookiesPs,
    });
    assert.equal(cps, 200);
    assert.deepEqual(diffSnapshots(before, takeSnapshot(game)), []);
    assert.equal(game.cookiesPs, 150);
});

test('achievements and the highest-CpS record are not touched by a what-if', () => {
    const game = fakeGame();
    simulate(game, {
        apply() { game.UpgradesById[1].bought = 1; },
        measure: () => game.cookiesPs,
    });
    assert.deepEqual(game.wins, []);
    assert.equal(game.cookiesPsRawHighest, 150);
});

test('a real new high reached before the what-if is kept', () => {
    const game = fakeGame();
    game.ObjectsById[1].amount = 4; // a real purchase whose recalculation is still pending
    simulate(game, { apply() {}, measure: () => 0 });
    assert.equal(game.cookiesPsRawHighest, 300);
    assert.deepEqual(game.wins, ['Fast baker'], 'the real state earns its achievement on the closing recalculation');
});

test('a throwing measure still restores, and the error propagates', () => {
    const game = fakeGame();
    const before = takeSnapshot(game);
    const win = game.Win;
    assert.throws(() => simulate(game, {
        apply() { game.ObjectsById[0].amount += 5; game.season = 'halloween'; },
        measure() { throw new Error('measure broke'); },
    }), /measure broke/);
    assert.deepEqual(diffSnapshots(before, takeSnapshot(game)), []);
    assert.equal(game.Win, win);
    assert.equal(game.cookiesPs, 150);
});

test('a throwing apply still restores', () => {
    const game = fakeGame();
    const before = takeSnapshot(game);
    assert.throws(() => simulate(game, {
        apply() { game.ObjectsById[0].amount += 5; throw new Error('apply broke'); },
        measure: () => 0,
    }), /apply broke/);
    assert.deepEqual(diffSnapshots(before, takeSnapshot(game)), []);
});

test('a throwing revert does not prevent the restore', () => {
    const game = fakeGame();
    const before = takeSnapshot(game);
    const out = simulate(game, {
        apply() { game.elderWrath = 3; },
        measure: () => 'measured',
        revert() { throw new Error('revert broke'); },
    });
    assert.equal(out, 'measured');
    assert.deepEqual(diffSnapshots(before, takeSnapshot(game)), []);
});

test('nested what-ifs restore to their own starting points', () => {
    const game = fakeGame();
    const before = takeSnapshot(game);
    const out = simulate(game, {
        apply() { game.ObjectsById[0].amount += 1; },
        measure() {
            const inner = simulate(game, {
                apply() { game.ObjectsById[1].amount += 1; },
                measure: () => game.cookiesPs,
            });
            return [game.cookiesPs, inner];
        },
    });
    assert.deepEqual(out, [200, 250]);
    assert.deepEqual(diffSnapshots(before, takeSnapshot(game)), []);
    assert.deepEqual(game.wins, []);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test`
Expected: FAIL with "Cannot find module" for `sim.js`.

- [ ] **Step 3: Implement**

`src/core/sim.js`:

```js
const SCALARS = ['cookiesPsRawHighest', 'BuildingsOwned', 'UpgradesOwned', 'AchievementsOwned', 'season', 'elderWrath', 'pledges'];

/** Everything a what-if is allowed to disturb. */
export function takeSnapshot(game) {
    const snap = {
        buildings: game.ObjectsById.map((b) => [b.amount, b.bought]),
        upgrades: game.UpgradesById.map((u) => [u.bought, u.unlocked]),
        achievements: game.AchievementsById.map((a) => a.won),
    };
    for (const key of SCALARS) snap[key] = game[key];
    return snap;
}

export function restoreSnapshot(game, snap) {
    snap.buildings.forEach(([amount, bought], i) => {
        game.ObjectsById[i].amount = amount;
        game.ObjectsById[i].bought = bought;
    });
    snap.upgrades.forEach(([bought, unlocked], i) => {
        game.UpgradesById[i].bought = bought;
        game.UpgradesById[i].unlocked = unlocked;
    });
    snap.achievements.forEach((won, i) => {
        game.AchievementsById[i].won = won;
    });
    for (const key of SCALARS) game[key] = snap[key];
}

/** Human-readable list of what differs; empty when the two are equal. */
export function diffSnapshots(a, b) {
    const out = [];
    for (const key of SCALARS) if (a[key] !== b[key]) out.push(key);
    a.buildings.forEach(([amount, bought], i) => {
        if (amount !== b.buildings[i][0]) out.push(`building ${i} amount`);
        if (bought !== b.buildings[i][1]) out.push(`building ${i} bought`);
    });
    a.upgrades.forEach(([bought, unlocked], i) => {
        if (bought !== b.upgrades[i][0]) out.push(`upgrade ${i} bought`);
        if (unlocked !== b.upgrades[i][1]) out.push(`upgrade ${i} unlocked`);
    });
    a.achievements.forEach((won, i) => {
        if (won !== b.achievements[i]) out.push(`achievement ${i} won`);
    });
    return out;
}

/**
 * Runs a what-if against the live game and guarantees the game is left as it was found.
 * While it runs, the game cannot award achievements and the highest-CpS record is frozen.
 */
export function simulate(game, { apply, measure, revert }) {
    const snap = takeSnapshot(game);
    const win = game.Win;
    game.Win = function () {};
    try {
        apply();
        game.recalculateGains = 1;
        game.CalculateGains();
        return measure();
    } finally {
        try {
            if (revert) revert();
        } catch (error) {
            // The snapshot restore below is authoritative for everything it covers.
        }
        restoreSnapshot(game, snap);
        game.Win = win;
        game.recalculateGains = 1;
        game.CalculateGains();
        // The closing recalculation is of the real state, so its own high is legitimate; anything above it came from the what-if.
        game.cookiesPsRawHighest = Math.max(snap.cookiesPsRawHighest, game.cookiesPsRaw);
    }
}
```

Add to `src/main.js`:

```js
export { simulate, takeSnapshot, diffSnapshots } from './core/sim.js';
```

- [ ] **Step 4: Run the unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Route the legacy purchase calculations through `simulate`**

In `src/legacy/fc_main.js`:

1. Split `buildingToggle` into the state change alone. Replace the whole function with:

```js
function buildingApply(building) {
    building.amount += 1;
    building.bought += 1;
    Game.BuildingsOwned += 1;
}
```

2. Split `upgradeToggle` into `upgradeApply(upgrade)` and `upgradeRevert(upgrade, reverseFunctions)`. `upgradeApply` is the body of the old `if (!achievements)` branch and returns `reverseFunctions`; its recursive call becomes `upgradeApply(upgrade)`. `upgradeRevert` is the body of the old `else` branch up to and including `buyFunctionToggle(reverseFunctions.current);`, with its recursive call becoming `upgradeRevert(upgrade, u.reverseFunctions)`. Neither function touches achievements, `Game.cookiesPsRawHighest`, `Game.recalculateGains` or `Game.CalculateGains`; `simulate` owns those.

3. In `buildingStats`, replace the block from `var existingAchievements = ...` through `buildingToggle(current, existingAchievements);` with:

```js
                var measured = MushieCookies.simulate(Game, {
                    apply: function () {
                        buildingApply(current);
                    },
                    measure: function () {
                        return { base: baseCps(), effective: effectiveCps(currentBank) };
                    },
                });
                var baseCpsNew = measured.base;
                var cpsNew = measured.effective;
```

4. In `upgradeStats`, make the same replacement around its `upgradeToggle` pair, keeping whatever it measures between the two calls inside `measure`:

```js
                var reverse;
                var measured = MushieCookies.simulate(Game, {
                    apply: function () {
                        reverse = upgradeApply(current);
                    },
                    measure: function () {
                        return { base: baseCps(), effective: effectiveCps(currentBank) };
                    },
                    revert: function () {
                        upgradeRevert(current, reverse);
                    },
                });
```

5. Find every other caller: `grep -n -E "buildingToggle|upgradeToggle" src/legacy/*.js`. Convert each the same way. The command must print nothing when done.

6. `simulate` now prevents a what-if from awarding achievements, which was the reason upstream replaced `Game.Win`. Delete the line `Game.Win = fcWin;` in `setOverrides`, delete the function `fcWin`, and delete the `showAchievements` entry in `src/legacy/fc_preferences.js`. Check: `grep -n -E "fcWin|showAchievements|disabledPopups" src/legacy/*.js` prints nothing; remove the two bare `disabledPopups = ...` assignments in `autoCookieBody` that the last pattern finds.

- [ ] **Step 6: Write the failing game tests**

`test/game/sim.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launchGame, skipReason } from '../harness/game.mjs';

const skip = skipReason();
const MOD = path.resolve(import.meta.dirname, '..', '..', 'dist', 'MushieCookies', 'main.js');

async function midGame(game) {
    await game.eval(() => {
        Game.Earn(1e18);
        for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower']) {
            Game.Objects[name].buy(60);
        }
    });
    await game.advance(30);
    await game.eval(() => {
        for (const upgrade of Game.UpgradesInStore.slice(0, 40)) if (upgrade.pool === '') upgrade.buy();
    });
    await game.advance(30);
}

test('ranking every purchase leaves the game exactly as it was', { skip }, async () => {
    const game = await launchGame();
    try {
        await midGame(game);
        await game.loadMod(MOD, 'mushie_cookies');
        const out = await game.eval(() => {
            Game.CalculateGains();
            const before = MushieCookies.takeSnapshot(Game);
            const cps = Game.cookiesPs;
            const list = recommendationList(true);
            return {
                ranked: list.length,
                diff: MushieCookies.diffSnapshots(before, MushieCookies.takeSnapshot(Game)),
                cpsSame: Game.cookiesPs === cps,
                vanillaWin: /Game\.Achievements\[what\]/.test(String(Game.Win)),
            };
        });
        assert.ok(out.ranked > 20, `only ${out.ranked} candidates were ranked`);
        assert.deepEqual(out.diff, []);
        assert.equal(out.cpsSame, true);
        assert.equal(out.vanillaWin, true, 'the game\'s own Game.Win must be in place');
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('an exception halfway through ranking leaves no phantom state', { skip }, async () => {
    const game = await launchGame();
    try {
        await midGame(game);
        await game.loadMod(MOD, 'mushie_cookies');
        const out = await game.eval(() => {
            Game.CalculateGains();
            const before = MushieCookies.takeSnapshot(Game);
            const real = window.effectiveCps;
            let calls = 0;
            window.effectiveCps = function () {
                if (++calls === 7) throw new Error('injected mid-simulation');
                return real.apply(this, arguments);
            };
            let thrown = null;
            try {
                recommendationList(true);
            } catch (e) {
                thrown = e.message;
            }
            window.effectiveCps = real;
            return { thrown, diff: MushieCookies.diffSnapshots(before, MushieCookies.takeSnapshot(Game)) };
        });
        assert.equal(out.thrown, 'injected mid-simulation');
        assert.deepEqual(out.diff, []);
    } finally {
        await game.close();
    }
});
```

- [ ] **Step 7: Run all tests**

Run: `npm run test:all`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Guard what-if calculations with snapshot and restore"
```

---

### Task 6: Bug sweep in `fc_main.js`

**Files:**
- Modify: `src/legacy/fc_main.js`
- Test: `test/game/bugs-main.test.mjs`

**Interfaces:**
- Consumes: `launchGame`, `skipReason`, `GameHandle`.

Line numbers below are upstream's, as cited in `docs/research/frozen-cookies-audit.md`; earlier tasks have shifted them, so locate each by the quoted code.

- [ ] **Step 1: Write the failing tests**

`test/game/bugs-main.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launchGame, skipReason } from '../harness/game.mjs';

const skip = skipReason();
const MOD = path.resolve(import.meta.dirname, '..', '..', 'dist', 'MushieCookies', 'main.js');

async function withMod(run) {
    const game = await launchGame();
    try {
        await game.loadMod(MOD, 'mushie_cookies');
        return await run(game);
    } finally {
        await game.close();
    }
}

test('the reward-cookie patch is gone', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => ({
            helpers: ['isRewardCookie', 'getRewardCookieBuildingTargets', 'restoreBuildingLimits', '_oldAutoCookie'].filter((n) => typeof window[n] !== 'undefined'),
        }));
        assert.deepEqual(out.helpers, []);
    }));

test('popping wrinklers does not reorder the game\'s own array', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            Game.wrinklers.forEach((w, i) => { w.phase = 2; w.sucked = (i * 7) % 10; });
            const before = Game.wrinklers.map((w) => w.id);
            FrozenCookies.autoWrinkler = 1;
            try { autoWrinkler(); } catch (e) {}
            liveWrinklers();
            return { before, after: Game.wrinklers.map((w) => w.id) };
        });
        assert.deepEqual(out.after, out.before);
    }));

test('bestBank survives an empty candidate list', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            try {
                return { bank: bestBank(-1) };
            } catch (e) {
                return { thrown: e.message };
            }
        });
        assert.equal(out.thrown, undefined);
        assert.equal(typeof out.bank.cost, 'number');
    }));

test('the Spontaneous Edifice bank is zero when the spell cannot be cast', { skip }, () =>
    withMod(async (game) => {
        assert.equal(await game.eval(() => edificeBank()), 0);
    }));

test('prestige-doubling ascension does not depend on the fixed-amount setting', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            FrozenCookies.autoAscendToggle = 1;
            FrozenCookies.autoAscend = 2;
            FrozenCookies.HCAscendAmount = 0;
            FrozenCookies.comboAscend = 1;
            Game.prestige = 100;
            Game.cookiesReset = 0;
            Game.cookiesEarned = Game.HowManyCookiesReset(250);
            return shouldAutoAscend();
        });
        assert.equal(out, true);
    }));

test('restart of the timers does not leak intervals', { skip }, () =>
    withMod(async (game) => {
        const out = await game.eval(() => {
            FrozenCookies.autoFrenzy = 1;
            FrozenCookies.frenzyClickSpeed = 10;
            const before = window.__vt.timers.size;
            for (let i = 0; i < 5; i++) FCStart();
            const afterFirst = window.__vt.timers.size;
            for (let i = 0; i < 5; i++) FCStart();
            return { before, afterFirst, afterSecond: window.__vt.timers.size };
        });
        assert.equal(out.afterSecond, out.afterFirst);
    }));
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:game`
Expected: the six new tests FAIL.

- [ ] **Step 3: Apply the fixes**

| # | Find | Change |
|---|---|---|
| 1 | The block from `// --- Reward Cookie Helper ---` to the end of the `autoCookie = function () { ... };` reassignment | Delete all of it, including `isRewardCookie`, `getRewardCookieBuildingTargets`, `restoreBuildingLimits` |
| 2 | In the "Don't leave base season" condition, the run `upgrade.id == 182 && haveAll("christmas") && upgrade.id == 183 && haveAll("halloween") && upgrade.id == 184 && haveAll("valentines") && upgrade.id == 209 && haveAll("easter") &&` | Replace with `((upgrade.id == 182 && haveAll("christmas")) \|\| (upgrade.id == 183 && haveAll("halloween")) \|\| (upgrade.id == 184 && haveAll("valentines")) \|\| (upgrade.id == 209 && haveAll("easter")) \|\| upgrade.id == 185) &&` |
| 3 | `if (!canCastSE) return 0;` | `if (!canCastSE()) return 0;` |
| 4 | `FrozenCookies.lastCps = 0;` and `FrozenCookies.lastBaseCps = 0;` | `FrozenCookies.lastCPS = 0;` and `FrozenCookies.lastBaseCPS = 0;` |
| 5 | `var wrinklerList = Game.wrinklers;` | `var wrinklerList = Game.wrinklers.slice();` |
| 6 | `if (bankLevels[0].cost > bankOverride)` | `if (bankLevels.length && bankLevels[0].cost > bankOverride)` |
| 7 | The two auto-ascend blocks in `autoCookieBody` | Replace both with the single block below, and add the function `shouldAutoAscend` |
| 8 | The two `eval(` calls that rewrite `Game.shimmerTypes.golden.popFunc` and `Game.UpdateWrinklers`, and the function `inRect` | Delete. The game's own functions stay in place |

For fix 7, the replacement block:

```js
        if (shouldAutoAscend()) {
            Game.ClosePrompt();
            Game.Ascend(1);
        }
```

and the new function, placed above `autoCookieBody`:

```js
function shouldAutoAscend() {
    if (FrozenCookies.autoAscendToggle != 1) return false;
    if (Game.OnAscend || Game.AscendTimer || Game.prestige <= 0) return false;
    if (FrozenCookies.comboAscend != 1 && cpsBonus() >= FrozenCookies.minCpSMult) return false;
    var resetPrestige = Game.HowMuchPrestige(
        Game.cookiesReset + Game.cookiesEarned + wrinklerValue() + chocolateValue()
    );
    if (FrozenCookies.autoAscend == 1) {
        return FrozenCookies.HCAscendAmount > 0 && resetPrestige - Game.prestige >= FrozenCookies.HCAscendAmount;
    }
    if (FrozenCookies.autoAscend == 2) {
        return resetPrestige >= Game.prestige * 2;
    }
    return false;
}
```

Reincarnation no longer uses a fixed ten-second timer. Register a system in `registerMod`'s `init`, after the `logic` hook from Task 4:

```js
            MushieCookies.loop.add(
                "reincarnate",
                function () {
                    Game.ClosePrompt();
                    Game.Reincarnate(1);
                },
                {
                    everyFrames: 30,
                    enabled: function () {
                        return FrozenCookies.autoAscendToggle == 1 && Game.OnAscend && !Game.AscendTimer;
                    },
                }
            );
```

- [ ] **Step 4: Add the ascension round-trip test**

Append to `test/game/bugs-main.test.mjs`:

```js
test('auto-ascend ascends and reincarnates without a wall-clock timer', { skip }, () =>
    withMod(async (game) => {
        await game.eval(() => {
            Game.Earn(1e15);
            Game.prestige = 10;
            Game.heavenlyChips = 10;
            Game.cookiesReset = Game.HowManyCookiesReset(10);
            Game.cookiesEarned = Game.HowManyCookiesReset(40);
            FrozenCookies.autoAscendToggle = 1;
            FrozenCookies.autoAscend = 2;
            FrozenCookies.comboAscend = 1;
            FCStart();
        });
        await game.advanceSeconds(60);
        const out = await game.eval(() => ({ onAscend: Game.OnAscend, resets: Game.resets, prestige: Game.prestige }));
        assert.equal(out.onAscend, 0);
        assert.equal(out.resets, 1);
        assert.ok(out.prestige >= 40);
        assert.deepEqual(game.errors, []);
    }));
```

- [ ] **Step 5: Run all tests**

Run: `npm run test:all`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Fix audited bugs in the main loop, banks, seasons and ascension"
```

---

### Task 7: Bug sweep in spells, gods and bank

**Files:**
- Modify: `src/legacy/fc_spells.js`, `src/legacy/fc_gods.js`, `src/legacy/fc_bank.js`, `src/legacy/fc_preferences.js`, `src/legacy/fc_main.js` (Auto Sweet wiring only)
- Test: `test/unit/legacy-source.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.

These files are replaced wholesale in milestones 5 and 8, so this task fixes what is wrong in one line and removes what is unsafe. It does not restructure.

- [ ] **Step 1: Write the failing test**

`test/unit/legacy-source.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', '..', 'src', 'legacy');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const all = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => [f, read(f)]);

test('no negation binds tighter than a comparison', () => {
    // `!a == b` compares a boolean with b; it is never what was meant.
    const bad = [];
    for (const [file, src] of all) {
        src.split('\n').forEach((line, i) => {
            if (/(^|[^!=<>\w])![A-Za-z_][\w.]*(\([^()]*\))?\s*={2,3}\s*/.test(line)) bad.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    assert.deepEqual(bad, []);
});

test('known misspelled identifiers are gone', () => {
    const banned = ['autoworship1', 'officelevel', 'times.SI730', 'Game.shimmer.wrath', 'countAntiMatter'];
    const found = [];
    for (const [file, src] of all) for (const word of banned) if (src.includes(word)) found.push(`${file}: ${word}`);
    assert.deepEqual(found, []);
});

test('Auto Sweet is removed', () => {
    const found = [];
    for (const [file, src] of all) if (/autoSweet|autosweet/.test(src)) found.push(file);
    assert.deepEqual(found, []);
});

test('every legacy file parses', () => {
    for (const [file, src] of all) assert.doesNotThrow(() => new Function(src), `${file} has a syntax error`);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: the first three tests FAIL, listing each offending line.

- [ ] **Step 3: Apply the fixes**

| # | File | Find | Change |
|---|---|---|---|
| 1 | `fc_spells.js` | `!nextSpellName(0) == "Click Frenzy"` and `!nextSpellName(1) == "Click Frenzy"`, three places | `nextSpellName(0) != "Click Frenzy"` and `nextSpellName(1) != "Click Frenzy"` |
| 2 | `fc_spells.js` | `!Game.dragonAura2 == 15` | `Game.dragonAura2 != 15` |
| 3 | `fc_spells.js` | `!Game.dragonAura == 16` | `Game.dragonAura != 16` |
| 4 | `fc_spells.js` | The two consecutive `Game.shimmers[0].pop();` lines in `case 12` | `if (Game.shimmers.length) Game.shimmers[0].pop();` twice |
| 5 | `fc_spells.js` | `Game.shimmer.wrath != 1` | `Game.shimmers[i].wrath != 1` |
| 6 | `fc_spells.js` | `auto100ConsistencyComboAction.countAntiMatter` | `auto100ConsistencyComboAction.countAntimatter`, after confirming with `grep -n "countAnti" src/legacy/fc_spells.js` that this is the name assigned earlier in the same state machine; if the assigned name differs, use the assigned name |
| 7 | `fc_spells.js` | `if (G.plantsById[14].unlocked == 0) {` with the comment `// Whiskerbloom seed unlocked` | `if (G.plantsById[14].unlocked) {` |
| 8 | `fc_spells.js` | `case 8:` of the consistency combo, which clicks `M.lumpRefill` unconditionally | Wrap the click and the confirm in `if (!FrozenCookies.sugarBakingGuard \|\| Game.lumps > 100) { ... }`; the state still advances to 9 |
| 9 | `fc_spells.js` | `'<b style="color:#FFDE5F">Cookie Chain',` inside the `Math.random() < 0.1` branch of `nextSpell` | `'<b style="color:#00C4FF">Cookie Storm',`, matching the game, which pushes Cookie Storm twice |
| 10 | `fc_gods.js` | `FrozenCookies.autoworship1`, three places | `FrozenCookies.autoWorship1` |
| 11 | `fc_gods.js` | `times.SI730` | The key that the `times` object in the same function defines for 07:30 UTC under Supreme Intellect; read the object literal above and use its exact key |
| 12 | `fc_bank.js` | `B.officelevel` | `B.officeLevel` |

For fix 6, 11: both are "use the name that is defined". Verify each with a grep that shows the definition and the use on adjacent lines of output.

- [ ] **Step 4: Remove Auto Sweet**

Auto Sweet ascends repeatedly to reroll the spell seed, and it reincarnates by calling `Game.Reincarnate(1)` outside an ascension. Upstream marks it experimental and its documented off-switch does not work.

Delete: the functions `autoSweetAction` and any helper only it calls in `fc_spells.js`; the `autoSweet` preference in `fc_preferences.js`; the `autoSweetBot` interval and its clear in `FCStart`; every remaining read of `FrozenCookies.autoSweet`.

- [ ] **Step 5: Run all tests**

Run: `npm run test:all`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Fix one-line bugs in spells, gods and bank; remove Auto Sweet"
```

---

### Task 8: Dead code and the per-frame infobox

**Files:**
- Modify: `src/legacy/fc_main.js`, `src/legacy/fc_button.js`, `src/legacy/fc_infobox.js`
- Test: `test/unit/legacy-source.test.mjs` (extend), `test/game/infobox.test.mjs`

**Interfaces:**
- Consumes: `MushieCookies.loop.add`.

- [ ] **Step 1: Extend the source test**

Append to `test/unit/legacy-source.test.mjs`:

```js
test('functions the audit found unreferenced are gone', () => {
    const dead = [
        'rebuildStore', 'rebuildUpgrades', 'getBuildingTooltip', 'getUpgradeTooltip', 'colorizeScore',
        'cyclePreference', 'writeFCButton', 'shouldClickGC', 'cookieStats', 'weightedCookieValue', 'gcEfficiency',
        'earnedRemaining', 'buildingRemaining', 'estimatedTimeRemaining', 'cumulativeProbability',
    ];
    const found = [];
    for (const [file, src] of all) for (const name of dead) if (new RegExp(`\\b${name}\\b`).test(src)) found.push(`${file}: ${name}`);
    assert.deepEqual(found, []);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL listing the functions still present.

- [ ] **Step 3: Delete each function after proving it is unreferenced**

For each name in the list, run `grep -n -E "\b<name>\b" src/legacy/*.js`. If every match is the definition itself, a comment, or another function on this list, delete the definition. If anything else calls it, keep it, remove it from the test's list, and say so in the commit message.

Also delete the unused fields `timeTravelAmount`, `calculatedCpsByType` and `priceReductionTest` wherever they are only assigned.

- [ ] **Step 4: Write the failing infobox test**

`test/game/infobox.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launchGame, skipReason } from '../harness/game.mjs';

const skip = skipReason();
const MOD = path.resolve(import.meta.dirname, '..', '..', 'dist', 'MushieCookies', 'main.js');

test('the infobox refreshes four times a second, not every frame', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.loadMod(MOD, 'mushie_cookies');
        await game.eval(() => {
            window.__draws = 0;
            const real = window.updateTimers;
            window.updateTimers = function () {
                window.__draws++;
                return real.apply(this, arguments);
            };
        });
        await game.advanceSeconds(10);
        const draws = await game.eval(() => window.__draws);
        assert.ok(draws >= 38 && draws <= 42, `expected about 40 refreshes in 10 seconds, got ${draws}`);
    } finally {
        await game.close();
    }
});
```

- [ ] **Step 5: Move the infobox onto the loop**

In `registerMod`'s `init`, delete `Game.registerHook("draw", updateTimers);` and add:

```js
            MushieCookies.loop.add(
                "infobox",
                function () {
                    updateTimers();
                },
                { everyFrames: 8 }
            );
```

`updateTimers` is looked up by name at call time so that a replaced global, as in the test, is honoured.

- [ ] **Step 6: Run all tests**

Run: `npm run test:all`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Remove dead code; refresh the infobox four times a second"
```

---

### Task 9: Acceptance, documentation, install

**Files:**
- Create: `test/game/acceptance.test.mjs`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-29-mushie-cookies-design.md` (mark M1 done)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the acceptance tests**

`test/game/acceptance.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launchGame, skipReason } from '../harness/game.mjs';

const skip = skipReason();
const MOD = path.resolve(import.meta.dirname, '..', '..', 'dist', 'MushieCookies', 'main.js');

const census = () => ({
    buildings: Game.BuildingsOwned,
    upgrades: Game.UpgradesOwned,
    resets: Game.resets,
    spells: Game.Objects['Wizard tower'].minigame ? Game.Objects['Wizard tower'].minigame.spellsCastTotal : 0,
    bigClicks: Game.cookieClicks,
    goldenClicks: Game.goldenClicks,
});

test('with every setting at its default the mod does nothing', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.eval(() => {
            Game.Earn(1e15);
            for (const name of ['Cursor', 'Grandma', 'Farm']) Game.Objects[name].buy(20);
        });
        await game.loadMod(MOD, 'mushie_cookies');
        const before = await game.eval(census);
        await game.advanceSeconds(30 * 60);
        assert.deepEqual(await game.eval(census), before);
        assert.deepEqual(game.errors, []);
        assert.deepEqual(game.blocked, []);
    } finally {
        await game.close();
    }
});

test('with autobuy on it plays for two hours without an error or a phantom purchase', { skip }, async () => {
    const game = await launchGame();
    try {
        await game.loadMod(MOD, 'mushie_cookies');
        await game.eval(() => {
            Game.Earn(100);
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoGC = 1;
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            FCStart();
        });
        await game.advanceSeconds(2 * 3600);
        const out = await game.eval(() => {
            const owned = Game.ObjectsById.reduce((sum, b) => sum + b.amount, 0);
            return {
                owned,
                counter: Game.BuildingsOwned,
                upgrades: Game.UpgradesOwned,
                boughtFlags: Game.UpgradesById.filter((u) => u.bought && u.pool !== 'prestige' && u.pool !== 'toggle').length,
                cps: Game.cookiesPs,
                status: MushieCookies.status(),
            };
        });
        assert.ok(out.owned > 50, `only ${out.owned} buildings after two hours`);
        assert.equal(out.counter, out.owned, 'the building counter disagrees with the buildings');
        assert.ok(out.upgrades > 5);
        assert.ok(out.cps > 100);
        for (const [name, s] of Object.entries(out.status)) {
            assert.equal(s.failures, 0, `${name} failed: ${s.lastError}`);
        }
        assert.deepEqual(game.errors, []);
        assert.deepEqual(game.blocked, []);
    } finally {
        await game.close();
    }
});
```

- [ ] **Step 2: Run everything**

Run: `npm run test:all`
Expected: PASS. Any failure here is a real defect in an earlier task; fix it there.

- [ ] **Step 3: Rewrite `README.md`**

Replace the upstream README with one that covers, in this order: what Mushie Cookies is (one paragraph, naming Frozen Cookies as the base and linking `NOTICE.md`); status (milestone table copied from the spec, M1 marked done); install (`npm install`, set the game location, `npm run deploy`, then enable nothing because it is on by default, and how to switch it off in Options → Manage mods); the fair-play boundary (the table from the spec's section 2); known conflict with Cookie Monster; how to run the tests; where the design and research live.

Keep upstream's feature documentation out of it: those sections describe settings this project is in the middle of replacing.

- [ ] **Step 4: Deploy and check the installed files**

Run: `npm run deploy`
Expected: `deployed to the game's mods/local/MushieCookies`, and that folder contains exactly `main.js` and `info.txt`.

- [ ] **Step 5: Mark the milestone in the spec and commit**

In the spec, under `### M1 — Foundation`, add the line `Status: done <date>.`

```bash
git add -A
git commit -m "Add acceptance tests and README; M1 complete"
```

---

## What changed during execution

The plan above is kept as written. These are the places where the work departed from it, and why.

| Plan | What was done | Why |
|---|---|---|
| Task 1: legacy files concatenated into `main.js`, with `fc_boot.js` polling for the game | Legacy files are carried as text by the new bundle and evaluated one second after the game is ready; `fc_boot.js` is gone | Steam evaluates mod files before the game has created anything, and the legacy files read game state as soon as they are evaluated |
| Task 2: mods injected into the page after the game is running | The harness loads mods at the point where Steam loads them | The original harness would have passed a mod that fails on Steam |
| Task 2: pending real timers cancelled at takeover | Pending real timers are moved onto virtual time under the same id | Cancelling them would also cancel timers the mod had already started |
| Task 2: real frames allowed before takeover | No real frame may run; the harness fails if one does | The number of real frames depended on machine speed, which made runs with one seed diverge |
| Task 4: the loop driven by `Game.T` | The loop is driven by the mod's own frame counter | `Game.T` restarts when a save is loaded |
| Task 5: snapshots as arrays of rows | Snapshots as flat arrays over cached member lists | A ranking pass takes hundreds of snapshots; the first form cost a third of the run time |
| Task 5: `showAchievements` removed from the preferences file | It was an internal flag in `fc_main.js`, removed there | The plan misread where it lived |
| Task 6, fix 2: each season's switcher blocked when that season is complete | All switchers blocked in a free base season when every season is complete | That is what the setting's own description says |
| Task 7, fix 6: rename `countAntiMatter` | The block that used it is deleted | The count was never set and that building is never sold, so the block could not run |
| Task 9: live smoke test in the Steam game | A test inside the Electron runtime copied from the install | It checks the same Chrome 87 without touching Steam or a real save |
| Not planned | `tools/dev/profile.mjs` | Needed to find why the harness slowed from 1,000 to 25 times real time with the mod buying |
