import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMod, legacySource } from '../../tools/build.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const out = path.join(root, 'dist', 'MushieCookies');

test('build produces one main.js and a valid info.txt', async () => {
    await buildMod();
    assert.deepEqual(fs.readdirSync(out).sort(), ['info.txt', 'main.js']);
    const info = JSON.parse(fs.readFileSync(path.join(out, 'info.txt'), 'utf8'));
    assert.equal(info.ID, 'mushie_cookies');
    assert.equal(info.Name, 'Mushie Cookies');
    assert.equal(info.AllowSteamAchievs, 1);
});

test('built file is self-contained', () => {
    const js = fs.readFileSync(path.join(out, 'main.js'), 'utf8');
    for (const placeholder of ['__MUSHIE_VERSION__', '__MUSHIE_LEGACY__']) {
        assert.ok(!js.includes(placeholder), `${placeholder} was not replaced`);
    }
    const banned = [
        'getScript(', 'Game.LoadMod(', 'github.erbkaiser.com', 'erbkaiser.github.io',
        'cdnjs.cloudflare.com', 'ajax.googleapis.com', 'code.jquery.com', 'sourceMappingURL=',
    ];
    for (const text of banned) assert.ok(!js.includes(text), `built file still contains "${text}"`);
});

test('built file and the legacy script it carries both parse', () => {
    const js = fs.readFileSync(path.join(out, 'main.js'), 'utf8');
    assert.doesNotThrow(() => new Function(js), 'main.js has a syntax error');
    assert.doesNotThrow(() => new Function(legacySource()), 'the legacy script has a syntax error');
});
