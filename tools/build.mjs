import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outDir = path.join(root, 'dist', 'MushieCookies');

const VENDOR = ['jquery-3.6.0.min.js', 'underscore-1.8.3.min.js', 'jcanvas-20.1.1.min.js'];
// Order matters: legacy files are global scripts, and some run code as soon as they are evaluated.
export const LEGACY = [
    'fc_bootstrap.js',
    'fc_preferences.js',
    'cc_upgrade_prerequisites.js',
    'fc_main.js',
    'fc_gods.js',
    'fc_spells.js',
    'fc_button.js',
    'fc_infobox.js',
];
// The Steam build of the game runs on Electron 11.5, which is Chrome 87.
const TARGET = 'chrome87';

const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
// A source map comment in the middle of a concatenated file points at a file that is not shipped.
const stripSourceMap = (js) => js.replace(/^\/\/[#@] sourceMappingURL=.*$/gm, '');

/** The legacy files as one script. Steam loads mods before the game exists, so this is carried as text and evaluated later. */
export function legacySource() {
    return LEGACY.map((f) => `/* src/legacy/${f} */\n${read('src', 'legacy', f)}`)
        .join('\n;\n')
        .replaceAll('__MUSHIE_VERSION__', pkg.version);
}

export async function buildMod() {
    const bundled = await build({
        entryPoints: [path.join(root, 'src', 'main.js')],
        bundle: true,
        format: 'iife',
        globalName: 'MushieCookies',
        target: TARGET,
        write: false,
        legalComments: 'none',
        define: {
            __MUSHIE_VERSION__: JSON.stringify(pkg.version),
            __MUSHIE_LEGACY__: JSON.stringify(legacySource()),
        },
    });

    const parts = [
        `/* Mushie Cookies ${pkg.version}. Built file: edit the sources, not this. */`,
        ...VENDOR.map((f) => `/* vendor/${f} */\n${stripSourceMap(read('vendor', f))}`),
        `/* src (bundled) */\n${bundled.outputFiles[0].text}`,
    ];

    const info = {
        Name: 'Mushie Cookies',
        ID: 'mushie_cookies',
        Author: 'mushcore. Fork of Frozen Cookies by Icehawk78, Mtarnuhal, erbkaiser and contributors',
        Description: 'Plays Cookie Clicker by itself. Self-contained: loads nothing from the network.',
        ModVersion: pkg.version,
        GameVersion: 2.053,
        Date: new Date().toLocaleDateString('en-GB'),
        Dependencies: [],
        Disabled: 0,
        AllowSteamAchievs: 1,
    };

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'main.js'), parts.join('\n;\n') + '\n');
    fs.writeFileSync(path.join(outDir, 'info.txt'), JSON.stringify(info, null, '\t') + '\n');
    return outDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
    const out = await buildMod();
    console.log(`built ${path.relative(root, out)} (${pkg.version})`);
}
