// The repository is public: nothing committed may carry a machine's own paths, which name the
// person who ran the tool (a measurement once recorded the mod's absolute path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..', '..');

function tracked() {
    try {
        return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    } catch {
        return null; // not a git checkout, such as an unpacked release
    }
}

// A home directory on Windows, macOS or Linux, in any slash style.
const HOME_PATH = /\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s"'`]+|(?:^|[\s"'`(])\/(?:Users|home)\/[^/\s"'`]+/m;

test('no committed text file holds a path into someone\'s home directory', { skip: tracked() ? false : 'not a git checkout' }, () => {
    const found = [];
    for (const file of tracked()) {
        const full = path.join(root, file);
        if (!fs.existsSync(full)) continue; // deleted in the working tree
        const buf = fs.readFileSync(full);
        if (buf.includes(0)) continue; // binary
        const m = buf.toString('utf8').match(HOME_PATH);
        if (m) found.push(`${file}: ${m[0].trim()}`);
    }
    assert.deepEqual(found, []);
});
