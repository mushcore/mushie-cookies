import fs from 'node:fs';
import path from 'node:path';

const LOCAL_FILE = '.mushie.local.json';

/** Folder that contains the game's `src/main.js`, or null when not configured. */
export function gameAppDir(cwd = process.cwd(), env = process.env) {
    let dir = env.COOKIE_CLICKER_APP;
    const file = path.join(cwd, LOCAL_FILE);
    if (!dir && fs.existsSync(file)) {
        dir = JSON.parse(fs.readFileSync(file, 'utf8')).gameApp;
    }
    if (!dir) return null;
    return fs.existsSync(path.join(dir, 'src', 'main.js')) ? path.resolve(dir) : null;
}

export const NOT_CONFIGURED =
    'game location not configured: set COOKIE_CLICKER_APP or create .mushie.local.json ' +
    'with {"gameApp": "<path to the game\'s resources/app folder>"}';
