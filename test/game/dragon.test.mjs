import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

/**
 * Test fixture: `count` of each of the first `upTo` buildings and the crumbly egg, with golden
 * cookies off so no luck enters. `prestige` with every heavenly multiplier upgrade makes income
 * large next to building prices, as late in a run; without it the buildings are years of income.
 */
function bakery({ count = 110, upTo = 14, prestige = 0, level = 0 }) {
    Game.shimmerTypes.golden.spawnConditions = () => false;
    Game.Earn(1e30);
    for (let i = 0; i < upTo; i++) Game.ObjectsById[i].buy(count);
    if (prestige) {
        for (const name of ['Heavenly chip secret', 'Heavenly cookie stand', 'Heavenly bakery', 'Heavenly confectionery', 'Heavenly key']) Game.Upgrades[name].earn();
        Game.prestige = prestige;
    }
    Game.Upgrades['A crumbly egg'].earn();
    Game.dragonLevel = level;
    Game.cookies = 0;
    Game.CalculateGains();
    return Game.ObjectsById.map((b) => b.amount);
}

/** Switches the dragon options on the way a player does: the setting, then the inherited restart. */
function dragonOn(settings) {
    Object.assign(FrozenCookies, settings);
    FCStart();
}

test('trains a whole chain to Radiant Appetite once it repays, one level after another, and signals each level', { skip }, async () => {
    const game = await launchWithMod();
    try {
        const before = await game.eval(bakery, { prestige: 1e11, level: 5 });
        await game.eval(() => {
            window.__levels = [];
            MushieCookies.dragon.onLevelGained((level) => window.__levels.push(level));
        });
        await game.eval(dragonOn, { autoDragon: 1 });
        await game.advanceSeconds(40);
        const out = await game.eval(() => ({
            level: Game.dragonLevel,
            amounts: Game.ObjectsById.map((b) => b.amount),
            gained: MushieCookies.dragon.levelsGained(),
            heard: window.__levels,
            tab: Game.specialTab,
            prompt: !!Game.promptOn,
        }));
        assert.equal(out.level, 19, 'levels 5 to 18 trained: Radiant Appetite learned');
        // Each level from 5 took 100 of building level - 5: Cursor through Prism.
        for (let i = 0; i < 14; i++) assert.equal(out.amounts[i], before[i] - 100, `building ${i}`);
        assert.equal(out.gained, 14);
        assert.deepEqual(out.heard, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
        assert.equal(out.tab, '', 'the dragon menu is closed again, as the player found it');
        assert.equal(out.prompt, false);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('a chain that becomes trainable is trained at once, not at the next scheduled look', { skip }, async () => {
    const game = await launchWithMod();
    try {
        // One Prism short of the hundred that Radiant Appetite takes. The auras within reach
        // (levels 13 to 18) pay through golden cookies, which are off: nothing is worth training.
        await game.eval(bakery, { prestige: 1e11, level: 12 });
        await game.eval(() => {
            Game.Objects['Prism'].sacrifice(11);
        });
        await game.eval(dragonOn, { autoDragon: 1 });
        await game.advanceSeconds(5);
        const before = await game.eval(() => ({ level: Game.dragonLevel, decision: MushieCookies.dragon.report().decision }));
        assert.equal(before.level, 12);
        assert.equal(before.decision.train, false);
        await game.eval(() => {
            Game.cookies = 1e30;
            Game.Objects['Prism'].buy(1);
        });
        await game.advanceSeconds(20);
        assert.equal(await game.eval(() => Game.dragonLevel), 19);
    } finally {
        await game.close();
    }
});

test('a chain that would not repay within the run is not trained; the inherited rule would train it', { skip }, async () => {
    const game = await launchWithMod();
    try {
        // Without the prestige, a hundred Prisms are years of income and Radiant Appetite doubles
        // too little to repay them in the hour the run is expected to go on.
        const before = await game.eval(bakery, { level: 5 });
        await game.eval(dragonOn, { autoDragon: 1 });
        await game.advanceSeconds(60);
        const held = await game.eval(() => ({ level: Game.dragonLevel, amounts: Game.ObjectsById.map((b) => b.amount) }));
        assert.equal(held.level, 5, `trained to ${held.level}`);
        assert.deepEqual(held.amounts, before, 'nothing sacrificed');
        const decision = await game.eval(() => MushieCookies.dragon.report().decision);
        assert.equal(decision.train, false);
        assert.ok(decision.payback > 3600, `pays back in ${decision.payback} s`);

        // The inherited rule, kept for comparison: train whatever is affordable.
        await game.eval(() => {
            MushieCookies.dragon.options.rule = 'eager';
        });
        await game.advanceSeconds(30);
        assert.equal(await game.eval(() => Game.dragonLevel), 19);
    } finally {
        await game.close();
    }
});

test('egg levels spend only what the buyer is not holding', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(bakery, { prestige: 1e11, level: 0 });
        await game.eval(() => {
            // The buyer holds all but 5 million: the egg's 1 and 2 million fit, its 4 million does
            // not, and nothing before level 5 teaches an aura.
            MushieCookies.buyer.reserve = () => Math.max(0, Game.cookies - 5e6);
        });
        await game.eval(dragonOn, { autoDragon: 1 });
        await game.advanceSeconds(40);
        assert.equal(await game.eval(() => Game.dragonLevel), 0, 'no cookie spent on a chain the reserve cuts short');
        await game.eval(() => {
            MushieCookies.buyer.reserve = () => 0;
        });
        await game.advanceSeconds(60);
        assert.equal(await game.eval(() => Game.dragonLevel), 19);
    } finally {
        await game.close();
    }
});

test('the Wizard tower level waits until the grimoire holds no more mana than the sacrifice leaves', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(bakery, { prestige: 1e11, level: 12 });
        await game.eval(() => {
            Game.Objects['Wizard tower'].level = 1;
            Game.LoadMinigames();
        });
        await game.waitFor(() => !!(Game.Objects['Wizard tower'].minigame && Game.Objects['Wizard tower'].minigame.spells));
        const cap = await game.eval(() => {
            const M = Game.Objects['Wizard tower'].minigame;
            // The mod casts (autoFate), but nothing lands in this test: the mana is what the test sets.
            M.castSpell = () => false;
            M.magic = M.magicM;
            return { full: M.magicM };
        });
        await game.eval(dragonOn, { autoDragon: 1, autoFate: 1 });
        await game.advanceSeconds(60);
        const held = await game.eval(() => ({ level: Game.dragonLevel, towers: Game.Objects['Wizard tower'].amount, magic: Game.Objects['Wizard tower'].minigame.magic }));
        assert.equal(held.level, 12, 'a full grimoire is not clamped from ' + cap.full + ' to 15');
        assert.equal(held.towers, 110);
        assert.ok(held.magic >= cap.full - 1e-9);

        // As after a cast: 10 mana, under the 15 that 10 towers hold.
        await game.eval(() => {
            Game.Objects['Wizard tower'].minigame.magic = 10;
        });
        await game.advanceSeconds(40);
        const after = await game.eval(() => ({ level: Game.dragonLevel, towers: Game.Objects['Wizard tower'].amount, magic: Game.Objects['Wizard tower'].minigame.magic }));
        assert.equal(after.level, 19);
        assert.equal(after.towers, 10);
        assert.ok(after.magic >= 10, 'no mana lost to the clamp');
    } finally {
        await game.close();
    }
});

test('the rebuy cost of a level is what the game would charge to buy the units back', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(bakery, { count: 137, upTo: 3, level: 7 });
        const out = await game.eval(() => {
            const farm = Game.Objects['Farm'];
            const plan = MushieCookies.dragon.plan();
            // Test only: the price after a real sacrifice, from the game's own getSumPrice.
            farm.amount -= 100;
            const game = farm.getSumPrice(100);
            farm.amount += 100;
            return { planned: plan.steps[0], game };
        });
        assert.equal(out.planned.level, 7);
        assert.ok(Math.abs(out.planned.cost - out.game) <= 1e-9 * out.game, `${out.planned.cost} against ${out.game}`);
    } finally {
        await game.close();
    }
});

test('pets only at level 8 or more, only for a drop not had, without reseeding the game\'s generator', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(bakery, { count: 1, upTo: 1, level: 7 });
        await game.eval(() => {
            Game.Upgrades['Pet the dragon'].earn();
            window.__pet = { clicks: 0, inside: false, strayReseeds: 0, drops: [] };
            const click = Game.ClickSpecialPic;
            Game.ClickSpecialPic = function () {
                const before = ['Dragon scale', 'Dragon claw', 'Dragon fang', 'Dragon teddy bear'].filter((d) => Game.HasUnlocked(d));
                window.__pet.clicks++;
                window.__pet.inside = true;
                try {
                    return click.apply(this, arguments);
                } finally {
                    window.__pet.inside = false;
                    const after = ['Dragon scale', 'Dragon claw', 'Dragon fang', 'Dragon teddy bear'].filter((d) => Game.HasUnlocked(d));
                    for (const d of after) if (!before.includes(d)) window.__pet.drops.push({ drop: d, minutes: new Date().getMinutes() });
                }
            };
            // The game reseeds itself inside a petting click (main.js:14959, 14968) and elsewhere
            // (the lump type, main.js:4538); the mod's own code never may. The mod is the bundle
            // served from /__mods/ and the legacy script evaluated as mushie-cookies-legacy.js.
            window.__pet.stray = [];
            const seed = Math.seedrandom;
            Math.seedrandom = function (s) {
                const stack = new Error().stack || '';
                const fromMod = stack.includes('/__mods/') || stack.includes('mushie-cookies-legacy');
                if (s === undefined && fromMod && !window.__pet.inside) window.__pet.stray.push(stack.split('\n').slice(1, 6).join(' | '));
                return seed.apply(this, arguments);
            };
        });
        await game.eval(dragonOn, { petDragon: 1 });
        await game.advanceSeconds(30);
        assert.equal(await game.eval(() => window.__pet.clicks), 0, 'no drops below level 8, so no petting');

        await game.eval(() => {
            Game.dragonLevel = 8;
        });
        // A drop is a 1 in 20 chance per pet; wait for the first, then check it.
        for (let i = 0; i < 24 && !(await game.eval(() => window.__pet.drops.length)); i++) await game.advanceSeconds(10);
        const first = await game.eval(() => window.__pet);
        assert.deepEqual(first.stray, [], 'the mod reseeded the game\'s generator');
        assert.equal(first.drops.length, 1, `${first.clicks} pets`);
        const forecast = await game.eval((m) => MushieCookies.dragon.forecast(m), first.drops[0].minutes);
        assert.equal(first.drops[0].drop, forecast, 'the private forecast names the drop the game gave');

        // The same window's drop is now had: no more petting until the quarter hour turns.
        const clicks = first.clicks;
        const minutes = await game.eval(() => new Date().getMinutes());
        const toNextQuarter = (15 - (minutes % 15)) * 60 - (await game.eval(() => new Date().getSeconds()));
        if (toNextQuarter > 20) {
            await game.advanceSeconds(toNextQuarter - 10);
            assert.equal(await game.eval(() => window.__pet.clicks), clicks, 'petted for a drop already had');
        }
        await game.advanceSeconds(30);
        const next = await game.eval(() => window.__pet);
        assert.ok(next.clicks > clicks, 'petting resumes in the next window, whose drop is another');
        assert.deepEqual(next.stray, []);

        // The forecast matches the game's own shuffle for this seed (test only: the generator is restored).
        const check = await game.eval(() => {
            const live = Math.random;
            Math.seedrandom(Game.seed + '/dragonTime');
            const order = shuffle(['Dragon scale', 'Dragon claw', 'Dragon fang', 'Dragon teddy bear']);
            Math.random = live;
            return { order, mine: [0, 15, 30, 45].map((m) => MushieCookies.dragon.forecast(m)) };
        });
        assert.deepEqual(check.mine, check.order);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('the inherited orbs seller stops for good once it switches itself off', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.Earn(1e40);
            for (const b of Game.ObjectsById) b.buy(5);
            Game.Objects['Temple'].level = 1;
            Game.LoadMinigames();
        });
        await game.waitFor(() => !!(Game.Objects['Temple'].minigame && Game.Objects['Temple'].minigame.godsById));
        await game.eval(() => {
            window.T = Game.Objects['Temple'].minigame;
            Game.shimmerTypes.golden.spawnConditions = () => false;
            Game.dragonLevel = 27;
            FrozenCookies.autoDragonOrbs = 1;
            FCStart();
        });
        // Dragon Orbs is not equipped, so the seller switches itself off.
        await game.advanceSeconds(5);
        assert.equal(await game.eval(() => FrozenCookies.autoDragonOrbs), 0);
        // Equipping the aura afterwards must not start it selling again.
        const yous = await game.eval(() => {
            Game.dragonAura = 19; // Dragon Orbs
            return Game.Objects['You'].amount;
        });
        await game.advanceSeconds(10);
        assert.equal(await game.eval(() => Game.Objects['You'].amount), yous);
    } finally {
        await game.close();
    }
});
