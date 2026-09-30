import { chromium } from 'playwright-core';
import path from 'node:path';
import { gameAppDir, NOT_CONFIGURED } from '../../tools/localConfig.mjs';
import { startServer } from './server.mjs';
import { installVirtualTime } from './virtualTime.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
// Mid-June: no seasonal event is active, so a run does not depend on the day it is executed.
const EPOCH = Date.UTC(2026, 5, 15, 12, 0, 0);
// Five game minutes per round trip keeps the page responsive to script loads.
const CHUNK = 9000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Use as a test's `skip` option. */
export function skipReason() {
    return gameAppDir(root) ? false : NOT_CONFIGURED;
}

/**
 * Boots the installed game in a headless browser on virtual time, from a freshly reset save.
 * Returns null when the game location is not configured.
 */
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
    // Every run starts from the same state and the same timestamps.
    await page.evaluate(() => window.Game.HardReset(2));

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
