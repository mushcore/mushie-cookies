import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('spends lumps on the minigames first, then Farm 9, and unlocks the minigames', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e12);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(10);
            Game.lumpsTotal = 20; // past the first-unlock reset, which zeroes the jar
            Game.lumps = 20;
            Game.prefs.askLumps = 1; // the player's own "confirm before spending lumps" setting
            FrozenCookies.autoLumps = 1;
        });
        await game.advanceSeconds(30);
        const out = await game.eval(() => ({
            levels: Object.fromEntries(['Wizard tower', 'Temple', 'Farm', 'Bank', 'Cursor'].map((n) => [n, Game.Objects[n].level])),
            lumps: Game.lumps,
            ask: Game.prefs.askLumps,
            prompt: Game.promptOn,
        }));
        // 4 lumps unlock the minigames, then Farm 2..5 costs 2+3+4+5 = 14: 18 spent, 2 left, Farm 6 needs 6.
        assert.deepEqual(out.levels, { 'Wizard tower': 1, Temple: 1, Farm: 5, Bank: 1, Cursor: 0 });
        assert.equal(out.lumps, 2);
        assert.equal(out.ask, 1, 'the player\'s setting is restored');
        assert.ok(!out.prompt, 'no confirmation prompt is left open');
        await game.waitFor(() => !!Game.Objects['Farm'].minigame);
        await game.waitFor(() => !!Game.Objects['Wizard tower'].minigame);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('with Sugar baking owned, a hundred lumps stay in the jar', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const out = await game.eval(() => {
            Game.Earn(1e12);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(10);
            for (const name of ['Wizard tower', 'Temple', 'Bank']) Game.Objects[name].level = 1;
            Game.Objects['Farm'].level = 9;
            Game.Objects['Cursor'].level = 12;
            Game.Upgrades['Sugar baking'].earn();
            Game.lumpsTotal = 103;
            Game.lumps = 103;
            FrozenCookies.autoLumps = 1;
            return null;
        });
        await game.advanceSeconds(30);
        const lumps = await game.eval(() => Game.lumps);
        assert.ok(lumps >= 100 && lumps < 103, `${lumps} lumps left`);
    } finally {
        await game.close();
    }
});

test('with Sugar baking owned, the Farm and Cursor targets wait for lumps above the hundred', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e12);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Bank', 'Temple', 'Wizard tower']) Game.Objects[name].buy(10);
            for (const name of ['Wizard tower', 'Temple', 'Farm', 'Bank']) Game.Objects[name].level = 1;
            Game.Upgrades['Sugar baking'].earn();
            Game.lumpsTotal = 100;
            Game.lumps = 100;
            FrozenCookies.autoLumps = 1;
        });
        await game.advanceSeconds(30);
        const out = await game.eval(() => ({ lumps: Game.lumps, farm: Game.Objects.Farm.level, cursor: Game.Objects.Cursor.level }));
        assert.deepEqual(out, { lumps: 100, farm: 1, cursor: 0 });
    } finally {
        await game.close();
    }
});

/** A lump system fixture: sugar lumps unlocked and the lump `ripeIn` seconds from ripe. */
const lumpFixture = ({ lumps = 5, type = 0, ripeIn = 0 } = {}) =>
    game =>
        game.eval(
            ({ lumps, type, ripeIn }) => {
                Game.lumpsTotal = lumps;
                Game.lumps = lumps;
                Game.computeLumpTimes();
                Game.lumpCurrentType = type; // fixture: the type the previous harvest rolled
                Game.lumpT = Date.now() - Game.lumpRipeAge + ripeIn * 1000;
            },
            { lumps, type, ripeIn }
        );

test('the lump system harvests a ripe lump, and not a mature one', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e10);
            FrozenCookies.autoSL = 1;
        });
        await lumpFixture({ lumps: 5, ripeIn: 3 })(game);
        await game.advanceSeconds(2);
        assert.equal(await game.eval(() => Game.lumps), 5, 'a mature click pays nothing half the time');
        await game.advanceSeconds(3);
        const out = await game.eval(() => ({ lumps: Game.lumps, harvests: MushieCookies.lumps.report().harvests, age: Date.now() - Game.lumpT }));
        assert.equal(out.lumps, 6);
        assert.equal(out.harvests, 1, 'harvested by the lump system');
        assert.ok(out.age < 5000, 'the next lump started at the harvest');
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('in Born again, where the game hides the lump and the level buttons, nothing is clicked or spent', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e10);
            Game.Objects['Wizard tower'].buy(10);
            Game.ascensionMode = 1; // fixture: a Born again run
            FrozenCookies.autoSL = 1;
            FrozenCookies.autoLumps = 1;
        });
        await lumpFixture({ lumps: 20, ripeIn: -5 })(game);
        await game.advanceSeconds(10);
        const out = await game.eval(() => ({ lumps: Game.lumps, tower: Game.Objects['Wizard tower'].level }));
        assert.deepEqual(out, { lumps: 20, tower: 0 });
    } finally {
        await game.close();
    }
});

test('a golden lump is held while the bank grows and harvested a minute before it would fall', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const start = await game.eval(() => {
            Game.Earn(3e9);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory']) Game.Objects[name].buy(40);
            Game.CalculateGains();
            Game.cookies = Game.unbuffedCps * 600; // fixture: ten minutes of CpS in the bank
            Game.shimmerTypes.golden.spawnConditions = () => false; // luck-free: no CpS buff to wait for
            FrozenCookies.autoSL = 1;
            return { bank: Game.cookies, cap: Game.unbuffedCps * 86400 };
        });
        assert.ok(start.bank < start.cap / 10, `fixture: the bank (${start.bank}) is well under the cap (${start.cap})`);
        await lumpFixture({ lumps: 5, type: 2 })(game);
        await game.advanceSeconds(30 * 60);
        const held = await game.eval(() => ({ lumps: Game.lumps, hold: MushieCookies.lumps.report().hold, cap: Game.unbuffedCps * 86400 }));
        assert.equal(held.lumps, 5, 'still held half an hour into its ripe hour');
        assert.equal(held.hold, held.cap, 'the buyer is asked to keep the bank up to the cap');
        const before = await game.eval(() => Game.cookies);
        await game.advanceSeconds(30 * 60);
        const out = await game.eval(() => ({ lumps: Game.lumps, bank: Game.cookies, last: MushieCookies.lumps.report().lastHarvest, hold: MushieCookies.lumps.report().hold }));
        assert.ok(out.lumps >= 7, `a golden lump yields 2 to 7: ${out.lumps}`);
        assert.ok(/last safe/.test(out.last.reason), out.last.reason);
        assert.ok(out.last.secondsRipe >= 3600 - 61 && out.last.secondsRipe < 3600, `harvested ${out.last.secondsRipe} s into its ripe hour`);
        assert.ok(out.bank > 2 * before, 'the payout doubled a bank that grew for the hour');
        assert.equal(out.hold, 0, 'the buyer is released');
    } finally {
        await game.close();
    }
});

/** A bakery that owns Sugar craving, so Sugar frenzy is on offer. */
const frenzyFixture = (game) =>
    game.eval(() => {
        Game.Earn(1e12);
        for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory']) Game.Objects[name].buy(40);
        // Levels a long-running save has: a level-0 building making most of the CpS would be worth
        // more than the frenzy (0.8% of CpS for good for one lump).
        for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory']) Game.Objects[name].level = 20;
        for (const name of ['Stevia Caelestis', 'Sugar baking', 'Sugar craving']) Game.Upgrades[name].earn();
        Game.shimmerTypes.golden.spawnConditions = () => false; // luck-free
        Game.lumpsTotal = 150;
        Game.lumps = 150;
        Game.prefs.askLumps = 1; // the player's own "confirm before spending lumps" setting
        FrozenCookies.sugarFrenzy = 1;
    });
const frenzyState = (game) =>
    game.eval(() => ({
        bought: Game.Upgrades['Sugar frenzy'].bought,
        buff: !!Game.hasBuff('Sugar frenzy'),
        lumps: Game.lumps,
        ask: Game.prefs.askLumps,
        prompt: !!Game.promptOn,
    }));

test('with nothing ending the run, Sugar frenzy is switched on stacked on a Frenzy, once, for one lump', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await frenzyFixture(game);
        await game.advanceSeconds(5);
        assert.equal(await game.eval(() => Game.Upgrades['Sugar frenzy'].unlocked), 1, 'fixture: the game offers Sugar frenzy');
        assert.equal((await frenzyState(game)).bought, 0, 'no buff to stack on yet');
        await game.eval(() => Game.gainBuff('frenzy', 77, 7)); // fixture: a golden cookie's Frenzy
        await game.advanceSeconds(2);
        assert.deepEqual(await frenzyState(game), { bought: 1, buff: true, lumps: 149, ask: 1, prompt: false });
        await game.advanceSeconds(3600);
        await game.eval(() => Game.gainBuff('frenzy', 77, 7));
        await game.advanceSeconds(2);
        assert.equal((await frenzyState(game)).lumps, 149, 'once per ascension');
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('with the ascension on, Sugar frenzy waits until the run\'s growth nears its average', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await frenzyFixture(game);
        await game.eval(() => {
            FrozenCookies.autoAscendToggle = 1;
            // Test seam: the ascension's growth verdict, as its rate rule would compute it.
            MushieCookies.ascension.verdict = () => ({ ascend: false, instantRate: 3e-6, averageRate: 1e-6, rated: true });
        });
        await game.advanceSeconds(5);
        assert.equal((await frenzyState(game)).bought, 0, 'the run is still growing at three times its average');
        await game.eval(() => {
            MushieCookies.ascension.verdict = () => ({ ascend: false, instantRate: 1.05e-6, averageRate: 1e-6, rated: true });
        });
        await game.advanceSeconds(2);
        const out = await frenzyState(game);
        assert.equal(out.bought, 1);
        assert.equal(out.buff, true);
    } finally {
        await game.close();
    }
});

test('with the setting off, no lump is spent', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e12);
            Game.Objects['Wizard tower'].buy(10);
            Game.lumpsTotal = 20; // past the first-unlock reset, which zeroes the jar
            Game.lumps = 20;
            FrozenCookies.autoLumps = 0;
        });
        await game.advanceSeconds(30);
        assert.equal(await game.eval(() => Game.lumps), 20);
    } finally {
        await game.close();
    }
});
