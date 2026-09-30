// Keeps harness runs from taking over the machine: every harness process runs below normal
// priority (the browsers it launches inherit that on Windows), and at most a few headless games
// run at once across every process on the machine; the rest wait for a slot.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

try {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch (e) {
    // Not permitted here; the cap below still applies.
}

const DIR = path.join(os.tmpdir(), 'mushie-cookies-harness-slots');
const CAP_FILE = path.join(DIR, 'max-games');

/**
 * How many games may run at once: MUSHIE_MAX_GAMES, else the number in the shared `max-games`
 * file (read at every launch, so the cap can be raised or lowered while runs are going), else
 * half the logical CPUs.
 */
export function maxGames() {
    const fromEnv = Number(process.env.MUSHIE_MAX_GAMES);
    if (fromEnv > 0) return Math.floor(fromEnv);
    try {
        const fromFile = Number(fs.readFileSync(CAP_FILE, 'utf8').trim());
        if (fromFile > 0) return Math.floor(fromFile);
    } catch (e) {}
    return Math.max(2, Math.floor(os.cpus().length / 2));
}
export const MAX_GAMES = maxGames();

const held = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return e.code === 'EPERM';
    }
}

function tryTake(i) {
    const file = path.join(DIR, `slot-${i}.lock`);
    try {
        fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
        return file;
    } catch (e) {
        if (e.code !== 'EEXIST') throw e;
    }
    // A slot left by a process that died is free again.
    let owner = NaN;
    try {
        owner = Number(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return null;
    }
    if (owner && owner !== process.pid && !alive(owner)) {
        try {
            fs.unlinkSync(file);
        } catch (e) {
            return null;
        }
        return tryTake(i);
    }
    return null;
}

/** Waits for a free slot and returns a function that gives it back. */
export async function takeSlot() {
    fs.mkdirSync(DIR, { recursive: true });
    for (let waited = 0; ; waited++) {
        const max = maxGames();
        for (let i = 0; i < max; i++) {
            const file = tryTake(i);
            if (file) {
                held.add(file);
                let released = false;
                return () => {
                    if (released) return;
                    released = true;
                    held.delete(file);
                    try {
                        fs.unlinkSync(file);
                    } catch (e) {}
                };
            }
        }
        if (waited === 0) process.stderr.write(`harness: all ${max} game slots are busy; waiting\n`);
        await sleep(2000);
    }
}

process.on('exit', () => {
    for (const file of held) {
        try {
            fs.unlinkSync(file);
        } catch (e) {}
    }
});
