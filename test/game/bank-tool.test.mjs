// The measuring tool's luck-free runs (tools/dev/bank.mjs) are a controlled comparison only if
// every variant of one seed sees the same stock market. The market's prices draw from Math.random
// every tick (minigameMarket.js:806-871), and so does every building bought (its sound,
// main.js:7854), so a variant that bought differently sent the prices down another path: the
// office and allocator results mixed what they measured with the market's luck.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { skipReason } from '../harness/game.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');

/** One run of the tool, its JSON line parsed. */
function measure(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(root, 'tools', 'dev', 'bank.mjs'), ...args], { cwd: root });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) return reject(new Error(`bank.mjs ${args.join(' ')} exited ${code}: ${err}`));
            resolve(JSON.parse(out.trim().split('\n').pop()));
        });
    });
}

test('every variant of a luck-free seed sees the same stock market', { skip: skipReason() }, async () => {
    const [market, office] = await Promise.all([measure(['2', 'bank-a', 'market']), measure(['2', 'bank-a', 'office'])]);
    // The premise: the variants played differently.
    assert.ok(office.office > market.office, `the office variant should have upgraded the office: ${office.office} against ${market.office}`);
    assert.notEqual(office.earnedGain, market.earnedGain, 'the variants earned the same, so nothing was compared');
    for (let i = 0; i < market.trace.length; i++) {
        assert.deepEqual(office.trace[i].prices, market.trace[i].prices, `the prices part ways by hour ${market.trace[i].h}`);
    }
    assert.deepEqual(market.errors, []);
    assert.deepEqual(office.errors, []);
});
