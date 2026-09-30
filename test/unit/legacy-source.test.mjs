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
const everything = all.map(([, src]) => src).join('\n');

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
        'autoworship1', 'autoworship2', 'officelevel', 'times.SI730', 'Game.shimmer.wrath', 'countAntiMatter',
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
    const patterns = [/\$\.getScript\(/, /Game\.LoadMod\(/, /\bfetch\(/, /XMLHttpRequest/, /\$\.(ajax|get|post)\(/];
    const found = [];
    for (const [file, src] of all) {
        for (const pattern of patterns) if (pattern.test(src)) found.push(`${file}: ${pattern}`);
    }
    assert.deepEqual(found, []);
});

test('functions the audit found unreferenced are gone', () => {
    const dead = [
        'rebuildStore', 'rebuildUpgrades', 'getBuildingTooltip', 'getUpgradeTooltip', 'colorizeScore',
        'cyclePreference', 'writeFCButton', 'shouldClickGC', 'cookieStats', 'weightedCookieValue', 'gcEfficiency',
        'earnedRemaining', 'buildingRemaining', 'estimatedTimeRemaining', 'cumulativeProbability', 'transpose',
    ];
    const found = [];
    for (const [file, src] of all) {
        for (const name of dead) if (new RegExp(`\\b${name}\\b`).test(src)) found.push(`${file}: ${name}`);
    }
    assert.deepEqual(found, []);
});

test('every function called by bare name is defined somewhere', () => {
    // Catches a deletion that removed a function something still calls.
    const defined = new Set();
    for (const m of everything.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
    for (const m of everything.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/g)) defined.add(m[1]);
    for (const m of everything.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^()]*\)\s*=>/g)) defined.add(m[1]);

    // Names that come from the language, the browser, the game or the vendored libraries.
    const external = new Set([
        'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'else', 'do', 'with',
        'eval', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'escape', 'unescape', 'alert', 'confirm', 'prompt',
        'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame',
        'Number', 'String', 'Boolean', 'Array', 'Object', 'Date', 'RegExp', 'Error', 'Symbol',
        'Beautify', 'l', 'loc', 'choose', 'randomFloor', 'PlaySound', 'tinyIcon', '$', '_', 'jQuery',
        'formatEveryThirdPower', 'rawFormatter', 'shuffle',
    ]);

    // Strip comments and string contents so that prose and markup are not read as calls.
    const code = everything
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, ' ')
        .replace(/`(?:\\.|[^`\\])*`/g, '``')
        .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
        .replace(/'(?:\\.|[^'\\\n])*'/g, "''");

    const missing = new Set();
    for (const m of code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = m[2];
        if (!defined.has(name) && !external.has(name)) missing.add(name);
    }
    // Callbacks handed to the guard by reference: MushieCookies.guard("legacy:x", x). Strings
    // were blanked above, so the first argument reads as ''.
    for (const m of code.matchAll(/MushieCookies\.guard\(\s*''\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
        if (!defined.has(m[1]) && !external.has(m[1])) missing.add(m[1]);
    }
    // Parameters and local variables that hold functions are called by bare name too.
    const locals = new Set();
    for (const m of code.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) {
        for (const p of m[1].split(',')) locals.add(p.trim().split('=')[0].trim());
    }
    for (const m of code.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) locals.add(m[1]);
    // Later names in a comma-separated declaration: `var a = 1, b = 2`.
    for (const m of code.matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=[^=]/g)) locals.add(m[1]);
    const unexplained = [...missing].filter((name) => !locals.has(name)).sort();
    assert.deepEqual(unexplained, []);
});
