// Runs pieces of the legacy code in a sandbox with just enough of the game stubbed, to check
// behaviour that needs no browser. The number display test uses the game's own formatting code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { gameAppDir, NOT_CONFIGURED } from '../../tools/localConfig.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const legacy = (file) => fs.readFileSync(path.join(root, 'src', 'legacy', file), 'utf8');
const appDir = gameAppDir(root);
const needsGame = appDir ? false : NOT_CONFIGURED;

function sandbox(globals, files) {
    const ctx = vm.createContext({ console, ...globals });
    for (const file of files) vm.runInContext(legacy(file), ctx, { filename: file });
    return ctx;
}

// Stand-ins for the game's number formatting, for tests that do not look at numbers.
const plainNumbers = {
    rawFormatter: (v) => v,
    formatEveryThirdPower: () => (v) => String(v),
    formatLong: [],
    formatShort: [],
};

/** A bakery with `yous` You, priced like a building (base 1000, +15% each), and a Grimoire full of mana. */
function edificeBakery({ yous, cookies }) {
    const casts = [];
    let sales = 0;
    const game = {
        cookies,
        hasBuff: () => false,
        hasAura: () => false,
        ObjectsById: { 7: { minigameLoaded: false } },
        Objects: {},
    };
    const you = {
        amount: yous,
        get price() {
            return 1000 * Math.pow(1.15, this.amount);
        },
        getSellMultiplier: () => 0.25,
        // As main.js:7864-7880: a sale refunds a quarter of the price, and does nothing at 0.
        sell() {
            if (++sales > 1000) throw new Error('still selling after 1000 sales');
            if (this.amount > 0) {
                game.cookies += Math.floor(this.price * 0.25);
                this.amount--;
            }
        },
    };
    game.Objects.You = you;
    const grimoire = {
        magic: 100,
        magicM: 100,
        spellsById: {
            1: { costMin: 2, costPercent: 0.4 },
            2: { costMin: 8, costPercent: 0.2 },
            3: { costMin: 20, costPercent: 0.75 },
            4: { costMin: 10, costPercent: 0.1 },
        },
        castSpell: (spell) => casts.push(spell),
    };
    const ctx = sandbox(
        {
            Game: game,
            M: grimoire,
            FrozenCookies: { autoCasting: 5, towerLimit: 0, minCpSMult: 1, autoFTHOFCombo: 0, auto100ConsistencyCombo: 0 },
            MushieCookies: {},
            cpsBonus: () => 1,
            logEvent: () => {},
            Beautify: String,
            document: { getElementById: () => null },
        },
        ['fc_spells.js']
    );
    return { ctx, game, you, casts, sales: () => sales, edifice: grimoire.spellsById[3] };
}

test('Spontaneous Edifice casting never sells the last You, so it cannot loop forever', () => {
    // One You and no cookies: selling it cannot bank half a You. The inherited loop kept
    // selling the You that was no longer there and froze the page.
    const bakery = edificeBakery({ yous: 1, cookies: 0 });
    assert.doesNotThrow(() => bakery.ctx.autoCast());
    assert.equal(bakery.you.amount, 1, 'the last You is kept');
    assert.equal(bakery.sales(), 0);
    assert.deepEqual(bakery.casts, [], 'no cast while half a You cannot be banked');
});

test('Spontaneous Edifice casting still sells Yous until half a You is banked, then casts', () => {
    const bakery = edificeBakery({ yous: 5, cookies: 700 });
    bakery.ctx.autoCast();
    assert.equal(bakery.you.amount, 4, 'one sale banks half a You');
    assert.ok(bakery.game.cookies >= bakery.you.price / 2);
    assert.deepEqual(bakery.casts, [bakery.edifice]);

    const many = edificeBakery({ yous: 402, cookies: 1e300 });
    many.ctx.autoCast();
    assert.equal(many.you.amount, 399, 'sold down below 400, where the spell can pick You');
    assert.deepEqual(many.casts, [many.edifice]);
});

/** The infobox code over a fake canvas that counts what it is asked to do. */
function infobox(fancyui) {
    const calls = { measureText: 0, drawText: 0, drawArc: 0, drawRect: 0, nextPurchase: 0 };
    const canvas = {
        measureText: () => (calls.measureText++, { width: 120, height: 14 }),
        drawText: () => calls.drawText++,
        drawArc: () => calls.drawArc++,
        drawRect: () => calls.drawRect++,
        removeLayer: () => {},
        width: () => 300,
        height: () => 600,
    };
    const ctx = sandbox(
        {
            ...plainNumbers,
            $: () => canvas,
            _: { max: (list, by) => list.reduce((a, b) => (by(b) > by(a) ? b : a)) },
            FrozenCookies: { fancyui, numberDisplay: 1, cookieClickSpeed: 0 },
            MushieCookies: { clicksPerSecond: () => 0 }, // not clicking, as cookieClickSpeed 0 said
            Game: {
                fps: 30,
                cookies: 50,
                cookiesPs: 10,
                season: '',
                buffs: {},
                hasBuff: () => false,
                mouseCps: () => 1,
                shimmerTypes: { golden: { minTime: 1000, time: 100 } },
            },
            maxCookieTime: () => 5000,
            delayAmount: () => 0,
            nextPurchase: () => (calls.nextPurchase++, { cost: 100, type: 'building', purchase: { name: 'Cursor' } }),
            decodeHtml: (s) => s,
            divCps: (value, cps) => value / cps,
            cpsBonus: () => 1,
            clickBuffBonus: () => 1,
            Beautify: String,
        },
        ['fc_infobox.js']
    );
    return { ctx, calls };
}

test('while the infobox is off (the default) nothing is computed, measured or drawn', () => {
    const { ctx, calls } = infobox(0);
    // A frame left from when it was on.
    ctx.FrozenCookies.infoboxFrame = { t_draw: [{ name: 'Next: Cursor', display: '5s', f_percent: 0.5, c1: '#fff' }], frenzy: 1 };
    ctx.updateTimers();
    for (let i = 0; i < 10; i++) ctx.drawInfobox();
    assert.deepEqual(calls, { measureText: 0, drawText: 0, drawArc: 0, drawRect: 0, nextPurchase: 0 });
});

test('with the text infobox on, the labels are measured when they change, not on every draw', () => {
    const { ctx, calls } = infobox(1);
    ctx.updateTimers();
    assert.ok(calls.nextPurchase > 0, 'the infobox is computed');
    const measured = calls.measureText;
    assert.ok(measured <= 1);
    for (let i = 0; i < 10; i++) ctx.drawInfobox();
    assert.equal(calls.measureText, measured, 'drawing does not measure again');
    assert.ok(calls.drawText >= 10, 'the labels are drawn every time');
    assert.ok(calls.drawRect >= 10, 'on their backdrop');
});

/** The game's number formatting, from main.js: the formatters, their list and Beautify. */
function gameNumbers() {
    const src = fs.readFileSync(path.join(appDir, 'src', 'main.js'), 'utf8');
    const start = src.indexOf('function formatEveryThirdPower');
    const end = src.indexOf('var shortenNumber');
    assert.ok(start > 0 && end > start, 'the number formatting block was not found in main.js');
    return src.slice(start, end);
}

/** A page with the game's numbers, and one with the legacy code loaded over them as the mod does. */
function numberPages(numberDisplay) {
    const numbers = gameNumbers();
    const game = vm.createContext({ Game: { prefs: { format: 0 } } });
    vm.runInContext(numbers, game);
    const modded = vm.createContext({ Game: { prefs: { format: 0 } }, FrozenCookies: { numberDisplay } });
    vm.runInContext(numbers, modded);
    vm.runInContext(legacy('fc_infobox.js'), modded);
    vm.runInContext('Beautify = fcBeautify;', modded); // as setOverrides does
    return { game, modded };
}

test('the legacy code leaves the game\'s list of number formatters alone', { skip: needsGame }, () => {
    const { modded } = numberPages(1);
    // Beautify picks from this list by the game's Short numbers option (main.js:231-232).
    assert.equal(modded.numberFormatters.length, 3);
    assert.equal(modded.numberFormatters[2], modded.rawFormatter);
});

test('at the default number display, numbers read exactly as the game shows them, Short numbers option included', { skip: needsGame }, () => {
    const { game, modded } = numberPages(1);
    const cases = [[12.7], [0.5, 1], [1234567], [-98765.4321, 2], [999.95, 1], [1e21], [3.9e40], [0], [NaN]];
    for (const format of [0, 1]) {
        game.Game.prefs.format = format;
        modded.Game.prefs.format = format;
        for (const [value, floats] of cases) {
            assert.equal(modded.Beautify(value, floats), game.Beautify(value, floats), `Beautify(${value}, ${floats}) with prefs.format ${format}`);
        }
    }
});

test('a chosen number display still floors and honours decimals as the game does', { skip: needsGame }, () => {
    const initials = numberPages(2).modded;
    assert.equal(initials.Beautify(12.7), '12');
    assert.equal(initials.Beautify(0.5, 1), '0.5');
    assert.equal(initials.Beautify(1234567), '1.235M');
    assert.equal(initials.Beautify(-1234567), '-1.235M');
    const raw = numberPages(0).modded;
    assert.equal(raw.Beautify(1234567.8), '1,234,567');
    assert.equal(raw.Beautify(12.34, 1), '12.3');
    const si = numberPages(3).modded;
    assert.equal(si.Beautify(2.5e9), '2.5 G');
    assert.equal(si.Beautify(1e40), '1.00e40', 'past the SI prefixes: scientific');
    const scientific = numberPages(4).modded;
    assert.equal(scientific.Beautify(6.3e12), '6.30e12');
});
