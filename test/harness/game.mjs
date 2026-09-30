import { chromium } from 'playwright-core';
import path from 'node:path';
import { gameAppDir, NOT_CONFIGURED } from '../../tools/localConfig.mjs';
import { startServer } from './server.mjs';
import { installVirtualTime } from './virtualTime.mjs';
import { takeSlot } from './slots.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
// Mid-June: no seasonal event is active, so a run does not depend on the day it is executed.
const EPOCH = Date.UTC(2026, 5, 15, 12, 0, 0);
// Five game minutes per round trip keeps the page responsive to script loads.
const CHUNK = 9000;

/** The mod as built by `npm run build`. */
export const BUILT_MOD = path.join(root, 'dist', 'MushieCookies', 'main.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Use as a test's `skip` option. */
export function skipReason() {
    return gameAppDir(root) ? false : NOT_CONFIGURED;
}

/**
 * Boots the installed game in a headless browser on virtual time, from a freshly reset save.
 * `mods` are built mod files, loaded at the point where Steam loads them.
 * With `autopilot`, the Autopilot is on from the start, as for a player who switched it on earlier.
 * With `checkpoint` ({save, now} from `takeCheckpoint`), the run resumes from that save.
 * Returns null when the game location is not configured.
 */
export async function launchGame({ seed = 'mushie', headless = true, mods = [], autopilot = false, checkpoint = null } = {}) {
    const appDir = gameAppDir(root);
    if (!appDir) return null;
    const releaseSlot = await takeSlot();
    let server;
    let browser;
    try {
        server = await startServer(appDir, mods);
        browser = await chromium.launch({ channel: process.env.MUSHIE_BROWSER || 'chrome', headless });
    } catch (error) {
        if (server) await server.close();
        releaseSlot();
        throw error;
    }
    browser.on('disconnected', releaseSlot);
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
    await page.addInitScript(installVirtualTime, { epoch: EPOCH, modUrls: server.modUrls });
    await page.addInitScript((autopilotOn) => {
        try {
            localStorage.setItem('CookieClickerLang', 'EN');
            // As if the player had switched the Autopilot on before this session.
            if (autopilotOn) localStorage.setItem('autopilot', '1');
        } catch (e) {}
    }, autopilot);
    await page.goto(server.origin + '/src/index.html');
    // The game sets its ready flag as it begins to initialise and initialises in one go,
    // so by the time this poll sees the flag the game is fully built.
    await page.waitForFunction(() => window.Game && window.Game.ready, null, { timeout: 60000 });
    const framesBeforeTakeover = await page.evaluate(() => window.Game.T);
    if (framesBeforeTakeover !== 0) {
        await browser.close();
        await server.close();
        throw new Error(`harness: ${framesBeforeTakeover} real frames ran before virtual time began`);
    }
    // The game's own web-mode boot asks for things that do not exist locally. Uncaught exceptions
    // and anything the mod or the harness reports are what matter.
    const bootErrors = errors.filter(
        (e) => e.startsWith('pageerror') || e.includes('Mushie Cookies') || e.includes('harness:')
    );
    const bootBlocked = blocked.slice();
    await page.evaluate(([s, at]) => window.__vt.takeover(s, at), [seed, checkpoint ? checkpoint.now : null]);
    // Every run starts from the same state and the same timestamps.
    await page.evaluate(() => window.Game.HardReset(2));
    // Display only: a counted click spends 180 µs drawing particles and a number, which at 50
    // clicks a second was half of a run's wall time. No game rule reads either.
    await page.evaluate(() => {
        window.Game.prefs.particles = 0;
        window.Game.prefs.numbers = 0;
        // The game measures its window every logic frame (main.js:16163), forcing a layout that
        // was a tenth of a run's wall time. The harness window never changes size, and the
        // bounds only place shimmers and tooltips on screen, so one measurement serves.
        const bounds = window.Game.l.getBounds();
        window.Game.l.getBounds = () => bounds;
    });
    // A checkpoint is a save taken at a known virtual time: loaded before the first frame, the
    // mod starts with the settings it held then, and the run continues from that moment.
    if (checkpoint) await page.evaluate((save) => window.Game.LoadSave(save), checkpoint.save);

    const handle = {
        page,
        errors,
        blocked,
        /** Errors raised while the game and its mods were loading, before virtual time began. */
        bootErrors,
        /** Requests that tried to leave the machine while the game and its mods were loading. */
        bootBlocked,
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
        /** Advances until Mushie Cookies reports that it has started. */
        async modStarted() {
            for (let tries = 0; tries < 20; tries++) {
                await handle.advance(15);
                if (await page.evaluate(() => !!(window.MushieCookies && window.MushieCookies.started()))) return;
            }
            throw new Error(`Mushie Cookies did not start. Errors: ${bootErrors.concat(errors).join(' | ') || 'none'}`);
        },
        /**
         * Waits for something the browser loads asynchronously, such as a minigame script.
         * Game frames keep running meanwhile: minigames finish setting up on logic frames.
         */
        async waitFor(fn, arg, timeoutMs = 15000) {
            const until = Date.now() + timeoutMs;
            while (Date.now() < until) {
                if (await page.evaluate(fn, arg)) return;
                await handle.advance(3);
                await sleep(20);
            }
            throw new Error('waitFor timed out');
        },
        /** A save of the game now, with the virtual time it was taken at, to resume from later. */
        takeCheckpoint: () => page.evaluate(() => ({ save: window.Game.WriteSave(1), now: Date.now() })),
        async close() {
            await browser.close();
            await server.close();
        },
    };
    blocked.length = 0;
    errors.length = 0;
    return handle;
}

/** Boots the game with the built mod loaded and started. */
export async function launchWithMod(options = {}) {
    const game = await launchGame({ ...options, mods: [BUILT_MOD] });
    if (!game) return null;
    if (game.bootErrors.length) {
        await game.close();
        throw new Error('errors while loading: ' + game.bootErrors.join(' | '));
    }
    try {
        await game.modStarted();
    } catch (error) {
        await game.close();
        throw error;
    }
    return game;
}
