// Small helpers for scripted, all-or-nothing edits to the legacy files.
// Every helper throws when its target is missing or ambiguous, so a drifted file is never half-edited.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');

export function open(relative) {
    const file = path.join(root, relative);
    let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const count = (needle) => text.split(needle).length - 1;

    const api = {
        get text() {
            return text;
        },
        /** Replaces exactly one occurrence. */
        replace(find, replacement) {
            const n = count(find);
            if (n !== 1) throw new Error(`${relative}: expected 1 match, found ${n} for:\n${find.slice(0, 120)}`);
            text = text.replace(find, () => replacement);
            return api;
        },
        /** Replaces every occurrence; at least `min` must exist. */
        replaceAll(find, replacement, min = 1) {
            const n = count(find);
            if (n < min) throw new Error(`${relative}: expected at least ${min} matches, found ${n} for:\n${find.slice(0, 120)}`);
            text = text.split(find).join(replacement);
            return api;
        },
        /** Removes a top-level `function name(...) { ... }`, including the comment lines directly above it. */
        removeFunction(name) {
            const lines = text.split('\n');
            const starts = lines.reduce((acc, line, i) => (new RegExp(`^function ${name}\\s*\\(`).test(line) ? [...acc, i] : acc), []);
            if (starts.length !== 1) throw new Error(`${relative}: expected 1 top-level function ${name}, found ${starts.length}`);
            let start = starts[0];
            let end = start;
            while (end < lines.length && lines[end] !== '}') end++;
            if (end === lines.length) throw new Error(`${relative}: no closing brace for function ${name}`);
            while (start > 0 && /^\/\//.test(lines[start - 1])) start--;
            // Swallow one blank line so removals do not leave a widening gap.
            if (lines[end + 1] === '') end++;
            lines.splice(start, end - start + 1);
            text = lines.join('\n');
            return api;
        },
        has(name) {
            return new RegExp(`^function ${name}\\s*\\(`, 'm').test(text);
        },
        save() {
            fs.writeFileSync(file, text);
        },
    };
    return api;
}
