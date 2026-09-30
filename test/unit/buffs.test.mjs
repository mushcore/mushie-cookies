import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
    KINDS,
    BUFF_TYPES,
    classifyBuff,
    classifyBuffs,
    cpsMultOf,
    clickMultOf,
    incomeSpikeRunning,
    longestSpikeSecondsLeft,
    unbuffedFactors,
    worthFinishing,
} from '../../src/core/buffs.js';
import { BUFF_FIXTURES, buffFromFixture } from '../fixtures/buffs.mjs';
import { gameAppDir, NOT_CONFIGURED } from '../../tools/localConfig.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const appDir = gameAppDir(root);
const needsGame = appDir ? false : NOT_CONFIGURED;
const gameFiles = () =>
    fs
        .readdirSync(path.join(appDir, 'src'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => [f, fs.readFileSync(path.join(appDir, 'src', f), 'utf8')]);

/** Every `new Game.buffType('name', ...)` in the game's scripts, main and minigames alike. */
function buffTypesInSource() {
    const names = [];
    for (const [, src] of gameFiles()) {
        for (const m of src.matchAll(/new\s+Game\.buffType\(\s*(['"])(.*?)\1/g)) names.push(m[2]);
    }
    return names;
}

/**
 * The game's own buff functions, evaluated from main.js with just enough of the game stubbed
 * for them to run: calling one returns exactly the object Game.gainBuff would receive.
 */
function buffFunctionsFromSource() {
    const src = fs.readFileSync(path.join(appDir, 'src', 'main.js'), 'utf8');
    const start = src.indexOf('//base buffs');
    const end = src.indexOf('//end of buffs');
    assert.ok(start > 0 && end > start, 'the buff definitions block was not found in main.js');
    const types = {};
    const Game = {
        fps: 30,
        Has: () => false,
        sayTime: (frames) => `${frames / 30} seconds`,
        ObjectsById: [{ name: 'Cursor', dname: 'Cursor', bsingle: 'cursor', amount: 50, iconColumn: 0 }],
        goldenCookieBuildingBuffs: { Cursor: ['High-five', 'Slap to the face'] },
        buffType: function (name, func) {
            types[name] = func;
        },
    };
    const text = (s) => s;
    vm.runInNewContext(src.slice(start, end), { Game, loc: text, EN: true, Beautify: String, LBeautify: String, Math });
    return types;
}

/** The ascension system's rule as it stands (src/systems/ascension.js), for comparison. */
const ascensionRule = (buff, maxSeconds, fps = 30) => {
    const raises = (buff.multCpS || 1) > 1 || (buff.multClick || 1) > 1 || (buff.type && buff.type.name === 'cookie storm');
    return raises && buff.time <= maxSeconds * fps;
};

const byType = Object.fromEntries(BUFF_FIXTURES.map((row) => [row.type, row]));
const fixture = (type, secondsLeft) => {
    const buff = buffFromFixture(byType[type]);
    if (secondsLeft !== undefined) buff.time = secondsLeft * 30;
    return buff;
};

// --- Coverage of the game's buff types -------------------------------------------------------

test('every buff type in the game source is in the classifier table, and nothing else is', { skip: needsGame }, () => {
    const inSource = buffTypesInSource();
    assert.ok(inSource.length >= 27, `only ${inSource.length} buff types found; the pattern may be stale`);
    assert.deepEqual(Object.keys(BUFF_TYPES).sort(), [...inSource].sort());
});

test('every buff type in the game source has a fixture', { skip: needsGame }, () => {
    assert.deepEqual(BUFF_FIXTURES.map((r) => r.type).sort(), buffTypesInSource().sort());
});

test("the fixtures match what the game's own buff functions return", { skip: needsGame }, () => {
    const funcs = buffFunctionsFromSource();
    for (const row of BUFF_FIXTURES) {
        const obj = funcs[row.type](...row.args);
        assert.equal(obj.name, row.name, row.type);
        assert.equal(obj.time, row.args[0] * 30, `${row.type} duration`);
        assert.equal(obj.multCpS, row.multCpS, `${row.type} multCpS`);
        assert.equal(obj.multClick, row.multClick, `${row.type} multClick`);
    }
});

test("every buff built by the game's own functions is classified as its fixture expects", { skip: needsGame }, () => {
    const funcs = buffFunctionsFromSource();
    for (const row of BUFF_FIXTURES) {
        const obj = funcs[row.type](...row.args);
        // As Game.gainBuff finishes it (main.js:13752, 13777).
        const buff = { ...obj, type: { name: row.type }, arg1: row.args[1], maxTime: obj.time };
        const c = classifyBuff(buff);
        assert.equal(c.kind, row.kind, `${row.type} (${row.name})`);
        assert.equal(c.known, true, row.type);
        assert.equal(c.secondsLeft, row.args[0], `${row.type} seconds left`);
    }
});

// --- Classification of each known type ---------------------------------------------------------

test('each known buff type gets its kind, multipliers and time left', () => {
    for (const row of BUFF_FIXTURES) {
        const c = classifyBuff(buffFromFixture(row));
        assert.equal(c.kind, row.kind, `${row.type} (${row.name})`);
        assert.equal(c.type, row.type);
        assert.equal(c.name, row.name);
        assert.equal(c.known, true, row.type);
        assert.equal(c.cpsMult, row.multCpS === undefined ? 1 : row.multCpS, `${row.type} cpsMult`);
        assert.equal(c.clickMult, row.multClick === undefined ? 1 : row.multClick, `${row.type} clickMult`);
        assert.equal(c.secondsLeft, row.args[0], `${row.type} secondsLeft`);
        assert.equal(c.fixedClick, row.fixedClick === undefined ? null : row.fixedClick, `${row.type} fixedClick`);
        assert.ok(Object.values(KINDS).includes(c.kind));
        assert.equal(typeof c.effect, 'string');
    }
});

test('the kinds are the four the spec names', () => {
    assert.deepEqual(Object.values(KINDS).sort(), ['debuff', 'income spike', 'long boost', 'neutral']);
});

test('the Cursed finger is a debuff whose clicks pay its power', () => {
    const c = classifyBuff(fixture('cursed finger'));
    assert.equal(c.kind, KINDS.DEBUFF);
    assert.equal(c.cpsMult, 0);
    assert.equal(c.fixedClick, 1e6);
    assert.equal(c.raisesIncome, false);
});

test('a building buff or debuff is classified by its type whatever the building', () => {
    const buff = { name: 'Brainstorm', time: 900, maxTime: 900, multCpS: 31, type: { name: 'building buff' } };
    const debuff = { name: 'Brain freeze', time: 900, maxTime: 900, multCpS: 1 / 31, type: { name: 'building debuff' } };
    assert.equal(classifyBuff(buff).kind, KINDS.SPIKE);
    assert.equal(classifyBuff(debuff).kind, KINDS.DEBUFF);
});

test('a long boost stays a long boost in its last seconds', () => {
    assert.equal(classifyBuff(fixture('sugar frenzy', 5)).kind, KINDS.LONG);
    assert.equal(classifyBuff(fixture('loan 3', 1)).kind, KINDS.LONG);
});

test('a buff without its type object is classified by its name', () => {
    const c = classifyBuff({ name: 'Frenzy', time: 900, multCpS: 7 });
    assert.equal(c.kind, KINDS.SPIKE);
    assert.equal(c.type, 'frenzy');
    assert.equal(c.known, true);
    assert.equal(classifyBuff({ name: 'Sugar blessing', time: 900 }).kind, KINDS.LONG);
});

test('secondsLeft follows the frame rate given', () => {
    assert.equal(classifyBuff({ ...fixture('frenzy'), time: 600 }, { fps: 60 }).secondsLeft, 10);
    assert.equal(classifyBuff({ ...fixture('frenzy'), time: 600 }).secondsLeft, 20);
});

// --- Fallback for unknown types -----------------------------------------------------------------

test('an unknown short buff raising CpS or clicks is an income spike', () => {
    const cps = classifyBuff({ name: 'Kitten rain', time: 30 * 30, maxTime: 30 * 30, multCpS: 3, type: { name: 'kitten rain' } });
    const click = classifyBuff({ name: 'Paw frenzy', time: 30 * 30, multClick: 50, type: { name: 'paw frenzy' } });
    assert.equal(cps.kind, KINDS.SPIKE);
    assert.equal(cps.known, false);
    assert.equal(cps.cpsMult, 3);
    assert.equal(click.kind, KINDS.SPIKE);
});

test('an unknown buff raising income for hours is a long boost, by its full duration', () => {
    const hours = 3 * 3600 * 30;
    const fresh = { name: 'Slow tide', time: hours, maxTime: hours, multCpS: 1.3, type: { name: 'slow tide' } };
    assert.equal(classifyBuff(fresh).kind, KINDS.LONG);
    assert.equal(classifyBuff({ ...fresh, time: 30 }).kind, KINDS.LONG, 'nearly over, still a long boost');
});

test('an unknown buff lowering CpS or clicks is a debuff, even if it raises the other', () => {
    assert.equal(classifyBuff({ name: 'Rust', time: 900, multCpS: 0.5, type: { name: 'rust' } }).kind, KINDS.DEBUFF);
    assert.equal(classifyBuff({ name: 'Numb', time: 900, multClick: 0.5, type: { name: 'numb' } }).kind, KINDS.DEBUFF);
    assert.equal(classifyBuff({ name: 'Halt', time: 900, multCpS: 0, type: { name: 'halt' } }).kind, KINDS.DEBUFF);
    assert.equal(classifyBuff({ name: 'Trade', time: 900, multCpS: 2, multClick: 0.5, type: { name: 'trade' } }).kind, KINDS.DEBUFF);
});

test('an unknown buff with no multipliers is neutral', () => {
    const c = classifyBuff({ name: 'Mystery', time: 900, type: { name: 'mystery' } });
    assert.equal(c.kind, KINDS.NEUTRAL);
    assert.equal(c.known, false);
    assert.equal(classifyBuff({ name: '???', time: 1 }).kind, KINDS.NEUTRAL);
});

// --- Helpers ------------------------------------------------------------------------------------

test('cpsMultOf and clickMultOf read a missing multiplier as 1 and keep a zero', () => {
    assert.equal(cpsMultOf(fixture('frenzy')), 7);
    assert.equal(cpsMultOf(fixture('click frenzy')), 1);
    assert.equal(cpsMultOf(fixture('cursed finger')), 0);
    assert.equal(clickMultOf(fixture('click frenzy')), 777);
    assert.equal(clickMultOf(fixture('frenzy')), 1);
});

test('classifyBuffs takes Game.buffs as the game keeps it, or a list, and skips removed entries', () => {
    const buffs = { Frenzy: fixture('frenzy'), Clot: fixture('clot'), Gone: 0 };
    assert.deepEqual(classifyBuffs(buffs).map((c) => c.name), ['Frenzy', 'Clot']);
    assert.deepEqual(classifyBuffs([fixture('frenzy')]).map((c) => c.kind), [KINDS.SPIKE]);
    assert.deepEqual(classifyBuffs(undefined), []);
});

test('incomeSpikeRunning sees short income buffs, not long boosts, debuffs or neutral ones', () => {
    const quiet = {
        'Sugar blessing': fixture('sugar blessing'),
        'Sugar frenzy': fixture('sugar frenzy'),
        'Loan 1': fixture('loan 1'),
        "Haggler's misery": fixture('haggler misery'),
        Clot: fixture('clot'),
        'Everything must go': fixture('everything must go'),
        'Cursed finger': fixture('cursed finger'),
    };
    assert.equal(incomeSpikeRunning(quiet), false);
    assert.equal(incomeSpikeRunning({}), false);
    for (const type of ['frenzy', 'blood frenzy', 'dragon harvest', 'click frenzy', 'dragonflight', 'cookie storm', 'building buff', 'devastation', 'loan 2']) {
        assert.equal(incomeSpikeRunning({ ...quiet, x: fixture(type) }), true, type);
    }
});

test('incomeSpikeRunning with maxSeconds counts only spikes ending that soon', () => {
    const buffs = [fixture('frenzy', 77)];
    assert.equal(incomeSpikeRunning(buffs, { maxSeconds: 60 }), false);
    assert.equal(incomeSpikeRunning(buffs, { maxSeconds: 77 }), true);
    assert.equal(incomeSpikeRunning(buffs, { maxSeconds: 100 }), true);
});

test('longestSpikeSecondsLeft is the latest end among spikes only', () => {
    const buffs = [fixture('frenzy', 40), fixture('click frenzy', 12), fixture('sugar frenzy', 3000), fixture('clot', 500)];
    assert.equal(longestSpikeSecondsLeft(buffs), 40);
    assert.equal(longestSpikeSecondsLeft([fixture('sugar blessing')]), 0);
    assert.equal(longestSpikeSecondsLeft({}), 0);
});

test('unbuffedFactors is the product each income is multiplied by', () => {
    const buffs = {
        Frenzy: fixture('frenzy'),
        'High-five': fixture('building buff'),
        Clot: fixture('clot'),
        'Click frenzy': fixture('click frenzy'),
        Devastation: fixture('devastation'),
        'Sugar blessing': fixture('sugar blessing'),
    };
    const f = unbuffedFactors(buffs);
    assert.equal(f.cps, 7 * 6 * 0.5);
    assert.equal(f.click, 777 * 1.5);
    assert.equal(f.fixedClick, null);
    assert.deepEqual(unbuffedFactors({}), { cps: 1, click: 1, fixedClick: null });
});

test('unbuffedFactors reports a Cursed finger: CpS cannot be divided back, clicks pay a fixed amount', () => {
    const f = unbuffedFactors({ Frenzy: fixture('frenzy'), 'Cursed finger': fixture('cursed finger') });
    assert.equal(f.cps, 0);
    assert.equal(f.fixedClick, 1e6);
});

// --- worthFinishing, against the ascension system's rule ----------------------------------------

test('worthFinishing agrees with the ascension rule on every buff type and time left', () => {
    for (const row of BUFF_FIXTURES) {
        for (const seconds of [1, 12.5, 599, 600, 601, 3600, 86400]) {
            for (const maxSeconds of [0, 60, 600, 7200]) {
                const buff = fixture(row.type, seconds);
                assert.equal(worthFinishing(buff, maxSeconds), ascensionRule(buff, maxSeconds), `${row.type}, ${seconds}s left, max ${maxSeconds}s`);
            }
        }
    }
});

test('worthFinishing examples: short income buffs yes, long buffs and debuffs no', () => {
    assert.equal(worthFinishing(fixture('frenzy'), 600), true);
    assert.equal(worthFinishing(fixture('cookie storm'), 600), true);
    assert.equal(worthFinishing(fixture('sugar blessing'), 600), false, 'a golden lump would stall a day');
    assert.equal(worthFinishing(fixture('magic inept'), 600), false, 'a backfire would stall ten minutes for nothing');
    assert.equal(worthFinishing(fixture('cursed finger'), 600), false);
    assert.equal(worthFinishing(fixture('loan 1', 300), 600), true, 'the rule finishes any income buff ending within the window');
    assert.equal(worthFinishing(fixture('loan 1'), 600), false);
});

test('worthFinishing follows the frame rate given', () => {
    const buff = { ...fixture('frenzy'), time: 1200 }; // 20 s at 60 fps, 40 s at 30
    assert.equal(worthFinishing(buff, 30, { fps: 60 }), true);
    assert.equal(worthFinishing(buff, 30), false);
});

test('an unknown income buff counts for worthFinishing by its multipliers', () => {
    const buff = { name: 'Kitten rain', time: 300, multCpS: 3, type: { name: 'kitten rain' } };
    assert.equal(worthFinishing(buff, 600), true);
    assert.equal(worthFinishing({ ...buff, multCpS: 0.5 }, 600), false);
});
