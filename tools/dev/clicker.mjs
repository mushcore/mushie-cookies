// Measures the clicker against the inherited interval clicker it replaced.
//
//   node tools/dev/clicker.mjs harness [seconds]        virtual time, luck-free
//   node tools/dev/clicker.mjs runtime [reps] [seconds] the game's own Electron (Chrome 87), window shown
//
// Counts calls that reach Game.ClickCookie and clicks the game counted (Game.cookieClicks). The
// inherited clicker is rebuilt here as it was (fc_main.js before this change): setInterval at
// 1000/speed calling Game.ClickCookie unless ascending or the mouse is on a special tab.
//
// Also measures click priority: accepted clicks during a click frenzy while the buyer has a rich
// bank, with the buyer standing aside (clickPriority on) and buying through it (off).
//
// Build first (npm run build). The runtime mode opens a visible window without focus for a few
// minutes; close nothing else meanwhile.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { launchWithMod, BUILT_MOD } from '../../test/harness/game.mjs';
import { startServer } from '../../test/harness/server.mjs';
import { prepareRuntime } from '../../test/harness/runtime.mjs';
import { takeSlot } from '../../test/harness/slots.mjs';
import { gameAppDir } from '../localConfig.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const mode = process.argv[2] || 'harness';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- In the page -------------------------------------------------------------------------------

/** Installs the call counter and the inherited clicker. Runs in the page. */
function instrument() {
    window.__calls = 0;
    const click = Game.ClickCookie;
    Game.ClickCookie = function () {
        window.__calls++;
        return click.apply(this, arguments);
    };
    window.__inherited = null;
    window.__useInherited = (speed) => {
        if (window.__inherited) clearInterval(window.__inherited);
        window.__inherited = null;
        if (!speed) return;
        window.__inherited = setInterval(() => {
            if (!Game.OnAscend && !Game.AscendTimer && !Game.specialTabHovered) Game.ClickCookie();
        }, 1000 / speed);
    };
    window.__snap = () => ({ clicks: Game.cookieClicks, calls: window.__calls, at: Date.now() });
}

/** Switches to one clicker. Runs in the page. */
function choose(variant) {
    window.__useInherited(0);
    FrozenCookies.autoFrenzy = 0;
    if (variant.startsWith('interval')) {
        FrozenCookies.autoClick = 0;
        MushieCookies.clicker.stop();
        window.__useInherited(Number(variant.split(' ')[1]));
    } else {
        FrozenCookies.autoClick = 1;
        FrozenCookies.cookieClickSpeed = 50;
    }
    FCStart();
}

const rate = (a, b) => {
    const seconds = (b.at - a.at) / 1000;
    return { accepted: +((b.clicks - a.clicks) / seconds).toFixed(2), calls: +((b.calls - a.calls) / seconds).toFixed(2) };
};

const VARIANTS = ['interval 50', 'interval 250', 'pump'];

function summarise(rows) {
    const out = {};
    for (const r of rows) {
        const key = r.label;
        (out[key] = out[key] || []).push(r.accepted);
    }
    for (const [key, values] of Object.entries(out)) {
        const mean = values.reduce((s, v) => s + v, 0) / values.length;
        out[key] = { mean: +mean.toFixed(1), min: Math.min(...values), max: Math.max(...values), runs: values.length };
    }
    return out;
}

// --- Harness ----------------------------------------------------------------------------------

async function harness(seconds) {
    const game = await launchWithMod({ seed: 'clicker' });
    if (!game) throw new Error('game location not configured');
    const rows = [];
    try {
        await game.eval(() => {
            Game.shimmerTypes.golden.spawnConditions = () => false; // luck-free
        });
        await game.eval(instrument);
        for (const variant of VARIANTS) {
            await game.eval(choose, variant);
            await game.advanceSeconds(2);
            const a = await game.eval(() => window.__snap());
            await game.advanceSeconds(seconds);
            const b = await game.eval(() => window.__snap());
            const row = { mode: 'harness', label: variant, ...rate(a, b) };
            rows.push(row);
            console.log(JSON.stringify(row));
        }
        // Click priority: rank passes and purchases during a forced click frenzy, and the real
        // milliseconds the page spent in logic frames meanwhile (virtual time hides blocking).
        await game.eval(() => {
            Game.Earn(1e9);
            FrozenCookies.autoBuy = 1;
            FCStart();
        });
        await game.advanceSeconds(30);
        for (const priority of [true, false]) {
            const out = await game.eval((p) => {
                const frame = document.createElement('iframe');
                document.body.appendChild(frame);
                window.__realNow = frame.contentWindow.performance.now.bind(frame.contentWindow.performance);
                MushieCookies.buyer.options.clickPriority = p;
                Game.Earn(Game.cookies * 1000 + 1e12);
                Game.gainBuff('click frenzy', 13, 777);
                window.__busy = 0;
                if (!window.__timedLogic) {
                    window.__timedLogic = true;
                    const logic = Game.Logic;
                    Game.Logic = function () {
                        const t = window.__realNow();
                        try {
                            return logic.apply(this, arguments);
                        } finally {
                            window.__busy += window.__realNow() - t;
                        }
                    };
                }
                return MushieCookies.buyer.activity();
            }, priority);
            await game.advanceSeconds(12);
            const after = await game.eval(() => ({ ...MushieCookies.buyer.activity(), busy: window.__busy }));
            const row = {
                mode: 'harness',
                label: `click frenzy, rich bank, clickPriority ${priority ? 'on' : 'off'}`,
                ranks: after.ranks - out.ranks,
                purchases: after.purchases - out.purchases,
                logicMsDuringFrenzy: +after.busy.toFixed(1),
            };
            console.log(JSON.stringify(row));
            await game.advanceSeconds(30);
        }
    } finally {
        await game.close();
    }
    console.log(JSON.stringify({ summary: summarise(rows) }));
}

// --- The game's own runtime -------------------------------------------------------------------

/** A copy of the runtime (hard links to the cached one) whose app shows its window without focus. */
function prepareShownRuntime(app) {
    const exe = prepareRuntime(app);
    const base = path.dirname(exe);
    const shown = path.join(path.dirname(base), 'runtime-shown');
    if (!fs.existsSync(path.join(shown, path.basename(exe)))) {
        fs.mkdirSync(path.join(shown, 'resources'), { recursive: true });
        for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
            const from = path.join(base, entry.name);
            const to = path.join(shown, entry.name);
            if (entry.name === 'resources' || fs.existsSync(to)) continue;
            if (entry.isDirectory()) fs.symlinkSync(from, to, 'junction');
            else {
                try {
                    fs.linkSync(from, to);
                } catch (e) {
                    fs.copyFileSync(from, to);
                }
            }
        }
    }
    const appDir = path.join(shown, 'resources', 'app');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'mushie-shown', main: 'main.js' }));
    fs.writeFileSync(
        path.join(appDir, 'main.js'),
        [
            "const { app, BrowserWindow } = require('electron');",
            "const http = require('http');",
            "const path = require('path');",
            "app.setPath('userData', path.join(__dirname, 'userdata'));",
            'app.whenReady().then(() => {',
            // The game's own window options (start.js) leave background throttling at its default.
            "    const win = new BrowserWindow({ show: false, x: 40, y: 40, width: 1280, height: 720, backgroundColor: '#000', webPreferences: { contextIsolation: true } });",
            "    win.loadURL('about:blank');",
            '    http.createServer((req, res) => {',
            "        if (req.url === '/show') win.showInactive();",
            "        if (req.url === '/minimize') win.minimize();",
            "        if (req.url === '/restore') win.showInactive();",
            '        res.end(JSON.stringify({ visible: win.isVisible(), minimized: win.isMinimized(), focused: win.isFocused() }));',
            '    }).listen(Number(process.env.MUSHIE_CONTROL_PORT), "127.0.0.1");',
            '});',
            "app.on('window-all-closed', () => app.quit());",
            '',
        ].join('\n')
    );
    return path.join(shown, path.basename(exe));
}

const freePort = () =>
    new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });

async function runtime(reps, seconds) {
    const app = gameAppDir(root);
    if (!app) throw new Error('game location not configured');
    const exe = prepareShownRuntime(app);
    // One of the machine's game slots, like any harness run.
    const releaseSlot = await takeSlot();
    const server = await startServer(app, [BUILT_MOD]);
    const debugPort = await freePort();
    const controlPort = await freePort();
    const child = spawn(exe, [`--remote-debugging-port=${debugPort}`, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'], {
        stdio: 'ignore',
        env: { ...process.env, MUSHIE_CONTROL_PORT: String(controlPort) },
    });
    const control = async (what) => (await fetch(`http://127.0.0.1:${controlPort}/${what}`)).json();
    const rows = [];
    let socket = null;
    try {
        let target = null;
        for (let i = 0; i < 100 && !target; i++) {
            await sleep(150);
            try {
                target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((t) => t.type === 'page');
            } catch (e) {
                // not listening yet
            }
        }
        if (!target) throw new Error('the runtime did not open a page');
        socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
        let nextId = 1;
        const waiting = new Map();
        socket.addEventListener('message', (event) => {
            const m = JSON.parse(event.data);
            if (m.id && waiting.has(m.id)) {
                const w = waiting.get(m.id);
                waiting.delete(m.id);
                if (m.error) w.reject(new Error(m.error.message));
                else w.resolve(m.result);
            }
        });
        const send = (method, params = {}) =>
            new Promise((resolve, reject) => {
                const id = nextId++;
                waiting.set(id, { resolve, reject });
                socket.send(JSON.stringify({ id, method, params }));
            });
        const ev = async (fn, arg) => {
            const expression = `(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})`;
            const out = await send('Runtime.evaluate', { expression, returnByValue: true });
            if (out.exceptionDetails) throw new Error((out.exceptionDetails.exception && out.exceptionDetails.exception.description) || out.exceptionDetails.text);
            return out.result.value;
        };
        await send('Runtime.enable');
        await send('Page.enable');
        await send('Page.addScriptToEvaluateOnNewDocument', {
            source: `
                try { localStorage.clear(); localStorage.setItem('CookieClickerLang', 'EN'); } catch (e) {}
                window.__harnessLoadMods = function (launch) { Game.LoadMod(${JSON.stringify(server.modUrls[0])}, launch, launch); };`,
        });
        await send('Page.navigate', { url: server.origin + '/src/index.html' });
        for (let i = 0; i < 300; i++) {
            await sleep(200);
            try {
                if (await ev(() => !!(window.Game && Game.ready && window.MushieCookies && MushieCookies.started()))) break;
            } catch (e) {
                // between documents
            }
        }
        await ev(() => Game.HardReset(2));
        console.log(JSON.stringify({ window: await control('show') }));
        await sleep(3000);
        const env = await ev(() => ({
            chrome: navigator.userAgent.match(/Chrome\/[\d.]+/)[0],
            visibility: document.visibilityState,
            particles: Game.prefs.particles,
            numbers: Game.prefs.numbers,
            volume: Game.volume,
        }));
        console.log(JSON.stringify({ env }));
        await ev(instrument);
        // Golden cookies off: a Click frenzy landing in one variant's window would skew it.
        await ev(() => {
            Game.shimmerTypes.golden.spawnConditions = () => false;
        });

        async function measure(label, setup, arg) {
            await ev(setup, arg);
            await sleep(1500);
            const a = await ev(() => window.__snap());
            await sleep(seconds * 1000);
            const b = await ev(() => window.__snap());
            const row = { mode: 'runtime', label, ...rate(a, b) };
            rows.push(row);
            console.log(JSON.stringify(row));
        }

        // 1. Idle clicking, window shown, game defaults for sound and particles.
        for (let rep = 0; rep < reps; rep++) {
            for (const variant of VARIANTS) await measure(variant, choose, variant);
        }
        // 2. A click frenzy with a rich bank and the buyer on.
        await ev(() => {
            Game.Earn(1e15);
            for (const b of Game.ObjectsById) b.buy(100);
            Game.CalculateGains();
            FrozenCookies.autoBuy = 1;
            FCStart();
        });
        await sleep(3000);
        const frenzy = (priority) => {
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            MushieCookies.buyer.options.clickPriority = priority;
            Game.Earn(Game.cookies * 100 + 1e20);
            Game.gainBuff('click frenzy', 30, 777);
            FCStart();
        };
        for (let rep = 0; rep < reps; rep++) {
            for (const priority of [true, false]) {
                await measure(`pump, click frenzy, rich bank, clickPriority ${priority ? 'on' : 'off'}`, frenzy, priority);
                await ev(() => Game.killBuff('Click frenzy'));
                await sleep(1000);
            }
        }
        await ev(() => {
            FrozenCookies.autoBuy = 0;
            MushieCookies.buyer.options.clickPriority = true;
            FCStart();
        });
        // 3. Minimized: the page is hidden and its timers are throttled.
        console.log(JSON.stringify({ window: await control('minimize') }));
        await sleep(1500);
        for (let rep = 0; rep < reps; rep++) {
            for (const variant of ['interval 250', 'pump']) await measure(`${variant}, minimized`, choose, variant);
        }
        await control('restore');
    } finally {
        try {
            if (socket) socket.close();
        } catch (e) {
            // already closed
        }
        child.kill();
        await server.close();
        releaseSlot();
    }
    console.log(JSON.stringify({ summary: summarise(rows) }));
}

if (mode === 'harness') await harness(Number(process.argv[3] || 60));
else if (mode === 'runtime') await runtime(Number(process.argv[3] || 3), Number(process.argv[4] || 8));
else {
    console.error('usage: node tools/dev/clicker.mjs harness|runtime ...');
    process.exit(1);
}
