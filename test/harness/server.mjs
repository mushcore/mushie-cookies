import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
    '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

/**
 * Serves the installed game read-only. The Steam glue is replaced by an empty script,
 * so the game runs in its web mode.
 */
export async function startServer(appDir) {
    const base = path.resolve(appDir);
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        if (url === '/steam/steam.js') {
            res.writeHead(200, { 'content-type': 'text/javascript' });
            return res.end('/* Steam glue stubbed by the test harness */');
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
            const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
            res.writeHead(200, { 'content-type': type });
            res.end(data);
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    return { origin, close: () => new Promise((resolve) => server.close(resolve)) };
}
