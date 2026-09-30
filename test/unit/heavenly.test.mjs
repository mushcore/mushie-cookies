import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ENABLER_SHARE,
    fixedShare,
    planChips,
    closure,
    planTree,
    lumpsPerHarvest,
    lumpsPerDay,
    lumpValue,
    lumpShare,
    sugarFrenzyShare,
    seasonBoostShare,
    rankSlots,
} from '../../src/core/heavenly.js';

test('shares the planner now measures carry no fixed share (M2: guesses replaced by what-ifs)', () => {
    for (const name of ['Season switcher', 'Box of brand biscuits', 'Box of macarons', 'Tin of british tea biscuits', 'Tin of butter cookies', 'Permanent upgrade slot I', 'Permanent upgrade slot V']) {
        assert.equal(ENABLER_SHARE[name], undefined, name);
    }
    // The switch keeps a share of its own: Residual luck, and through it Pet the dragon and
    // Fortune cookies, hang off it.
    assert.ok(ENABLER_SHARE['Golden switch'] > 0);
});

// A small heavenly tree in the shape of the game's (main.js:10815-11483).
const node = (id, name, price, parents = [], extra = {}) => ({ id, name, price, parents, owned: false, shown: true, ...extra });
const valueBy = (worth) => (planned, bundles) => bundles.map((b) => b.members.reduce((s, m) => s + (worth[m.name] || 0), 0));

test('ranks by income share per chip: what the chips cover goes to the most per chip first', () => {
    const tree = [node(1, 'Heavenly cookies', 3), node(2, 'Kitten angels', 9000), node(3, 'Heavenly key', 25000000)];
    const plan = planTree({ tree, chips: 9003, value: valueBy({ 'Heavenly cookies': 0.1, 'Kitten angels': 0.5, 'Heavenly key': 0.25 }) });
    assert.deepEqual(plan.buy.map((b) => b.name), ['Heavenly cookies', 'Kitten angels']);
    assert.ok(Math.abs(plan.buy[0].share - 0.1) < 1e-12);
    assert.equal(plan.left, 0);
});

test('fixed shares stand only for what the model cannot see, summed over a bundle', () => {
    assert.ok(Math.abs(fixedShare(['Twin Gates of Transcendence', 'Belphegor']) - 0.04) < 1e-12);
    assert.equal(fixedShare(['Heavenly cookies']), 0, 'a measured upgrade has no fixed share');
    assert.ok(Math.abs(fixedShare(['Starsnow'], { dropShares: { christmas: 0.2 } }) - 0.005) < 1e-12);
    assert.ok(Math.abs(fixedShare(['Sugar craving'], { horizonSeconds: 86400 }) - 2 / 24) < 1e-12);
    assert.equal(fixedShare(['Sugar craving']), 0, 'no horizon, no frenzy');
});

test('Legacy comes first: nothing else is reachable without it', () => {
    const tree = [node(1, 'Legacy', 1), node(2, 'Heavenly cookies', 3, [1]), node(3, 'How to bake your dragon', 9, [1]), node(4, 'Twin Gates of Transcendence', 1, [1])];
    const measured = { 'Heavenly cookies': 0.1 };
    const value = (planned, bundles) => bundles.map((b) => b.members.reduce((s, m) => s + (measured[m.name] || 0), 0) + fixedShare(b.members.map((m) => m.name)));
    const plan = planTree({ tree, chips: 14, value });
    assert.equal(plan.buy[0].name, 'Legacy');
    assert.deepEqual(plan.buy.map((b) => b.name).sort(), ['Heavenly cookies', 'How to bake your dragon', 'Legacy', 'Twin Gates of Transcendence']);
});

test('closure lists every ancestor still missing, parents first, each once', () => {
    const tree = [
        node(1, 'Twin Gates', 1),
        node(2, 'Angels', 7, [1]),
        node(3, 'Dominions', 49, [2]),
        node(4, 'Belphegor', 7, [1]),
        node(5, 'Satan', 2401, [4]),
        node(6, 'Synergies Vol. I', 222222, [5, 3]),
    ];
    tree[0].owned = true;
    const byId = new Map(tree.map((n) => [n.id, n]));
    const names = closure(tree[5], byId, new Set([4])).map((n) => n.name);
    assert.deepEqual(names, ['Satan', 'Angels', 'Dominions', 'Synergies Vol. I']);
});

test('M2: a parent worth nothing is bought for the child it leads to, parents first', () => {
    // Stevia Caelestis only ripens lumps sooner; Sugar baking is +1% CpS per lump held.
    const tree = [node(1, 'Wrinkly cookies', 10), node(2, 'Stevia Caelestis', 100, [1]), node(3, 'Sugar baking', 200, [2]), node(4, 'Eye of the wrinkler', 50, [1])];
    const plan = planTree({ tree, chips: 400, value: valueBy({ 'Wrinkly cookies': 0.1, 'Sugar baking': 1 }) });
    assert.deepEqual(plan.buy.map((b) => b.name), ['Wrinkly cookies', 'Stevia Caelestis', 'Sugar baking']);
    assert.equal(plan.left, 90);
    assert.equal(plan.buy[1].for, 'Sugar baking', 'the parent is recorded as bought for its child');
});

test('a chain of worthless parents is walked to the child at its end (Angels to Kitten angels)', () => {
    const tree = [node(1, 'Angels', 7), node(2, 'Archangels', 49, [1]), node(3, 'Virtues', 343, [2]), node(4, 'Dominions', 2401, [3]), node(5, 'Kitten angels', 9000, [4])];
    const plan = planTree({ tree, chips: 20000, value: valueBy({ 'Kitten angels': 0.3 }) });
    assert.deepEqual(plan.buy.map((b) => b.name), ['Angels', 'Archangels', 'Virtues', 'Dominions', 'Kitten angels']);
});

test('the best child decides: a parent is bought with the child worth most per chip', () => {
    const tree = [node(1, 'Residual luck', 100), node(2, 'Pet the dragon', 1000, [1]), node(3, 'Golden cookie alert sound', 10, [1]), node(4, 'Heavenly cookies', 3)];
    const plan = planTree({ tree, chips: 1103, value: valueBy({ 'Pet the dragon': 0.06, 'Heavenly cookies': 0.1 }) });
    assert.deepEqual(plan.buy.map((b) => b.name), ['Heavenly cookies', 'Residual luck', 'Pet the dragon']);
});

test('an upgrade not shown at the coming prestige blocks every bundle through it', () => {
    const tree = [node(1, 'Lucky digit', 777, [], { shown: false }), node(2, 'Lucky number', 77777, [1])];
    const plan = planTree({ tree, chips: 1e9, value: valueBy({ 'Lucky digit': 0.05, 'Lucky number': 0.05 }) });
    assert.deepEqual(plan.buy, []);
});

test('bundles out of reach are not measured at all', () => {
    const tree = [node(1, 'Heavenly cookies', 3), node(2, 'Pet the dragon', 99999999999)];
    const seen = [];
    planTree({
        tree,
        chips: 100,
        value: (planned, bundles) => {
            seen.push(...bundles.map((b) => b.name));
            return bundles.map(() => 0.1);
        },
    });
    assert.ok(!seen.includes('Pet the dragon'));
});

test('saves for a bundle far better per chip than anything affordable', () => {
    const tree = [node(1, 'Wrinkly cookies', 300), node(2, 'Sugar baking', 300, [1]), node(3, 'Filler', 10)];
    const plan = planTree({ tree, chips: 400, value: valueBy({ 'Sugar baking': 10, Filler: 0.001 }) });
    assert.deepEqual(plan.buy, []);
    assert.equal(plan.saving.name, 'Sugar baking');
    assert.equal(plan.left, 400);
});

test('bundles worth nothing are never bought, however many chips', () => {
    const tree = [node(1, 'Classic dairy selection', 9), node(2, 'Fanciful dairy selection', 1e6, [1])];
    const plan = planTree({ tree, chips: 1e12, value: valueBy({}) });
    assert.deepEqual(plan.buy, []);
    assert.equal(plan.saving, null);
});

test('mean lumps per harvest matches an exact enumeration of the type roll', () => {
    // Base: bifurcated 10%, golden 0.3%, caramelized 2% (main.js:4522-4539); yields 1.5, 4.5, 2.
    assert.ok(Math.abs(lumpsPerHarvest({}) - 1.0395) < 5e-5, String(lumpsPerHarvest({})));
    // Sucralosia: bifurcated 15% and 5% of them give 2 outright (main.js:4489-4490).
    const sucra = lumpsPerHarvest({ sucralosia: true });
    assert.ok(sucra > lumpsPerHarvest({}) && sucra < 1.07, String(sucra));
    // Meaty lumps (grandmapocalypse) average 1, the same as a normal one.
    assert.ok(Math.abs(lumpsPerHarvest({ elderWrath: 3 }) - lumpsPerHarvest({})) < 0.02);
    // Dragon's Curve rolls twice.
    assert.ok(Math.abs(lumpsPerHarvest({ curve: 1 }) - 1.0758) < 5e-4, String(lumpsPerHarvest({ curve: 1 })));
});

test('lumps per day follow the ripening time', () => {
    const at23 = lumpsPerDay({ ripeMs: 23 * 3600e3 });
    const at22 = lumpsPerDay({ ripeMs: 22 * 3600e3 });
    assert.ok(Math.abs(at23 - (24 / 23) * lumpsPerHarvest({})) < 1e-12);
    assert.ok(at22 > at23);
    assert.equal(lumpsPerDay({ ripeMs: 0 }), 0);
});

test('a lump is worth the best of a building level and, with Sugar baking under 100 held, 1% of CpS', () => {
    const buildings = [
        { name: 'Cursor', level: 0, amount: 100, share: 0.2 },
        { name: 'You', level: 4, amount: 10, share: 0.5 },
    ];
    const level = lumpValue({ lumps: 150, sugarBaking: true, buildings });
    assert.ok(Math.abs(level - 0.2 * 0.01) < 1e-12, 'at 100 or more held, the lump goes to a level');
    const baking = lumpValue({ lumps: 50, sugarBaking: true, buildings });
    assert.ok(Math.abs(baking - 0.01 / 1.5) < 1e-12, 'each lump under 100 adds 1% on a multiplier of 1 + lumps/100 (main.js:5095)');
    assert.ok(Math.abs(lumpValue({ lumps: 50, sugarBaking: false, buildings }) - 0.002) < 1e-12);
    assert.equal(lumpValue({ lumps: 5, sugarBaking: false, buildings: [] }), 0);
});

test('a lump upgrade is worth its extra lumps over the next run, averaged over it', () => {
    const share = lumpShare({ perDayBefore: 1, perDayAfter: 1.5, value: 0.01, horizonSeconds: 2 * 86400 });
    assert.ok(Math.abs(share - (0.5 * 0.01 * 2) / 2) < 1e-12);
    assert.equal(lumpShare({ perDayBefore: 1, perDayAfter: 1, value: 0.01, horizonSeconds: 86400 }), 0);
    assert.equal(lumpShare({ perDayBefore: 1, perDayAfter: 2, value: 0.01, horizonSeconds: 0 }), 0);
});

test('Sugar frenzy is two extra hours of CpS a run, capped at tripling a short run', () => {
    assert.ok(Math.abs(sugarFrenzyShare(24 * 3600) - 2 / 24) < 1e-12);
    assert.equal(sugarFrenzyShare(1800), 2);
    assert.equal(sugarFrenzyShare(0), 0);
});

test('season boosts are worth part of the drops they speed up; Keepsakes a fifth of all drops', () => {
    const drops = { christmas: 0.2, halloween: 0.15, easter: 0.3, all: 0.9 };
    assert.ok(Math.abs(seasonBoostShare('Starsnow', drops) - (0.05 / 2) * 0.2) < 1e-12);
    assert.ok(Math.abs(seasonBoostShare('Starterror', drops) - (0.1 / 2) * 0.15) < 1e-12);
    assert.ok(Math.abs(seasonBoostShare('Starspawn', drops) - (0.1 / 2) * 0.3) < 1e-12);
    assert.ok(Math.abs(seasonBoostShare('Keepsakes', drops) - (0.2 / 2) * 0.9) < 1e-12);
    assert.equal(seasonBoostShare('Heavenly cookies', drops), 0);
    assert.equal(seasonBoostShare('Starsnow', {}), 0);
});

test('permanent slots go to what the next run would miss longest, not to the biggest share at the end', () => {
    // Kitten helpers is the bigger share now, but the buyer has it back a minute into the run;
    // the late cookie upgrade takes most of the run to afford again.
    const ranked = rankSlots({
        candidates: [
            { id: 1, name: 'Kitten helpers', share: 0.3, reacquire: 1e9 },
            { id: 2, name: 'Late cookie', share: 0.08, reacquire: 4e11 },
            { id: 3, name: 'Nothing', share: 0, reacquire: 1e12 },
        ],
        runCookies: 1e12,
    });
    assert.deepEqual(ranked.map((c) => c.name), ['Late cookie', 'Kitten helpers']);
    assert.ok(Math.abs(ranked[0].value - 0.08 * 0.4) < 1e-12, 'value: the share lost over the part of the run baked before it returns');
    // Never more than the whole run.
    const [capped] = rankSlots({ candidates: [{ id: 1, name: 'x', share: 0.1, reacquire: 5e12 }], runCookies: 1e12 });
    assert.ok(Math.abs(capped.value - 0.1) < 1e-12);
});

test('planChips buys down the ranking while chips last', () => {
    const ranked = [
        { id: 1, name: 'a', price: 1, valuePerChip: 10 },
        { id: 2, name: 'b', price: 3, valuePerChip: 5 },
        { id: 3, name: 'c', price: 9, valuePerChip: 1 },
        { id: 4, name: 'd', price: 25, valuePerChip: 0.5 },
    ];
    const plan = planChips({ ranked, chips: 40 });
    assert.deepEqual(plan.buy.map((c) => c.name), ['a', 'b', 'c', 'd']);
    assert.equal(plan.left, 2);
    assert.equal(plan.saving, null);
});

test('saves for an unaffordable item that is far better than the rest', () => {
    const ranked = [
        { id: 1, name: 'cheap', price: 1, valuePerChip: 10 },
        { id: 2, name: 'prize', price: 100, valuePerChip: 5 },
        { id: 3, name: 'filler', price: 3, valuePerChip: 0.5 },
    ];
    const plan = planChips({ ranked, chips: 50 });
    assert.deepEqual(plan.buy.map((c) => c.name), ['cheap']);
    assert.equal(plan.saving.name, 'prize');
    assert.equal(plan.left, 49, 'the filler is not bought while saving');
});

test('skips an unaffordable item when what follows is nearly as good', () => {
    const ranked = [
        { id: 1, name: 'big', price: 100, valuePerChip: 2 },
        { id: 2, name: 'next', price: 5, valuePerChip: 1.5 },
    ];
    const plan = planChips({ ranked, chips: 50 });
    assert.deepEqual(plan.buy.map((c) => c.name), ['next']);
    assert.equal(plan.saving, null);
});

test('items with no value are never bought or saved for', () => {
    const ranked = [
        { id: 1, name: 'useless', price: 1, valuePerChip: 0 },
        { id: 2, name: 'pricey', price: 1e9, valuePerChip: 0 },
    ];
    const plan = planChips({ ranked, chips: 1e12 });
    assert.deepEqual(plan.buy, []);
    assert.equal(plan.saving, null);
});
