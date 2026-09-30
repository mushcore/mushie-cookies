import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AUTOPILOT, applyAutopilot, isAutopilotSetting } from '../../src/core/autopilot.js';

// The preference list is a plain global script; evaluate it against a stand-in namespace.
const prefsSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'src', 'legacy', 'fc_preferences.js'), 'utf8');
const FrozenCookies = {};
new Function('FrozenCookies', prefsSource)(FrozenCookies);
const prefs = FrozenCookies.preferenceValues;

// Free-number settings entered in prompts rather than chosen from a list.
const NUMERIC = new Set(['cookieClickSpeed', 'frenzyClickSpeed', 'minCpSMult', 'maxSpecials', 'minLoanMult', 'minASFMult', 'manBankMins', 'mineMax', 'factoryMax', 'manaMax', 'orbMax']);
// The player's own display choices; the Autopilot never touches them.
const DISPLAY = ['numberDisplay', 'fancyui', 'logging', 'purchaseLog', 'fpsModifier', 'showMissedCookies', 'FCshortcuts'];

test('the Autopilot is the first option and, like every option, off by default', () => {
    assert.equal(Object.keys(prefs)[0], 'autopilot');
    for (const [name, p] of Object.entries(prefs)) {
        // Display options keep the inherited defaults; everything that plays starts off.
        if (p.display && !DISPLAY.includes(name) && name !== 'freeSeason' && name !== 'simulatedGCPercent') assert.equal(p.default, 0, `${name} defaults to ${p.default}`);
    }
    assert.equal(prefs.FCshortcuts.default, 0, 'keyboard shortcuts are a feature too');
    assert.deepEqual(prefs.autopilot.display, ['Autopilot OFF', 'Autopilot ON']);
});

test('every Autopilot value is a real setting with a value its menu can show', () => {
    for (const [name, value] of Object.entries(AUTOPILOT)) {
        if (NUMERIC.has(name)) {
            assert.ok(Number.isFinite(value) && value >= 0, `${name}=${value}`);
            continue;
        }
        assert.ok(prefs[name], `${name} is not a preference`);
        assert.ok(prefs[name].display, `${name} has no choices`);
        assert.ok(Number.isInteger(value) && value >= 0 && value < prefs[name].display.length, `${name}=${value} is outside its ${prefs[name].display.length} choices`);
    }
});

test('every playing option has an Autopilot value; display options have none', () => {
    const playing = Object.keys(prefs).filter((n) => prefs[n].display && n !== 'autopilot' && !DISPLAY.includes(n));
    const missing = playing.filter((n) => !(n in AUTOPILOT));
    assert.deepEqual(missing, [], 'playing options the Autopilot leaves to chance');
    for (const n of DISPLAY) assert.equal(isAutopilotSetting(n), false, n);
});

test('the Autopilot never runs two systems that act on the same thing', () => {
    // Each pair: the new system, and the inherited one it replaces.
    const pairs = [
        ['autoGods', ['autoWorshipToggle', 'autoWorship0', 'autoWorship1', 'autoWorship2', 'autoCyclius', 'autoDragonToggle', 'autoDragonAura0', 'autoDragonAura1', 'dragonsCurve']],
        // Double Cast FTHOF (autoFTHOFCombo) is part of forecast casting, not a rival to it.
        ['autoFate', ['autoCasting', 'auto100ConsistencyCombo']],
    ];
    for (const [modern, legacy] of pairs) {
        if (!AUTOPILOT[modern]) continue;
        for (const l of legacy) assert.equal(AUTOPILOT[l], 0, `${modern} is on, so ${l} must be off`);
    }
    if (AUTOPILOT.autoGods) assert.notEqual(AUTOPILOT.autoSL, 2, 'Auto Rigidel would slot gods behind the pantheon system');
});

test('applying the Autopilot sets every value and reports only what changed', () => {
    const settings = { autoBuy: 1, numberDisplay: 3 };
    const changed = applyAutopilot(settings);
    for (const [name, value] of Object.entries(AUTOPILOT)) assert.equal(settings[name], value, name);
    assert.equal(settings.numberDisplay, 3, 'display options are left alone');
    assert.ok(!changed.includes('autoBuy'), 'an option already at its value is not reported');
    assert.equal(changed.length, Object.keys(AUTOPILOT).length - 1);
    assert.deepEqual(applyAutopilot(settings), [], 'applying twice changes nothing');
});
