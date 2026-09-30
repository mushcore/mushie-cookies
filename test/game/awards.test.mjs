import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWithMod, skipReason } from '../harness/game.mjs';

const skip = skipReason();

// A what-if of a purchase against the purchase itself: the game buys, then its five-second check
// (main.js:16315) awards what the purchase earned. Both must agree on the achievements and CpS.
async function withGame(setup, run) {
    const game = await launchWithMod();
    try {
        await game.eval(setup);
        await game.eval(winTimeAchievements);
        await game.eval(() => {
            const wonNow = () => new Set(Object.values(Game.AchievementsById).filter((a) => a.won).map((a) => a.name));
            const since = (before) => [...wonNow()].filter((name) => !before.has(name)).sort();
            window.__awards = {
                whatIf(key) {
                    const policy = { excludedBuildings: new Set(), excludedUpgrades: new Set(), chainReach: 0 };
                    const candidate = MushieCookies.listCandidates(Game, policy).find((c) => c.key === key);
                    if (!candidate) return null;
                    const before = wonNow();
                    const [out] = MushieCookies.simulateEach(Game, [candidate], () => ({ cps: Game.cookiesPs, wins: since(before), owned: Game.AchievementsOwned }));
                    return out;
                },
                buy(key) {
                    this.before = wonNow();
                    const [kind, id] = key.split(':');
                    if (kind === 'building') Game.Objects[id].buy(1);
                    else Game.UpgradesById[id].buy();
                },
                after() {
                    Game.CalculateGains();
                    return { cps: Game.cookiesPs, wins: since(this.before), owned: Game.AchievementsOwned };
                },
            };
        });
        const settle = async () => {
            // Past the next five-second check, whatever frame this is.
            const frames = await game.eval(() => 150 - (Game.T % 150) + 1);
            await game.advance(frames);
            await game.eval(() => Game.CalculateGains());
        };
        const compare = async (key) => {
            await settle();
            const whatIf = await game.eval((k) => window.__awards.whatIf(k), key);
            assert.ok(whatIf, `${key} is not a candidate`);
            await game.eval((k) => window.__awards.buy(k), key);
            await settle();
            const real = await game.eval(() => window.__awards.after());
            return { whatIf, real };
        };
        return await run(game, compare);
    } finally {
        await game.close();
    }
}

// Won up front, so only what the purchase earns can differ between the two:
// - production totals (main.js:16504) and the milk dunk (16512) come with time, and can land
//   between the purchase and the check;
// - CpS achievements are won inside the recalculation both sides run (main.js:5101), but their
//   milk reaches CpS only on the game's next recalculation, which a one-pass what-if does not
//   make (src/core/sim.js).
function winTimeAchievements() {
    for (const building of Game.ObjectsById) for (const it of Object.values(building.productionAchievs || {})) Game.Win(it.achiev.name);
    for (const it of Game.CpsAchievements) Game.Win(it.name);
    Game.Win('Cookie-dunker');
}

function assertSame({ whatIf, real }, expect, what) {
    for (const name of expect) assert.ok(real.wins.includes(name), `${what}: the game did not award ${name} (${real.wins})`);
    assert.deepEqual(whatIf.wins, real.wins, `${what}: the what-if won ${whatIf.wins}, the game ${real.wins}`);
    assert.equal(whatIf.owned, real.owned, `${what}: achievements owned`);
    assert.ok(Math.abs(whatIf.cps - real.cps) <= 1e-9 * real.cps, `${what}: CpS ${whatIf.cps} in the what-if, ${real.cps} bought`);
}

test('a building what-if earns what buying it earns: one of everything, Centennial, the cursor count', { skip }, () =>
    withGame(
        () => {
            Game.Earn(1e40);
            Game.Upgrades['Kitten helpers'].earn(); // milk only pays through kittens
            const counts = { Cursor: 199, Grandma: 99, You: 0 };
            for (const b of Game.ObjectsById) {
                const n = b.name in counts ? counts[b.name] : 100;
                if (n) b.buy(n); // buy(0) buys the bulk amount (main.js:7832)
            }
        },
        async (game, compare) => {
            assertSame(await compare('building:You'), ['One with everything'], 'the first You');
            await game.eval(() => Game.Objects['You'].buy(99));
            assertSame(await compare('building:Grandma'), ['Centennial'], 'the hundredth grandma');
            assertSame(await compare('building:Cursor'), ['The Digital'], 'the two hundredth cursor');
        }
    ));

test('an upgrade what-if earns what buying it earns: Jellicles and Elder', { skip }, () =>
    withGame(
        () => {
            Game.Earn(1e40);
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower', 'Shipment']) Game.Objects[name].buy(20);
            const kittens = Game.UpgradesByPool['kitten'];
            for (let i = 0; i < 9; i++) kittens[i].earn();
            Game.Unlock(kittens[9].name);
            const types = Game.GrandmaSynergies.map((name) => Game.Upgrades[name]);
            for (let i = 0; i < 6; i++) types[i].earn();
            Game.Unlock(types[6].name);
            Game.RebuildUpgrades();
            window.__ids = { kitten: kittens[9].id, grandma: types[6].id };
        },
        async (game, compare) => {
            const ids = await game.eval(() => window.__ids);
            assertSame(await compare(`upgrade:${ids.kitten}`), ['Jellicles'], 'the tenth kitten');
            assertSame(await compare(`upgrade:${ids.grandma}`), ['Elder'], 'the seventh grandma type');
        }
    ));

test('an achievement the next check awards anyway is credited to no candidate', { skip }, () =>
    withGame(
        () => {
            Game.Earn(1e12);
            Game.Upgrades['Kitten helpers'].earn();
            for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine']) Game.Objects[name].buy(30);
            Game.Unlock('Kitten workers');
            Game.RebuildUpgrades();
        },
        async (game) => {
            // No check has run since the setup: Builder (100 buildings) is due whatever is bought.
            const out = await game.eval(() => ({
                due: !Game.Achievements['Builder'].won && Game.ObjectsById.reduce((s, b) => s + b.amount, 0) >= 100,
                farm: window.__awards.whatIf('building:Farm'),
                kitten: window.__awards.whatIf(`upgrade:${Game.Upgrades['Kitten workers'].id}`),
            }));
            assert.ok(out.due, 'the setup leaves Builder due');
            assert.ok(!out.farm.wins.includes('Builder'), `a farm was credited with ${out.farm.wins}`);
            assert.ok(out.kitten, 'Kitten workers is in the store');
            assert.ok(!out.kitten.wins.includes('Builder'), `an upgrade was credited with ${out.kitten.wins}`);
        }
    ));
