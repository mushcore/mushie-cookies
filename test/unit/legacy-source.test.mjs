// Checks on the text of the legacy files. They catch classes of mistake the audit found,
// wherever they reappear, without needing the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', '..', 'src', 'legacy');
const all = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);

test('every legacy file parses', () => {
    for (const [file, src] of all) assert.doesNotThrow(() => new Function(src), `${file} has a syntax error`);
});

test('no negation binds tighter than a comparison', () => {
    // `!a == b` compares a boolean with b; it is never what was meant.
    const bad = [];
    for (const [file, src] of all) {
        src.split('\n').forEach((line, i) => {
            if (/(^|[^!=<>\w.)\]])!\s*[A-Za-z_][\w.]*(\([^()]*\))?\s*[!=]==?\s*\S/.test(line)) {
                bad.push(`${file}:${i + 1}: ${line.trim()}`);
            }
        });
    }
    assert.deepEqual(bad, []);
});

test('known misspelled identifiers are gone', () => {
    const banned = [
        'autoworship1', 'officelevel', 'times.SI730', 'Game.shimmer.wrath', 'countAntiMatter',
        'FrozenCookies.lastCps', 'FrozenCookies.lastBaseCps',
    ];
    const found = [];
    for (const [file, src] of all) for (const word of banned) if (src.includes(word)) found.push(`${file}: ${word}`);
    assert.deepEqual(found, []);
});

test('Auto Sweet is removed', () => {
    const found = all.filter(([, src]) => /autosweet/i.test(src)).map(([file]) => file);
    assert.deepEqual(found, []);
});

test('nothing loads code or data from the network', () => {
    const found = [];
    for (const [file, src] of all) {
        for (const pattern of [/\$\.getScript\(/, /Game\.LoadMod\(/, /\bfetch\(/, /XMLHttpRequest/, /\$\.(ajax|get|post)\(/]) {
            if (pattern.test(src)) found.push(`${file}: ${pattern}`);
        }
    }
    assert.deepEqual(found, []);
});
