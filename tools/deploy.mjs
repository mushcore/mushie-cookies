import fs from 'node:fs';
import path from 'node:path';
import { gameAppDir, NOT_CONFIGURED } from './localConfig.mjs';

const root = path.resolve(import.meta.dirname, '..');
const from = path.join(root, 'dist', 'MushieCookies');
const app = gameAppDir(root);
if (!app) {
    console.error(NOT_CONFIGURED);
    process.exit(1);
}
if (!fs.existsSync(path.join(from, 'main.js'))) {
    console.error('nothing to deploy: run "npm run build" first');
    process.exit(1);
}
const to = path.join(app, 'mods', 'local', 'MushieCookies');
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log("deployed to the game's mods/local/MushieCookies");
