// Stopping a spawned runtime must stop what it started. On Windows child.kill() ends only the
// process itself: an Electron runtime's renderer, which runs the game, is left running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { stopTree } from '../harness/runtime.mjs';

const alive = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('stopTree stops a process and the process it started', { skip: process.platform !== 'win32' && 'Windows only' }, async () => {
    // A parent that starts a long-lived child, like Electron starting its renderer. Node would put
    // an ordinary child in a job that dies with the parent; `detached` keeps it out, as the
    // renderer is.
    const script = [
        "const { spawn } = require('node:child_process');",
        "const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true });",
        'console.log(c.pid);',
        'setInterval(() => {}, 1000);',
    ].join('\n');
    const parent = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
    const grandchild = await new Promise((resolve) => parent.stdout.once('data', (d) => resolve(Number(String(d).trim()))));
    try {
        assert.ok(alive(grandchild));
        stopTree(parent);
        for (let i = 0; i < 50 && (alive(parent.pid) || alive(grandchild)); i++) await sleep(100);
        assert.equal(alive(parent.pid), false, 'the process');
        assert.equal(alive(grandchild), false, 'and the process it started');
    } finally {
        for (const pid of [grandchild, parent.pid]) {
            try {
                process.kill(pid);
            } catch (e) {
                // already gone
            }
        }
    }
});

test('stopTree leaves a process that has already exited alone', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await new Promise((resolve) => child.once('exit', resolve));
    assert.doesNotThrow(() => stopTree(child));
});
