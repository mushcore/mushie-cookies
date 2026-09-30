import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';
import { BUFF_FIXTURES } from '../fixtures/buffs.mjs';

const skip = skipReason();

// One game for the file: the harness caps concurrent games machine-wide.
let game = null;
before(async () => {
    if (skip) return;
    game = await launchWithMod();
    await game.eval(setUp);
});
after(async () => {
    if (game) await game.close();
});

const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** A bakery with CpS and plain click power, and no upgrades that tie clicks to CpS. */
const setUp = () => {
    Game.Earn(1e12);
    Game.Objects['Cursor'].buy(20);
    Game.Objects['Grandma'].buy(20);
    Game.Objects['Farm'].buy(10);
    Game.killBuffs();
    Game.CalculateGains();
};

/**
 * Grants each buff type alone, as the game does, and reads the classifier on the object the game
 * made, beside the CpS and click power the game computes with it running.
 */
const grantEach = (fixtures) => {
    const results = [];
    for (const row of fixtures) {
        Game.killBuffs();
        Game.CalculateGains();
        const baseClick = Game.computedMouseCps;
        const buff = Game.gainBuff(row.type, row.args[0], row.args[1], row.args[2]);
        Game.CalculateGains();
        const c = MushieCookies.classifyBuff(buff, { fps: Game.fps });
        results.push({
            row,
            stored: Game.buffs[buff.name] === buff,
            name: buff.name,
            c,
            factors: MushieCookies.unbuffedFactors(Game.buffs),
            spikeRunning: MushieCookies.incomeSpikeRunning(Game.buffs, { fps: Game.fps }),
            worth: MushieCookies.worthFinishing(buff, 600, { fps: Game.fps }),
            cookiesPs: Game.cookiesPs,
            unbuffedCps: Game.unbuffedCps,
            baseClick,
            click: Game.computedMouseCps,
        });
    }
    Game.killBuffs();
    Game.CalculateGains();
    return {
        results,
        typesInGame: Game.buffTypes.map((t) => t.name),
        unknown: Game.buffTypes.map((t) => t.name).filter((name) => !MushieCookies.BUFF_TYPES[name]),
    };
};

/** Several buffs at once, as a combo stacks them. */
const stack = () => {
    Game.killBuffs();
    Game.CalculateGains();
    const baseClick = Game.computedMouseCps;
    Game.gainBuff('frenzy', 77, 7);
    Game.gainBuff('building buff', 30, 3, 1);
    Game.gainBuff('clot', 66, 0.5);
    Game.gainBuff('click frenzy', 13, 777);
    Game.gainBuff('devastation', 10, 1.2);
    Game.gainBuff('sugar blessing', 86400, 1);
    Game.gainBuff('loan 3', 172800, 1.2);
    Game.CalculateGains();
    const out = {
        kinds: MushieCookies.classifyBuffs(Game.buffs, { fps: Game.fps }).map((c) => [c.name, c.kind]),
        factors: MushieCookies.unbuffedFactors(Game.buffs),
        longest: MushieCookies.longestSpikeSecondsLeft(Game.buffs, { fps: Game.fps }),
        spikeWithin20: MushieCookies.incomeSpikeRunning(Game.buffs, { maxSeconds: 20, fps: Game.fps }),
        spikeWithin5: MushieCookies.incomeSpikeRunning(Game.buffs, { maxSeconds: 5, fps: Game.fps }),
        cookiesPs: Game.cookiesPs,
        unbuffedCps: Game.unbuffedCps,
        baseClick,
        click: Game.computedMouseCps,
    };
    Game.killBuffs();
    Game.CalculateGains();
    return out;
};

test('every buff type the game defines is classified on the object Game.gainBuff makes', { skip, timeout: 600000 }, async () => {
    const { results, typesInGame, unknown } = await game.eval(grantEach, BUFF_FIXTURES);
    assert.deepEqual(unknown, [], 'buff types the classifier table lacks');
    assert.deepEqual([...typesInGame].sort(), BUFF_FIXTURES.map((r) => r.type).sort(), 'the fixtures cover every type in the game');

    for (const r of results) {
        const { row, c } = r;
        const what = `${row.type} (${r.name})`;
        assert.equal(r.stored, true, `${what}: the game keeps the returned object`);
        assert.equal(r.name, row.name, what);
        assert.equal(c.type, row.type, what);
        assert.equal(c.known, true, what);
        assert.equal(c.kind, row.kind, what);
        assert.ok(close(c.secondsLeft, row.args[0]), `${what}: ${c.secondsLeft}s left, granted ${row.args[0]}s`);
        assert.equal(r.spikeRunning, row.kind === 'income spike', `${what}: incomeSpikeRunning`);

        // The factors are what the game multiplies by: CpS over unbuffed CpS, clicks over
        // the click power with no buff running.
        if (r.factors.cps > 0) assert.ok(close(r.cookiesPs, r.unbuffedCps * r.factors.cps), `${what}: CpS ${r.cookiesPs} vs ${r.unbuffedCps} x ${r.factors.cps}`);
        else assert.ok(r.cookiesPs === 0 && r.unbuffedCps > 0, `${what}: a zero factor stops CpS`);
        if (r.factors.fixedClick !== null) assert.equal(r.click, r.factors.fixedClick, `${what}: clicks pay the fixed amount`);
        else assert.ok(close(r.click, r.baseClick * r.factors.click), `${what}: click ${r.click} vs ${r.baseClick} x ${r.factors.click}`);
        assert.equal(r.factors.cps, c.cpsMult, what);
        assert.equal(r.factors.click, c.clickMult, what);

        // Granted fresh, only the short income buffs end within ten minutes.
        assert.equal(r.worth, row.kind === 'income spike', `${what}: worthFinishing within 10 min`);
    }
    const cursed = results.find((r) => r.row.type === 'cursed finger');
    assert.equal(cursed.click, cursed.row.args[1], 'a click under the Cursed finger pays its power');
});

test('stacked buffs: the factors match the game, and only spikes count as spikes', { skip, timeout: 600000 }, async () => {
    const out = await game.eval(stack);
    assert.deepEqual(Object.fromEntries(out.kinds), {
        Frenzy: 'income spike',
        Congregation: 'income spike',
        Clot: 'debuff',
        'Click frenzy': 'income spike',
        Devastation: 'income spike',
        'Sugar blessing': 'long boost',
        'Loan 3': 'long boost',
    });
    assert.ok(close(out.factors.cps, 7 * 3 * 0.5 * 1.2));
    assert.ok(close(out.factors.click, 777 * 1.2));
    assert.ok(close(out.cookiesPs, out.unbuffedCps * out.factors.cps), `CpS ${out.cookiesPs} vs ${out.unbuffedCps} x ${out.factors.cps}`);
    assert.ok(close(out.click, out.baseClick * out.factors.click), `click ${out.click} vs ${out.baseClick} x ${out.factors.click}`);
    assert.equal(out.longest, 77, 'the Frenzy ends last among the spikes; the loan and blessing are not spikes');
    assert.equal(out.spikeWithin20, true, 'Click frenzy and Devastation end within 20 s');
    assert.equal(out.spikeWithin5, false);
});
