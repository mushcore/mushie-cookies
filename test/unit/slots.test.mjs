// The machine-wide cap on concurrent harness games. Run in a child process with its own temp
// directory and a cap of one, so it never touches the real slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const slots = path.resolve(import.meta.dirname, '..', 'harness', 'slots.mjs');

function run(script) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mushie-slots-test-'));
    try {
        const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            env: { ...process.env, MUSHIE_MAX_GAMES: '1', TMP: tmp, TEMP: tmp, TMPDIR: tmp },
            encoding: 'utf8',
            timeout: 30000,
        });
        return JSON.parse(out.trim().split('\n').pop());
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

test('a second game waits until the first gives its slot back', () => {
    const out = run(`
        import { takeSlot, MAX_GAMES } from ${JSON.stringify('file:///' + slots.replace(/\\/g, '/'))};
        const release = await takeSlot();
        let second = false;
        const waiting = takeSlot().then((r) => { second = true; return r; });
        await new Promise((r) => setTimeout(r, 3000));
        const beforeRelease = second;
        release();
        const r2 = await waiting;
        r2();
        console.log(JSON.stringify({ max: MAX_GAMES, beforeRelease, afterRelease: second }));
    `);
    assert.deepEqual(out, { max: 1, beforeRelease: false, afterRelease: true });
});

test('a slot left by a process that died is taken over', () => {
    const out = run(`
        import fs from 'node:fs';
        import os from 'node:os';
        import path from 'node:path';
        const dir = path.join(os.tmpdir(), 'mushie-cookies-harness-slots');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'slot-0.lock'), '999999'); // no such process
        const { takeSlot } = await import(${JSON.stringify('file:///' + slots.replace(/\\/g, '/'))});
        const t0 = Date.now();
        const release = await takeSlot();
        const owner = fs.readFileSync(path.join(dir, 'slot-0.lock'), 'utf8');
        release();
        console.log(JSON.stringify({ fast: Date.now() - t0 < 1500, mine: owner === String(process.pid) }));
    `);
    assert.deepEqual(out, { fast: true, mine: true });
});
