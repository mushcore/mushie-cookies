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
import { wrinklerModel } from '../game/wrinklers.js';
import { planSeason, switchPrice, santaPrice, uniformWaits, eggWaits, collectionValue, collectionSeconds, heartVisit } from '../core/seasons.js';

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
 *        off) they are bought directly when the bank covers them above the buyer's reserve
 * @param {{hunt(request: object|null): void, valueHunt(request: object): object}} [deps.wrinklers]
 *        the wrinkler system: told to hunt Halloween cookies or eggs by popping, at
 *        `{season, value}` with `value` the cookies a new drop is worth, and asked what such a
 *        hunt would bring and cost a second
 * @param {(what: string) => void} [deps.log]
 */
export function createSeasons({ game, settings, loop, buyer = null, wrinklers = null, log = () => {} }) {
    // hunt: false plans as if no wrinkler were ever popped for drops (for comparison only).
    const options = { hunt: true };
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
    // A drop is kept for the rest of the run, so it is valued on the income the run keeps, not on
    // what the running season or a hunt makes of it for a while: reindeer as where the run rests
    // (Christmas, once a switcher can take it there), and wrinklers as kept when no hunt is on.
    // Valued on the income of the moment, a Halloween cookie was worth the reindeer's share more
    // from Christmas than from Halloween, and the planner switched in and straight back out.
    const income = () =>
        estimateIncome({
            ...readState(game, settings),
            reindeer: reindeerState(game, settings, { season: canSwitch() ? 'christmas' : game.season }),
            wrinklers: wrinklerModel(game, settings, { hunting: false }),
        }).total;
    // One bank: with Autobuy on or off, only what the buyer is not holding is spent.
    const reserve = () => (buyer ? buyer.reserve() : 0);
    const spendable = () => game.cookies - reserve();

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
        // The baseline is measured in the same session as the trials: right after a purchase the
        // game's CpS is stale until its next recalculation, and a baseline read outside would
        // credit every trial with that purchase.
        const trials = [{ group: 'base', apply() {} }];
        const buy = (names) => () => {
            for (const n of names) {
                const u = game.Upgrades[n];
                if (!u.bought) {
                    u.bought = 1;
                    game.UpgradesOwned++;
                }
            }
        };
        // A level with no drop left to bring still adds Santa's legacy (main.js:5015), and the
        // last one opens Santa's dominion (main.js:14748-14752).
        const santaLeft = game.santaLevel < 14 ? game.santaDrops.filter((n) => !game.HasUnlocked(n)) : [];
        const dominion = game.santaLevel === 13 ? ["Santa's dominion"] : [];
        const santaTrials = santaLeft.length ? santaLeft.map((n) => [n]) : game.santaLevel < 14 ? [[]] : [];
        for (const names of santaTrials) {
            trials.push({ group: 'santa', apply: () => { buy(names.concat(dominion))(); game.santaLevel++; } });
        }
        const first = (names) => missing(names)[0];
        const cookie = first(game.reindeerDrops);
        if (cookie) trials.push({ group: 'christmas', apply: buy([cookie]) });
        const spooky = first(game.halloweenDrops);
        if (spooky) trials.push({ group: 'halloween', apply: buy([spooky]) });
        const heart = game.heartDrops.find((n) => !game.Has(n));
        if (heart) trials.push({ group: 'heart', apply: buy([heart]) });
        // The Chocolate egg is the ascension routine's (candidates.js NEVER_BUY): worth nothing here.
        for (const n of missing(game.easterEggs)) if (n !== 'Chocolate egg') trials.push({ group: 'egg', name: n, apply: buy([n]) });
        const measured = simulateEach(game, trials, income);
        const base = measured[0];
        const sums = {};
        const counts = {};
        const eggs = {}; // name -> what that egg adds, for a hunt that values each egg
        trials.forEach((t, i) => {
            const gain = Math.max(0, measured[i] - base);
            sums[t.group] = (sums[t.group] || 0) + gain;
            counts[t.group] = (counts[t.group] || 0) + 1;
            if (t.name) eggs[t.name] = gain;
        });
        const mean = (g) => (counts[g] ? sums[g] / counts[g] : 0);
        const eggsLeft = missing(game.easterEggs).length;
        return {
            income: base,
            santaLevel: game.santaLevel,
            santa: mean('santa'),
            christmas: mean('christmas'),
            halloween: mean('halloween'),
            heart: mean('heart'),
            // Averaged over every missing egg, the Chocolate egg counting as nothing.
            egg: eggsLeft ? (sums.egg || 0) / eggsLeft : 0,
            eggs,
        };
    }

    // What a new drop is worth over the rest of the run, net of buying it: the wrinkler system
    // applies its own chance of each drop per pop (core/wrinklers.js huntDecision).
    function dropValue(name, gain, H) {
        return Math.max(0, gain * H - game.Upgrades[name].getPrice());
    }

    function huntRequest(season, gains, H) {
        if (season === 'halloween') {
            // The seven Halloween cookies are alike (+2% each, main.js:10218-10224).
            const values = {};
            for (const n of missing(game.halloweenDrops)) values[n] = dropValue(n, gains.halloween, H);
            return worthHunting(season, values);
        }
        if (season === 'easter') {
            const values = {};
            for (const n of missing(game.easterEggs)) values[n] = n in gains.eggs ? dropValue(n, gains.eggs[n], H) : 0;
            return worthHunting(season, values);
        }
        return null;
    }

    function worthHunting(season, values) {
        if (!Object.keys(values).some((n) => values[n] > 0)) return null;
        return { season, value: (name) => values[name] || 0, values };
    }

    // What the wrinkler system would bring and cost a second hunting `season`, when it would hunt.
    function huntVerdict(season, gains, H) {
        if (!wrinklers || !options.hunt || !(Number(settings.autoWrinkler) > 0)) return null;
        const request = huntRequest(season, gains, H);
        const verdict = request ? wrinklers.valueHunt(request) : null;
        return verdict && verdict.hunt ? verdict : null;
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
        // In Halloween and Easter the wrinkler system hunts when that pays: pops then come at its
        // rate, and the wrinkler income it forfeits is paid until the drops are expected in.
        const spookyHunt = huntVerdict('halloween', gains, H);
        const eggHunt = huntVerdict('easter', gains, H);
        const spookyWaits = uniformWaits({ missing: missing(game.halloweenDrops).length, total: 7, rate: spookyHunt ? spookyHunt.popsPerSecond : pops, chance: c.halloween });
        const eggs = missing(game.easterEggs);
        const eggWait = eggWaits({
            rareMissing: eggs.filter((n) => game.rareEggDrops.indexOf(n) !== -1).length,
            commonMissing: eggs.filter((n) => game.eggDrops.indexOf(n) !== -1).length,
            rate: golden * c.eggGolden + (eggHunt ? eggHunt.popsPerSecond : pops) * c.eggPop,
        });
        // Halloween and Easter pay only their drops: they are visits, lasting until those are in.
        const spookySeconds = collectionSeconds({ waits: spookyWaits, horizon: H });
        const eggSeconds = collectionSeconds({ waits: eggWait, horizon: H });
        const huntCost = (verdict, seconds) => (verdict ? verdict.cost * seconds : 0);
        const zero = { standing: 0, collection: 0, nextDrop: Infinity };
        return {
            chances: c,
            pops,
            values: {
                christmas: { standing, collection: christmas, nextDrop: christmasNext },
                halloween: {
                    standing: 0,
                    collection: collectionValue({ waits: spookyWaits, gain: gains.halloween, horizon: H }) - huntCost(spookyHunt, spookySeconds),
                    nextDrop: spookyWaits.length ? spookyWaits[0] : Infinity,
                    seconds: spookySeconds,
                },
                easter: {
                    standing: 0,
                    collection: collectionValue({ waits: eggWait, gain: gains.egg, horizon: H }) - huntCost(eggHunt, eggSeconds),
                    nextDrop: eggWait.length ? eggWait[0] : Infinity,
                    seconds: eggSeconds,
                },
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

    // --- Acting, as a player clicks -------------------------------------------------------------
    // Paid at the price the store shows now, and only from above the reserve: the plan was priced
    // up to a tick ago, and CpS (which the price follows) may have grown since.
    function switchTo(season) {
        const it = trigger(season);
        if (!canSwitch() || !it || it.bought || !inStore(it) || game.season === season) return false;
        const price = it.getPrice();
        if (spendable() < price) return false;
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
        if (!game.Has('A festive hat') || game.santaLevel !== level || spendable() < santaPrice(level)) return false;
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
                priceNow: () => santaPrice(level) + (level === 13 ? game.Upgrades["Santa's dominion"].getPrice() : 0),
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
                priceNow: () => trigger(to).getPrice(),
                // Payback against the other purchases: the plan's gross worth, spread over the run.
                deltaIncome: (plan.gain + plan.price) / H,
                valid: () => game.season === from && canSwitch() && !trigger(to).bought,
                buy: () => switchTo(to),
            });
        }
        return offers;
    }

    // Priced when the buyer ranks them, not when the plan was made.
    const liveOffers = () => (settings.autoSeasons == 1 ? state.offers.filter((o) => o.valid()).map((o) => ({ ...o, price: o.priceNow() })) : []);
    if (buyer) buyer.offer('seasons', liveOffers);

    // With the buyer off, nothing else spends: buy what the plan asks for when the bank covers it
    // above the buyer's reserve.
    function buyDirectly() {
        const hat = game.Upgrades['A festive hat'];
        if (inStore(hat) && !hat.bought && spendable() >= hat.getPrice()) hat.buy(1);
        for (const offer of liveOffers()) if (spendable() >= offer.price) offer.buy();
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
        const { values } = seasonValues(gains, H);
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
        // Nothing is asked once every drop worth having is in.
        if (wrinklers) {
            const request = options.hunt ? huntRequest(game.season, gains, H) : null;
            state.hunting = request ? { season: request.season, values: request.values } : null;
            wrinklers.hunt(request);
        }
    }

    loop.add('seasons', tick, { everyFrames: TICK_EVERY, enabled: () => settings.autoSeasons == 1 && !game.OnAscend && !game.AscendTimer });

    return {
        options,
        /** What each missing drop and the next Santa level would add to income, measured now. */
        gains: () => measureGains(),
        /** A plain summary for the console and the tests. */
        report() {
            const owned = (names) => names.filter((n) => game.Has(n)).length;
            return {
                season: game.season,
                plan: state.plan,
                values: state.values,
                offers: state.offers.map((o) => ({ name: o.name, price: o.priceNow(), deltaIncome: o.deltaIncome })),
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
