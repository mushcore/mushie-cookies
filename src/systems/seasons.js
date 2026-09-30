// Seasons and Santa: the one owner of Game.season.
//
// Every few seconds it measures what each season is worth for the rest of the run (reindeer in
// Christmas, and the drops still missing in each), asks the pure planner in src/core/seasons.js
// where to be, and sells the switch through the buyer, so a switch is ranked against every other
// purchase and paid only from above the reserve. Santa levels are sold the same way. Switching is
// a click on the season's biscuit in the store and levelling Santa a click on Evolve, as for a
// player; neither happens without the upgrades that show them.
import { simulateEach } from '../core/sim.js';
import { estimateIncome } from '../core/income.js';
import { readState, reindeerState } from '../game/measure.js';
import { planSeason, switchPrice, santaPrice, uniformWaits, eggWaits, collectionValue, heartVisit } from '../core/seasons.js';

const TICK_EVERY = 150; // frames: five seconds
const MEASURE_EVERY = 900; // frames: what-ifs are redone every 30 s, or when the season or Santa changes
const POP_WINDOW_SECONDS = 30 * 60; // the wrinkler pop rate is observed over this long
const MIN_HORIZON = 1800; // the ascension system never ends a run sooner (core/ascension.js:35)
const MAX_HORIZON = 86400; // a switched season lasts a day (main.js:12500)

/** Selebrak, the seasons god: switch price and drop rate factors by slot (main.js:5803-5810, 12436-12439). */
const SELEBRAK_PRICE = { 1: 2, 2: 1.5, 3: 1.25 };
const SELEBRAK_DROP = { 1: 0.9, 2: 0.95, 3: 0.97 };

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings  the mod's settings (autoSeasons, autoBuy, autoReindeer, autoGC, autoWrinkler)
 * @param {object} deps.loop
 * @param {object} [deps.buyer]   sells the switches and Santa levels; without it (or with Autobuy
 *        off) they are bought directly when the bank covers them
 * @param {(request: object|null) => void} [deps.hunt]  the wrinkler system's hunt request (see report)
 * @param {(what: string) => void} [deps.log]
 */
export function createSeasons({ game, settings, loop, buyer = null, hunt = null, log = () => {} }) {
    const state = {
        plan: null,
        values: null,
        gains: null,
        measuredAt: -Infinity,
        stamp: '',
        offers: [],
        season: game.season,
        enteredAt: 0,
        pops: [],
        hunting: null,
        switches: 0,
        levels: 0,
        last: null,
        frame: 0,
    };

    const now = () => Date.now() / 1000;
    const canSwitch = () => !!game.Has('Season switcher'); // 0 in Born again (main.js:9700)
    const trigger = (season) => game.seasons[season] && game.Upgrades[game.seasons[season].trigger];
    const inStore = (upgrade) => game.UpgradesInStore.indexOf(upgrade) !== -1;
    const god = () => (game.hasGod ? game.hasGod('seasons') : 0);
    const missing = (names) => names.filter((n) => !game.HasUnlocked(n) && !game.Has(n));
    const income = () => estimateIncome(readState(game, settings)).total;
    const reserve = () => (buyer && settings.autoBuy ? buyer.reserve() : 0);

    function horizon() {
        const run = (Date.now() - game.startDate) / 1000;
        return Math.min(MAX_HORIZON, Math.max(MIN_HORIZON, run));
    }

    // Wrinkler pops per second, as the wrinkler owner actually pops them: Halloween cookies and
    // some eggs drop only from pops (main.js:14485-14510).
    function popRate() {
        const t = now();
        const n = game.wrinklersPopped;
        if (state.pops.length && n < state.pops[state.pops.length - 1].n) state.pops = []; // a new run
        state.pops.push({ t, n });
        while (state.pops.length > 2 && t - state.pops[1].t > POP_WINDOW_SECONDS) state.pops.shift();
        const first = state.pops[0];
        return t - first.t > 60 ? (n - first.n) / (t - first.t) : 0;
    }

    // Drop chances per roll (main.js:5797-5808, 10430-10443, 14487-14500).
    function chances() {
        const rateMult = game.dropRateMult();
        const selebrak = SELEBRAK_DROP[god()] || 1;
        const reindeerFail = ((game.HasAchiev('Let it snow') ? 0.6 : 0.8) / rateMult) * (game.Has('Starsnow') ? 0.95 : 1) * selebrak;
        const spooky = (game.HasAchiev('Spooky cookies') ? 0.8 : 0.95) * (game.Has('Starterror') ? 0.9 : 1);
        const eggFail = (base) =>
            (base / rateMult) * (game.HasAchiev('Hide & seek champion') ? 0.7 : 1) * (game.Has('Omelette') ? 0.9 : 1) * (game.Has('Starspawn') ? 0.9 : 1) * selebrak;
        return {
            reindeer: Math.max(0, 1 - reindeerFail),
            halloween: Math.max(0, 1 - (spooky / rateMult) * selebrak),
            eggGolden: Math.max(0, 1 - eggFail(0.9)),
            eggPop: Math.max(0, 1 - eggFail(0.98)),
        };
    }

    // What each missing drop would add to income, from one what-if session. Santa's trials also
    // take Santa up a level, since each level brings one drop at random (main.js:14745-14760).
    function measureGains() {
        const base = income();
        const trials = [];
        const buy = (names) => () => {
            for (const n of names) {
                const u = game.Upgrades[n];
                if (!u.bought) {
                    u.bought = 1;
                    game.UpgradesOwned++;
                }
            }
        };
        const santaLeft = game.santaLevel < 14 ? game.santaDrops.filter((n) => !game.HasUnlocked(n)) : [];
        const dominion = game.santaLevel === 13 ? ["Santa's dominion"] : [];
        for (const n of santaLeft) {
            trials.push({ group: 'santa', apply: () => { buy([n].concat(dominion))(); game.santaLevel++; } });
        }
        const first = (names) => missing(names)[0];
        const cookie = first(game.reindeerDrops);
        if (cookie) trials.push({ group: 'christmas', apply: buy([cookie]) });
        const spooky = first(game.halloweenDrops);
        if (spooky) trials.push({ group: 'halloween', apply: buy([spooky]) });
        const heart = game.heartDrops.find((n) => !game.Has(n));
        if (heart) trials.push({ group: 'heart', apply: buy([heart]) });
        // The Chocolate egg is the ascension routine's (candidates.js NEVER_BUY): worth nothing here.
        for (const n of missing(game.easterEggs)) if (n !== 'Chocolate egg') trials.push({ group: 'egg', apply: buy([n]) });
        const measured = trials.length ? simulateEach(game, trials, income) : [];
        const sums = {};
        const counts = {};
        trials.forEach((t, i) => {
            sums[t.group] = (sums[t.group] || 0) + Math.max(0, measured[i] - base);
            counts[t.group] = (counts[t.group] || 0) + 1;
        });
        const mean = (g) => (counts[g] ? sums[g] / counts[g] : 0);
        const eggsLeft = missing(game.easterEggs).length;
        return {
            income: base,
            santaLevel: game.santaLevel,
            santa: mean('santa'),
            santaPriceExtra: dominion.length ? game.Upgrades["Santa's dominion"].getPrice() : 0,
            christmas: mean('christmas'),
            halloween: mean('halloween'),
            heart: mean('heart'),
            // Averaged over every missing egg, the Chocolate egg counting as nothing.
            egg: eggsLeft ? (sums.egg || 0) / eggsLeft : 0,
        };
    }

    function seasonValues(gains, H) {
        const c = chances();
        const pops = popRate();
        const s = readState(game, settings);
        const deer = reindeerState(game, settings, { season: 'christmas' });
        const standing = estimateIncome({ ...s, reindeer: deer }).total - estimateIncome({ ...s, reindeer: null }).total;
        const golden = settings.autoGC && Number.isFinite(s.golden.meanInterval) && s.golden.meanInterval > 0 ? 1 / s.golden.meanInterval : 0;

        const cookieWaits = uniformWaits({ missing: missing(game.reindeerDrops).length, total: 7, rate: deer ? 1 / deer.meanInterval : 0, chance: c.reindeer });
        let christmas = collectionValue({ waits: cookieWaits, gain: gains.christmas, horizon: H });
        let christmasNext = cookieWaits.length ? cookieWaits[0] : Infinity;
        const hat = game.Upgrades['A festive hat'];
        if (!hat.bought && !hat.unlocked) {
            // Being in Christmas unlocks the hat within a 5 s check (main.js:16451), and the hat
            // opens Santa: the levels that repay themselves within the horizon.
            for (let level = game.santaLevel; level < 14; level++) {
                const net = gains.santa * H - santaPrice(level);
                if (!(net > 0)) break;
                christmas += net;
            }
            christmasNext = 5;
        }
        const spookyWaits = uniformWaits({ missing: missing(game.halloweenDrops).length, total: 7, rate: pops, chance: c.halloween });
        const eggs = missing(game.easterEggs);
        const eggWait = eggWaits({
            rareMissing: eggs.filter((n) => game.rareEggDrops.indexOf(n) !== -1).length,
            commonMissing: eggs.filter((n) => game.eggDrops.indexOf(n) !== -1).length,
            rate: golden * c.eggGolden + pops * c.eggPop,
        });
        const zero = { standing: 0, collection: 0, nextDrop: Infinity };
        return {
            chances: c,
            pops,
            values: {
                christmas: { standing, collection: christmas, nextDrop: christmasNext },
                halloween: { standing: 0, collection: collectionValue({ waits: spookyWaits, gain: gains.halloween, horizon: H }), nextDrop: spookyWaits.length ? spookyWaits[0] : Infinity },
                easter: { standing: 0, collection: collectionValue({ waits: eggWait, gain: gains.egg, horizon: H }), nextDrop: eggWait.length ? eggWait[0] : Infinity },
                valentines: { ...zero },
                fools: zero,
                '': zero,
            },
        };
    }

    function heartsVisit(gains, H) {
        const hearts = game.heartDrops.map((n) => {
            const u = game.Upgrades[n];
            return { price: u.getPrice(), basePrice: u.basePrice, bought: !!u.bought, unlocked: !!u.unlocked };
        });
        return heartVisit({ hearts, earned: game.cookiesEarned, gain: gains.heart, horizon: H, budget: game.cookies - reserve(), income: gains.income });
    }

    function prices() {
        const p0 = trigger('christmas').getPrice();
        const at = (uses) => switchPrice({ unbuffedCps: game.unbuffedCps, uses, godMult: SELEBRAK_PRICE[god()] || 1 });
        // The store price carries the upgrade discounts (main.js:9409-9431); the next one scales alike.
        return [p0, (p0 * at(game.seasonUses + 1)) / at(game.seasonUses)];
    }

    // Until the wrinkler system takes over popping, the inherited popper pops every wrinkler in
    // Easter and Halloween (fc_main.js shouldPopWrinklers), which throws away most of their
    // return: the planner never goes there while wrinklers are feeding.
    function blocked() {
        return !hunt && Number(settings.autoWrinkler) === 1 && game.elderWrath > 0 ? ['easter', 'halloween'] : [];
    }

    // --- Acting, as a player clicks -------------------------------------------------------------
    function switchTo(season) {
        const it = trigger(season);
        if (!canSwitch() || !it || it.bought || !inStore(it) || game.season === season) return false;
        const price = it.getPrice();
        it.buy(); // the store click: the biscuit's own click check runs (main.js:12476-12493)
        if (game.season !== season) return false;
        state.switches++;
        state.last = `switched to ${game.seasons[season].name} for ${price.toExponential(2)}`;
        log(`seasons: ${state.last} (${state.plan ? state.plan.reason : ''})`);
        return true;
    }

    // Clicking the running season's biscuit ends it and brings back the calendar's season for
    // nothing (main.js:12476-12490).
    function cancel() {
        const running = game.season && trigger(game.season);
        if (!canSwitch() || !running || !running.bought || game.season === game.baseSeason) return false;
        running.buy();
        if (game.season !== game.baseSeason) return false;
        state.switches++;
        state.last = `cancelled the season, back to ${game.baseSeason ? game.seasons[game.baseSeason].name : 'none'}`;
        log(`seasons: ${state.last}`);
        return true;
    }

    // The Evolve button in Santa's tab, shown once A festive hat is owned (main.js:14698, 14994).
    function evolve(level) {
        if (!game.Has('A festive hat') || game.santaLevel !== level) return false;
        game.UpgradeSanta();
        if (game.santaLevel !== level + 1) return false;
        state.levels++;
        state.last = `Santa to level ${game.santaLevel} (${game.santaLevels[game.santaLevel]})`;
        log(`seasons: ${state.last}`);
        return true;
    }

    // --- Offers to the buyer ---------------------------------------------------------------------
    function makeOffers(gains, plan, H) {
        const offers = [];
        const level = game.santaLevel;
        if (game.Has('A festive hat') && level < 14 && gains.santaLevel === level && gains.santa > 0) {
            offers.push({
                key: `santa:${level}`,
                name: `Santa level ${level + 1}`,
                price: santaPrice(level) + gains.santaPriceExtra,
                deltaIncome: gains.santa,
                valid: () => game.santaLevel === level && game.Has('A festive hat'),
                buy: () => evolve(level),
            });
        }
        if (plan && plan.action === 'switch') {
            const from = game.season;
            const to = plan.to;
            offers.push({
                key: `season:${from}>${to}`,
                name: `${game.seasons[to].name} season`,
                price: plan.price,
                // Payback against the other purchases: the plan's gross worth, spread over the run.
                deltaIncome: (plan.gain + plan.price) / H,
                valid: () => game.season === from && canSwitch() && !trigger(to).bought,
                buy: () => switchTo(to),
            });
        }
        return offers;
    }

    const liveOffers = () => (settings.autoSeasons == 1 ? state.offers.filter((o) => o.valid()) : []);
    if (buyer) buyer.offer('seasons', liveOffers);

    // With the buyer off, nothing else spends: buy what the plan asks for when the bank covers it.
    function buyDirectly() {
        const hat = game.Upgrades['A festive hat'];
        if (inStore(hat) && !hat.bought && game.cookies >= hat.getPrice()) hat.buy(1);
        for (const offer of liveOffers()) if (game.cookies >= offer.price) offer.buy();
    }

    function tick(frame) {
        state.frame = frame;
        if (game.season !== state.season) {
            state.season = game.season;
            state.enteredAt = now();
        }
        const H = horizon();
        const stamp = [game.season, game.santaLevel, game.UpgradesOwned, game.resets].join('|');
        if (!state.gains || stamp !== state.stamp || frame - state.measuredAt >= MEASURE_EVERY) {
            state.gains = measureGains();
            state.measuredAt = frame;
            state.stamp = stamp;
        }
        const gains = state.gains;
        const { values, chances: c } = seasonValues(gains, H);
        const visit = heartsVisit(gains, H);
        values.valentines.nextDrop = visit.locked > 0 ? 0 : Infinity;
        const plan = planSeason({
            season: game.season,
            baseSeason: game.baseSeason,
            canSwitch: canSwitch(),
            prices: prices(),
            horizon: H,
            values,
            visit,
            blocked: blocked(),
            secondsInSeason: now() - state.enteredAt,
        });
        state.plan = plan;
        state.values = values;
        if (plan.action === 'cancel') cancel();
        const before = state.offers.map((o) => o.key).join();
        state.offers = makeOffers(gains, plan, H);
        if (buyer && state.offers.map((o) => o.key).join() !== before) buyer.invalidate();
        if (!buyer || !settings.autoBuy) buyDirectly();

        // Popping belongs to the wrinkler system: it is told what a drop is worth while a season
        // with drops from pops runs, and weighs that against what popping forfeits.
        if (hunt) {
            let request = null;
            const spookyLeft = missing(game.halloweenDrops).length;
            if (game.season === 'halloween' && spookyLeft > 0) {
                request = { season: 'halloween', chance: c.halloween, perDrop: gains.halloween * H * (spookyLeft / 7) };
            } else if (game.season === 'easter' && missing(game.easterEggs).length > 0) {
                request = { season: 'easter', chance: c.eggPop, perDrop: gains.egg * H };
            }
            state.hunting = request;
            hunt(request);
        }
    }

    loop.add('seasons', tick, { everyFrames: TICK_EVERY, enabled: () => settings.autoSeasons == 1 && !game.OnAscend && !game.AscendTimer });

    return {
        /** A plain summary for the console and the tests. */
        report() {
            const owned = (names) => names.filter((n) => game.Has(n)).length;
            return {
                season: game.season,
                plan: state.plan,
                values: state.values,
                offers: state.offers.map((o) => ({ name: o.name, price: o.price, deltaIncome: o.deltaIncome })),
                switches: state.switches,
                santaLevel: game.santaLevel,
                levels: state.levels,
                hunting: state.hunting,
                last: state.last,
                collected: {
                    santa: owned(game.santaDrops),
                    christmas: owned(game.reindeerDrops),
                    hearts: owned(game.heartDrops),
                    halloween: owned(game.halloweenDrops),
                    eggs: owned(game.easterEggs),
                    hat: game.Has('A festive hat'),
                    dominion: game.Has("Santa's dominion"),
                },
            };
        },
    };
}
