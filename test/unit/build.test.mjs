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
    const banned = [
        'getScript(', 'Game.LoadMod(', 'github.erbkaiser.com', 'erbkaiser.github.io',
        'cdnjs.cloudflare.com', 'ajax.googleapis.com', 'code.jquery.com', 'sourceMappingURL',
    ];
    for (const text of banned) assert.ok(!js.includes(text), `built file still contains "${text}"`);
});

test('built file parses as a classic script', () => {
    const js = fs.readFileSync(path.join(out, 'main.js'), 'utf8');
    assert.doesNotThrow(() => new Function(js));
});
