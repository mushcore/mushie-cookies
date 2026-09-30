// Runs a page inside the same Electron runtime the game ships with, and talks to it over the
// Chrome DevTools Protocol. The headless browser used by the other game tests is current
// Chrome; the game runs on Chrome 87. This is where a too-new language or browser feature
// shows up before it reaches the game.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..', '..');
const CACHE = path.join(root, 'node_modules', '.cache', 'mushie-cookies', 'runtime');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const freePort = () =>
    new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });

/**
 * Copies the Electron runtime out of the game's install, without the game itself, and gives it
 * a one-file app that opens a hidden window. Returns the path of the executable.
 */
export function prepareRuntime(gameAppDir) {
    const install = path.resolve(gameAppDir, '..', '..');
    const exe = fs.readdirSync(install).find((f) => /\.exe$/i.test(f) && !/elevate/i.test(f));
    if (!exe) throw new Error('no executable found next to the game');
    const stamp = path.join(CACHE, '.source');
    const source = `${exe}:${fs.statSync(path.join(install, exe)).size}`;
    if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== source) {
        fs.rmSync(CACHE, { recursive: true, force: true });
        fs.mkdirSync(CACHE, { recursive: true });
        fs.cpSync(install, CACHE, {
            recursive: true,
            // The runtime only: none of the game's own code, data or mods.
            filter: (from) => !path.relative(install, from).split(path.sep).join('/').startsWith('resources/app'),
        });
        fs.writeFileSync(stamp, source);
    }
    const app = path.join(CACHE, 'resources', 'app');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'mushie-compat', main: 'main.js' }));
    fs.writeFileSync(
        path.join(app, 'main.js'),
        [
            "const { app, BrowserWindow } = require('electron');",
            'app.whenReady().then(() => {',
            '    const win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { contextIsolation: true } });',
            "    win.loadURL('about:blank');",
            '});',
            "app.on('window-all-closed', () => app.quit());",
            '',
        ].join('\n')
    );
    return path.join(CACHE, exe);
}

/** Starts the runtime and returns a handle on its one page. */
export async function launchRuntime(executable) {
    const port = await freePort();
    const child = spawn(
        executable,
        [
            `--remote-debugging-port=${port}`,
            // Nothing but the local test server can be resolved.
            '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
            '--disable-gpu',
        ],
        { stdio: 'ignore' }
    );
    let target = null;
    for (let tries = 0; tries < 100 && !target; tries++) {
        await sleep(100);
        try {
            const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            target = list.find((t) => t.type === 'page');
        } catch (e) {
            // not listening yet
        }
    }
    if (!target) {
        child.kill();
        throw new Error('the runtime did not open a page');
    }

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', () => reject(new Error('could not connect to the runtime')), { once: true });
    });
    let nextId = 1;
    const waiting = new Map();
    const errors = [];
    socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id && waiting.has(message.id)) {
            const { resolve, reject } = waiting.get(message.id);
            waiting.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
            return;
        }
        if (message.method === 'Runtime.exceptionThrown') {
            const d = message.params.exceptionDetails;
            errors.push('exception: ' + ((d.exception && d.exception.description) || d.text));
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
            errors.push('console: ' + message.params.args.map((a) => a.value || a.description || '').join(' '));
        }
    });
    const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
            const id = nextId++;
            waiting.set(id, { resolve, reject });
            socket.send(JSON.stringify({ id, method, params }));
        });

    await send('Runtime.enable');
    await send('Page.enable');

    return {
        errors,
        send,
        /** Evaluates an expression in the page and returns its value. */
        async eval(expression) {
            const out = await send('Runtime.evaluate', { expression, returnByValue: true });
            if (out.exceptionDetails) {
                const d = out.exceptionDetails;
                throw new Error((d.exception && d.exception.description) || d.text);
            }
            return out.result.value;
        },
        async waitFor(expression, timeoutMs = 30000) {
            const until = Date.now() + timeoutMs;
            while (Date.now() < until) {
                try {
                    if (await this.eval(expression)) return;
                } catch (e) {
                    // the page may be between documents
                }
                await sleep(100);
            }
            throw new Error(`timed out waiting for: ${expression}. Errors: ${errors.join(' | ') || 'none'}`);
        },
        async close() {
            try {
                socket.close();
            } catch (e) {}
            child.kill();
            await sleep(200);
        },
    };
}
