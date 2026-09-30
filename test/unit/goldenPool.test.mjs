import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeProbabilities, drawProbabilities, mixedOutcomeProbabilities } from '../../src/core/goldenPool.js';

const base = {
    wrath: 0, scorn: false, chainEligible: false, fools: false, dragonflightActive: false,
    buildingSpecial: false, lumps: false, reaper: 0, dragonflight: 0,
};
const sum = (p) => Object.values(p).reduce((a, b) => a + b, 0);
const close = (a, b) => Math.abs(a - b) < 1e-12;

// The first draw of a run: no previous outcome to avoid.
const first = (rules) => drawProbabilities(rules, '');

test('a plain early-game golden cookie is frenzy or lucky, with a small click frenzy chance', () => {
    const p = first(base);
    assert.ok(close(sum(p), 1));
    // Blab is a 1 in 10,000 extra entry; everything else is 90%: [frenzy, lucky], 10%: [frenzy, lucky, click frenzy].
    const blab = 0.0001;
    const expectedFrenzy = (1 - blab) * (0.9 * 0.5 + 0.1 / 3) + blab * (0.9 / 3 + 0.1 / 4);
    assert.ok(close(p['frenzy'], expectedFrenzy), `${p['frenzy']} vs ${expectedFrenzy}`);
    assert.ok(close(p['frenzy'], p['multiply cookies']));
    assert.ok(p['click frenzy'] > 0.03 && p['click frenzy'] < 0.034);
    assert.ok(p['blab'] > 0 && p['blab'] < 0.0001);
});

test('building special appears only with ten buildings', () => {
    assert.equal(first(base)['building special'] || 0, 0);
    assert.equal(outcomeProbabilities(base)['building special'] || 0, 0);
    const p = first({ ...base, buildingSpecial: true });
    assert.ok(p['building special'] > 0.07 && p['building special'] < 0.09, String(p['building special']));
});

test('a wrath cookie has clots and ruin, and never plain frenzy', () => {
    const p = outcomeProbabilities({ ...base, wrath: 1, buildingSpecial: true });
    assert.equal(p['frenzy'] || 0, 0);
    for (const name of ['clot', 'ruin cookies', 'blood frenzy', 'cursed finger', 'chain cookie', 'cookie storm']) {
        assert.ok(p[name] > 0, `${name} missing`);
    }
    assert.ok(close(sum(p), 1));
});

test('Skruuia makes clots and ruin four times as likely as lucky', () => {
    const p = outcomeProbabilities({ ...base, wrath: 1, scorn: true });
    assert.ok(p['clot'] > 2.5 * p['multiply cookies']);
});

test('dragon outcomes need their auras', () => {
    assert.equal(outcomeProbabilities(base)['dragon harvest'] || 0, 0);
    assert.equal(outcomeProbabilities(base)['dragonflight'] || 0, 0);
    const p = first({ ...base, reaper: 1 });
    // The gate is (golden and 15%) or 5% = 19.25%; inside it the list has three entries, about a third each.
    assert.ok(p['dragon harvest'] > 0.06 && p['dragon harvest'] < 0.065, String(p['dragon harvest']));
    const both = first({ ...base, reaper: 1.1, dragonflight: 1.1 });
    // With both auras the two share the gated list, so Dragon Harvest's share falls to about 0.77 of its own.
    assert.ok(both['dragonflight'] > 0 && both['dragon harvest'] > p['dragon harvest'] * 0.7 && both['dragon harvest'] < p['dragon harvest']);
});

test('an active dragonflight makes click frenzy rarer', () => {
    const without = outcomeProbabilities(base)['click frenzy'];
    const during = outcomeProbabilities({ ...base, dragonflightActive: true })['click frenzy'];
    assert.ok(during < without / 10);
});

test('chain and storm need a hundred thousand cookies earned', () => {
    assert.equal(outcomeProbabilities(base)['chain cookie'] || 0, 0);
    const p = first({ ...base, chainEligible: true });
    assert.ok(p['chain cookie'] > 0 && close(p['chain cookie'], p['cookie storm']));
});

test('probabilities never depend on the order flags are given', () => {
    const a = outcomeProbabilities({ ...base, buildingSpecial: true, chainEligible: true, lumps: true });
    const b = outcomeProbabilities({ lumps: true, chainEligible: true, buildingSpecial: true, ...base, buildingSpecial: true, chainEligible: true, lumps: true });
    assert.deepEqual(a, b);
});

test('a wrath cookie still rolls for chain and storm when the 30% roll fails', () => {
    const eligible = outcomeProbabilities({ ...base, wrath: 1, chainEligible: true });
    const not = outcomeProbabilities({ ...base, wrath: 1, chainEligible: false });
    assert.ok(eligible['chain cookie'] > not['chain cookie']);
    assert.equal(eligible['blood frenzy'] > 0, true);
});

// --- The 80% no-repeat rule (main.js:5447): an outcome equal to the last one is taken out of the
// list four times in five before the pick, and blab is added after (5448).

test('the last outcome is taken out of the list four times in five before the pick', () => {
    const b = 0.0001;
    const p = drawProbabilities(base, 'frenzy');
    // [frenzy, lucky] 90%, [frenzy, lucky, click frenzy] 10%; frenzy stays only in the 20% that keep it.
    const expected = 0.9 * 0.2 * ((1 - b) / 2 + b / 3) + 0.1 * 0.2 * ((1 - b) / 3 + b / 4);
    assert.ok(close(p['frenzy'], expected), `${p['frenzy']} vs ${expected}`);
    assert.ok(close(sum(p), 1));
    // Lucky gains what frenzy loses, so it is drawn far more often after a frenzy than before.
    assert.ok(p['multiply cookies'] > 0.75);
    // An outcome that is not in the list (blab is added after the removal) changes nothing.
    assert.deepEqual(drawProbabilities(base, 'blab'), first(base));
});

test('only one copy of a repeated outcome is taken out', () => {
    // Skruuia puts clot in a wrath list three times (main.js:5427); the rule removes one (5447).
    const rules = { ...base, wrath: 1, scorn: true };
    const after = drawProbabilities(rules, 'clot');
    assert.ok(after['clot'] > 0.3, String(after['clot']));
    assert.ok(after['clot'] < first(rules)['clot']);
});

// A seeded generator, so the check below is the same on every run.
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// The game's selection, transcribed line for line from main.js:5424-5455 (golden and wrath
// cookies share one `last`), with the golden cookie type's state kept by the caller.
function gameDraw(rules, wrath, last, random) {
    const list = [];
    if (wrath > 0) list.push('clot', 'multiply cookies', 'ruin cookies');
    else list.push('frenzy', 'multiply cookies');
    if (wrath > 0 && rules.scorn) list.push('clot', 'ruin cookies', 'clot', 'ruin cookies');
    if (wrath > 0 && random() < 0.3) list.push('blood frenzy', 'chain cookie', 'cookie storm');
    else if (random() < 0.03 && rules.chainEligible) list.push('chain cookie', 'cookie storm');
    if (random() < 0.05 && rules.fools) list.push('everything must go');
    if (random() < 0.1 && (random() < 0.05 || !rules.dragonflightActive)) list.push('click frenzy');
    if (wrath && random() < 0.1) list.push('cursed finger');
    if (rules.buildingSpecial && random() < 0.25) list.push('building special');
    if (rules.lumps && random() < 0.0005) list.push('free sugar lump');
    if ((wrath == 0 && random() < 0.15) || random() < 0.05) {
        if (random() < rules.reaper) list.push('dragon harvest');
        if (random() < rules.dragonflight) list.push('dragonflight');
    }
    if (last != '' && random() < 0.8 && list.indexOf(last) != -1) list.splice(list.indexOf(last), 1);
    if (random() < 0.0001) list.push('blab');
    return list[Math.floor(random() * list.length)];
}

/** Share of all cookies each outcome takes, by cookie type, over `draws` cookies of which `w` are wrath. */
function simulate(goldenRules, wrathRules, w, draws, seed) {
    const random = mulberry32(seed);
    const counts = { golden: {}, wrath: {} };
    let last = '';
    for (let i = 0; i < draws; i++) {
        const wrath = random() < w ? 1 : 0;
        const choice = gameDraw(wrath ? wrathRules : goldenRules, wrath, last, random);
        const into = wrath ? counts.wrath : counts.golden;
        into[choice] = (into[choice] || 0) + 1;
        // A storm's drops are popped through the same code with a forced choice, which leaves
        // 'cookie storm drop' as the last outcome (main.js:5451-5455).
        last = choice === 'cookie storm' ? 'cookie storm drop' : choice;
    }
    for (const type of ['golden', 'wrath']) for (const k of Object.keys(counts[type])) counts[type][k] /= draws;
    return counts;
}

function assertMatches(model, measured, draws, what) {
    for (const name of new Set([...Object.keys(model), ...Object.keys(measured)])) {
        const p = model[name] || 0;
        const f = measured[name] || 0;
        // Six standard errors: at 4 million draws the model sits within 1.6 of the rule.
        const tolerance = 6 * Math.sqrt((Math.max(p, 1 / draws) * (1 - p)) / draws) + 1e-9;
        assert.ok(Math.abs(p - f) <= tolerance, `${what} ${name}: model ${p.toFixed(5)}, game rule ${f.toFixed(5)} (±${tolerance.toFixed(5)})`);
    }
}

const DRAWS = 400000;
const midGame = { ...base, chainEligible: true, buildingSpecial: true, lumps: true };

test('the long-run golden pool matches the game rule, no-repeat included', () => {
    const model = outcomeProbabilities(midGame);
    assert.ok(close(sum(model), 1));
    const measured = simulate(midGame, null, 0, DRAWS, 1).golden;
    assertMatches(model, measured, DRAWS, 'golden');
    // Without the rule building special was about 8.1% and click frenzy about 3.1%.
    assert.ok(model['building special'] > 0.095, String(model['building special']));
    assert.ok(model['click frenzy'] > 0.037, String(model['click frenzy']));
});

test('the long-run wrath pool matches the game rule, Skruuia and dragon auras included', () => {
    const rules = { ...midGame, wrath: 1, scorn: true, reaper: 1, dragonflight: 1 };
    const model = outcomeProbabilities(rules);
    const measured = simulate(null, rules, 1, DRAWS, 2).wrath;
    assertMatches(model, measured, DRAWS, 'wrath');
});

test('golden and wrath cookies share one last outcome: the joint pool matches the game rule', () => {
    const golden = { ...midGame, reaper: 1 };
    const wrath = { ...golden, wrath: 1 };
    const w = 1 / 3; // elder wrath 1 (main.js:5325)
    const model = mixedOutcomeProbabilities(golden, wrath, w);
    assert.ok(close(sum(model.golden) + sum(model.wrath), 1));
    assert.ok(close(sum(model.wrath), w));
    const measured = simulate(golden, wrath, w, DRAWS, 3);
    assertMatches(model.golden, measured.golden, DRAWS, 'mixed golden');
    assertMatches(model.wrath, measured.wrath, DRAWS, 'mixed wrath');
    // With a single type the joint pool is that type's pool.
    const pure = mixedOutcomeProbabilities(golden, wrath, 0);
    assert.deepEqual(Object.keys(pure.wrath), []);
    for (const [k, v] of Object.entries(outcomeProbabilities(golden))) assert.ok(close(pure.golden[k], v), k);
});

test('the long-run pool is a fixed point of one more draw', () => {
    const pi = outcomeProbabilities(midGame);
    const next = {};
    for (const [last, p] of Object.entries(pi)) {
        const from = last === 'cookie storm' ? 'cookie storm drop' : last;
        for (const [k, q] of Object.entries(drawProbabilities(midGame, from))) next[k] = (next[k] || 0) + p * q;
    }
    for (const k of Object.keys(pi)) assert.ok(Math.abs(pi[k] - next[k]) < 1e-12, `${k}: ${pi[k]} vs ${next[k]}`);
});
