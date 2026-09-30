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
/** MUSHIE_MAX_GAMES overrides; the default leaves most of the machine to everything else. */
export const MAX_GAMES = Math.max(1, Number(process.env.MUSHIE_MAX_GAMES) || Math.max(2, Math.floor(os.cpus().length / 4)));

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
        for (let i = 0; i < MAX_GAMES; i++) {
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
        if (waited === 0) process.stderr.write(`harness: all ${MAX_GAMES} game slots are busy; waiting\n`);
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
