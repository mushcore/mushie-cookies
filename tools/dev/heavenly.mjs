// Lists the heavenly (prestige) upgrades from the installed game's source: name, price in chips, parents.
// Usage: node tools/dev/heavenly.mjs
import fs from 'node:fs';
import path from 'node:path';
import { gameAppDir, NOT_CONFIGURED } from '../localConfig.mjs';

const app = gameAppDir(path.resolve(import.meta.dirname, '..', '..'));
if (!app) {
    console.error(NOT_CONFIGURED);
    process.exit(1);
}
const source = fs.readFileSync(path.join(app, 'src', 'main.js'), 'utf8');
const out = [];
for (const line of source.split('\n')) {
    if (!line.includes("pool='prestige'")) continue;
    const name = (line.match(/new Game\.Upgrade\('((?:[^'\\]|\\.)+)'/) || [])[1];
    const price = (line.match(/,\s*([0-9]+),\s*\[[0-9]+,[0-9]+\]/) || [])[1];
    const parents = (line.match(/Game\.last\.parents=\[([^\]]*)\]/) || [])[1];
    if (name) out.push({ name: name.replace(/\\'/g, "'"), price: Number(price), parents: parents || '' });
}
out.sort((a, b) => a.price - b.price);
console.log(out.length + ' prestige upgrades');
for (const u of out) console.log(`${String(u.price).padStart(22)}  ${u.name}${u.parents ? '   <- ' + u.parents : ''}`);
