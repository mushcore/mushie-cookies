// Robustness in the running game: a failing system says so and is tried again on play time, the
// dragon's horizon ignores a machine sleep, and the ascension collects a golden lump while the
// buildings it pays on still stand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

test('a system that keeps failing is switched off with one notice, and tried again after a minute of play', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            window.__probe = { runs: 0, broken: true };
            MushieCookies.loop.add('probe', () => {
                window.__probe.runs++;
                if (window.__probe.broken) throw new Error('probe broke');
            });
        });
        const read = () =>
            game.eval(() => ({
                runs: window.__probe.runs,
                status: MushieCookies.status().probe,
                // Game.Notify with no `quick` leaves the note until it is closed (main.js:6164-6173, 6260-6269).
                notes: Game.Notes.filter((n) => /^Mushie Cookies: probe/.test(n.title)).map((n) => `${n.title} | ${n.desc}`),
            }));
        await game.advance(10);
        const off = await read();
        assert.equal(off.runs, 5, 'switched off after five failures in a row');
        assert.equal(off.status.disabled, true);
        assert.equal(off.notes.length, 1, 'the player is told once, in the game');
        assert.match(off.notes[0], /switched off/);
        assert.match(off.notes[0], /probe broke/);
        assert.match(off.notes[0], /1 minute/);

        await game.machineSleep(3600);
        await game.advanceSeconds(50);
        assert.equal((await read()).runs, 5, 'an hour asleep is no minute of play');
        await game.advanceSeconds(15);
        const tried = await read();
        assert.equal(tried.runs, 6, 'tried once after a minute of play');
        assert.equal(tried.status.disabled, true, 'failed again: off until the next try');
        assert.equal(tried.notes.length, 1, 'no notice for a failure already told');

        await game.eval(() => (window.__probe.broken = false));
        await game.advanceSeconds(5.5 * 60);
        const back = await read();
        assert.equal(back.status.disabled, false, 'the try after five minutes worked: on again');
        assert.ok(back.runs > 100, `running every frame again: ${back.runs}`);
        assert.equal(back.notes.length, 1);
        assert.deepEqual(game.errors.filter((e) => !/probe/.test(e)), [], 'only the probe failed');
    } finally {
        await game.close();
    }
});

test('the dragon\'s training horizon counts play, not a machine asleep', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            Game.shimmerTypes.golden.spawnConditions = () => false; // luck-free
            Game.Earn(1e30);
            for (let i = 0; i < 3; i++) Game.ObjectsById[i].buy(137);
            Game.Upgrades['A crumbly egg'].earn();
            Game.dragonLevel = 7; // fixture: a level whose price is 100 of a building
            Game.cookies = 0;
            Game.CalculateGains();
            Game.startDate = Date.now() - 2 * 3600 * 1000; // fixture: a run two hours old
        });
        await game.advanceSeconds(2);
        const horizon = () => game.eval(() => MushieCookies.dragon.plan().decision.horizon);
        const awake = await horizon();
        assert.ok(Math.abs(awake - 7202) < 10, `the premise: the run has lasted about two hours, ${awake} s`);
        await game.machineSleep(8 * 3600);
        await game.advanceSeconds(2);
        const woken = await horizon();
        // The game catches up at most 5 s after a stall (main.js:16788).
        assert.ok(Math.abs(woken - awake - 2) < 10, `a night asleep moved the horizon from ${awake} s to ${woken} s`);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});

test('the mod\'s own ascension collects a golden lump before it sells the buildings for the chocolate egg', { skip }, async () => {
    const game = await launchWithMod();
    try {
        await game.eval(() => {
            // Golden cookies on, as in play, so a golden lump at the cap waits for one; none can
            // spawn in the five minutes before the timer's shortest wait (main.js:5273, 5729-5732).
            Game.shimmerTypes.golden.time = 0;
            Game.Earn(1e14);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank']) Game.Objects[name].buy(60);
            Game.CalculateGains();
            Game.cookiesEarned = Game.HowManyCookiesReset(400); // fixture: a first ascension's worth
            Game.cookies = Game.unbuffedCps * 43200; // fixture: half the golden lump's cap, so it is held
            // The sale then refunds more than the rest of the cap: the lump is held on at the cap.
            Game.Unlock('Chocolate egg');
            // A ripe golden lump (fixture: the type the previous harvest rolled).
            Game.lumpsTotal = 5;
            Game.lumps = 5;
            Game.computeLumpTimes();
            Game.lumpCurrentType = 2;
            Game.lumpT = Date.now() - Game.lumpRipeAge;
            // Observation only: what stood when the lump was clicked and the egg bought.
            window.__events = [];
            const click = Game.clickLump;
            Game.clickLump = function () {
                const lumps = Game.lumps;
                const bank = Game.cookies;
                const cps = Game.cookiesPs;
                const out = click.apply(this, arguments);
                window.__events.push({ what: 'lump', gained: Game.lumps - lumps, buildings: Game.BuildingsOwned, cps, paid: Game.cookies - bank, due: Math.min(cps * 86400, bank) });
                return out;
            };
            const egg = Game.Upgrades['Chocolate egg'];
            const buy = egg.buy;
            egg.buy = function () {
                const out = buy.apply(this, arguments);
                window.__events.push({ what: 'egg', buildings: Game.BuildingsOwned });
                return out;
            };
            FrozenCookies.autoBuy = 0;
            FrozenCookies.autoSL = 1;
            FrozenCookies.autoAscendToggle = 1;
            FCStart();
        });
        await game.advanceSeconds(120);
        const out = await game.eval(() => ({ resets: Game.resets, events: window.__events, status: MushieCookies.status() }));
        assert.equal(out.resets, 1, 'the premise: the mod ascended and reincarnated');
        const lump = out.events.find((e) => e.what === 'lump');
        const egg = out.events.findIndex((e) => e.what === 'egg');
        assert.ok(lump, `the golden lump was collected: ${JSON.stringify(out.events)}`);
        assert.ok(lump.gained >= 2, `a golden lump yields 2 to 7: ${lump.gained}`);
        // The payout is min(CpS x 86400, bank) (main.js:4492-4496): after the sale CpS is 0 from
        // the next logic frame on (main.js:7879, 16274).
        assert.ok(lump.buildings > 0 && lump.cps > 0, `clicked with ${lump.buildings} buildings and ${lump.cps} CpS, paid ${lump.paid}`);
        assert.ok(lump.paid > 0 && lump.paid >= 0.99 * lump.due, `paid ${lump.paid} of ${lump.due}`);
        assert.ok(egg > out.events.indexOf(lump), `the egg comes last: ${JSON.stringify(out.events)}`);
        assert.equal(out.events[egg].buildings, 0, 'the buildings were sold for the egg');
        assert.deepEqual(Object.entries(out.status).filter(([, s]) => s.failures > 0), []);
        assert.deepEqual(game.errors, []);
    } finally {
        await game.close();
    }
});
