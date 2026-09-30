import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
    '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

// On Steam the game loads mod files at this exact point: after its own script has been parsed,
// before it creates anything. The harness takes over the same point, so a mod that touches the
// game too early fails here as it would on Steam.
const STEAM_MOD_POINT = 'if (App && App.loadMods) App.loadMods(launch);';
const HARNESS_MOD_POINT = 'if (window.__harnessLoadMods) window.__harnessLoadMods(launch);';

/**
 * Serves the installed game read-only. The Steam glue is replaced by an empty script, so the
 * game runs in its web mode. `mods` are built mod files, served at /__mods/<index>/main.js.
 */
export async function startServer(appDir, mods = []) {
    const base = path.resolve(appDir);
    const gameScript = fs.readFileSync(path.join(base, 'src', 'main.js'), 'utf8');
    if (gameScript.split(STEAM_MOD_POINT).length !== 2) {
        throw new Error('the point where the game loads mods was not found exactly once; the game has changed');
    }
    const patchedGameScript = gameScript.replace(STEAM_MOD_POINT, HARNESS_MOD_POINT);

    const send = (res, type, body) => {
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(body);
    };

    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        if (url === '/steam/steam.js') return send(res, 'text/javascript', '/* Steam glue stubbed by the test harness */');
        if (url === '/src/main.js') return send(res, 'text/javascript', patchedGameScript);
        const mod = /^\/__mods\/(\d+)\/main\.js$/.exec(url);
        if (mod && mods[Number(mod[1])]) {
            return send(res, 'text/javascript', fs.readFileSync(mods[Number(mod[1])]));
        }
        const file = path.resolve(base, '.' + url);
        if (file !== base && !file.startsWith(base + path.sep)) {
            res.writeHead(403);
            return res.end();
        }
        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end();
            }
            send(res, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', data);
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    return {
        origin,
        modUrls: mods.map((_, i) => `${origin}/__mods/${i}/main.js`),
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}
