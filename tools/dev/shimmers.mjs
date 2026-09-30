// Measures the shimmer system against the inherited popping it replaced.
//
//   node tools/dev/shimmers.mjs missed [hours] [seeds]    shimmers missed per hour
//   node tools/dev/shimmers.mjs fortune [hours] [seeds]   the hour-of-CpS fortune: payout by policy
//
// missed: golden cookies on (this is about golden cookies), a cookie storm forced every five
// minutes for plenty of drops. The inherited popping is rebuilt as it was (fc_main.js before this
// change): a 100 ms timer running the inherited loop, whose first step values wrinklers, then a
// for-in pass over Game.shimmers popping golden cookies, then reindeer, all under one guard. Each
// variant also runs with a failure injected into that first step, as any persistent exception in
// the inherited loop would do.
//
// fortune: plays each seed with the buyer, clicker and shimmer system on, and records the bank and
// CpS every ten seconds (one news ticker). Fortunes are then drawn on that record as the game
// draws them (main.js:7565-7582: 2% of tickers, a fortune picked evenly from those left; upgrades
// and the golden cookie are taken on sight by both policies) and the hour of CpS is paid by each
// policy: on sight (the inherited autoTicker), or by src/core/shimmers.js fortuneChoice, which
// takes any payout in the last ten minutes before the run ends (an ascension imminent).
import { launchWithMod } from '../../test/harness/game.mjs';
import { fortuneChoice } from '../../src/core/shimmers.js';

const mode = process.argv[2] || 'missed';
const hours = Number(process.argv[3] || 1);
const seeds = Array.from({ length: Number(process.argv[4] || 3) }, (_, i) => `shimmers-${i + 1}`);

const spread = (values) => {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return { mean: +mean.toFixed(3), min: +Math.min(...values).toFixed(3), max: +Math.max(...values).toFixed(3), runs: values.length };
};

// --- Missed shimmers -------------------------------------------------------------------------

/** Runs in the page: counters, and the inherited popping when asked for. */
function setupMissed({ inherited, failing }) {
    Game.Earn(1e9);
    for (const name of ['Cursor', 'Grandma', 'Farm', 'Mine']) Game.Objects[name].buy(20);
    window.__missed = 0;
    for (const type of Object.values(Game.shimmerTypes)) {
        const miss = type.missFunc;
        type.missFunc = function () {
            window.__missed++;
            return miss.apply(this, arguments);
        };
    }
    window.__popped = 0;
    const pop = Game.shimmer.prototype.pop;
    Game.shimmer.prototype.pop = function () {
        window.__popped++;
        return pop.apply(this, arguments);
    };
    if (failing) {
        window.wrinklerValue = () => {
            throw new Error('injected');
        };
    }
    FrozenCookies.autoGC = inherited ? 0 : 1;
    FrozenCookies.autoReindeer = inherited ? 0 : 1;
    FCStart();
    if (inherited) {
        const body = MushieCookies.guard('tool:inherited', () => {
            wrinklerValue(); // the inherited loop's first step (autoCookieBody)
            for (const i in Game.shimmers) if (Game.shimmers[i].type == 'golden') Game.shimmers[i].pop();
            for (const i in Game.shimmers) if (Game.shimmers[i].type == 'reindeer') Game.shimmers[i].pop();
        });
        const loop = () => {
            if (!Game.OnAscend && !Game.AscendTimer) body();
            setTimeout(loop, 100);
        };
        setTimeout(loop, 100);
    }
}

async function missed() {
    const rows = [];
    for (const seed of seeds) {
        for (const variant of [
            { label: 'inherited', inherited: true, failing: false },
            { label: 'shimmers', inherited: false, failing: false },
            { label: 'inherited, failure injected', inherited: true, failing: true },
            { label: 'shimmers, failure injected', inherited: false, failing: true },
        ]) {
            const game = await launchWithMod({ seed });
            try {
                await game.eval(setupMissed, variant);
                for (let minute = 0; minute < hours * 60; minute += 5) {
                    await game.eval(() => Game.gainBuff('cookie storm', 7, 7));
                    await game.advanceSeconds(5 * 60);
                }
                const out = await game.eval(() => ({ missed: window.__missed, popped: window.__popped, onScreen: Game.shimmers.length }));
                const row = { seed, variant: variant.label, missedPerHour: out.missed / hours, poppedPerHour: out.popped / hours, onScreen: out.onScreen };
                rows.push(row);
                console.log(JSON.stringify(row));
            } finally {
                await game.close();
            }
        }
    }
    const summary = {};
    for (const label of new Set(rows.map((r) => r.variant))) {
        const mine = rows.filter((r) => r.variant === label);
        summary[label] = { missedPerHour: spread(mine.map((r) => r.missedPerHour)), poppedPerHour: spread(mine.map((r) => r.poppedPerHour)) };
    }
    console.log(JSON.stringify({ summary }));
}

// --- Fortune ----------------------------------------------------------------------------------

async function record(seed) {
    const game = await launchWithMod({ seed });
    try {
        const pool = await game.eval(() => {
            FrozenCookies.autoBuy = 1;
            FrozenCookies.autoClick = 1;
            FrozenCookies.cookieClickSpeed = 50;
            FrozenCookies.autoGC = 1;
            FCStart();
            return Game.Tiers.fortune.upgrades.length + 2;
        });
        const samples = [];
        const perChunk = 60; // tickers per round trip
        for (let t = 0; t < hours * 360; t += perChunk) {
            const chunk = await game.eval(
                ({ n, fps }) => {
                    const out = [];
                    for (let i = 0; i < n; i++) {
                        window.__vt.advance(fps * 10);
                        out.push({ bank: Game.cookies, cps: Game.cookiesPs, unbuffed: Game.unbuffedCps });
                    }
                    return out;
                },
                { n: perChunk, fps: 30 }
            );
            samples.push(...chunk);
        }
        return { pool, samples };
    } finally {
        await game.close();
    }
}

// A small seeded generator, so the draws are the same for both policies and every run.
function generator(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Payout of the hour of CpS under a policy, for one draw of the fortunes over a record. */
function payout(samples, pool, policy, random) {
    let left = pool; // fortune upgrades, the golden cookie and the hour, not yet taken
    const end = samples.length;
    const lastTen = end - 60; // ten minutes of tickers
    for (let i = 0; i < end; i++) {
        if (!(random() < 0.02) || left <= 0) continue;
        if (random() * left >= 1) {
            left--; // an upgrade or the golden cookie, taken on sight by both
            continue;
        }
        const s = samples[i];
        const take =
            policy === 'on sight' ||
            fortuneChoice({ effect: { type: 'fortune', sub: 'fortuneCPS' }, bank: s.bank, cps: s.cps, unbuffedCps: s.unbuffed, ascensionImminent: i >= lastTen }).take;
        if (take) return { paid: Math.min(s.cps * 3600, s.bank), hourOfCps: s.unbuffed * 3600 };
    }
    return { paid: 0, hourOfCps: 0 };
}

async function fortune() {
    const draws = 4000;
    const perSeed = [];
    for (const seed of seeds) {
        const { pool, samples } = await record(seed);
        const final = samples[samples.length - 1];
        const result = { seed, pool, finalHourOfCps: final.unbuffed * 3600 };
        for (const policy of ['on sight', 'policy']) {
            const random = generator(12345);
            let total = 0;
            let none = 0;
            let fullHours = 0;
            for (let d = 0; d < draws; d++) {
                const p = payout(samples, pool, policy, random);
                total += p.paid;
                if (!p.paid) none++;
                else fullHours += p.paid / p.hourOfCps;
            }
            result[policy] = {
                meanPayout: total / draws,
                meanInFinalHours: +(total / draws / result.finalHourOfCps).toFixed(4),
                noPayoutShare: +(none / draws).toFixed(3),
                hoursOfCpsWhenPaid: +(fullHours / Math.max(1, draws - none)).toFixed(3),
            };
        }
        result.ratio = +(result.policy.meanPayout / result['on sight'].meanPayout).toFixed(3);
        perSeed.push(result);
        console.log(JSON.stringify(result));
    }
    console.log(JSON.stringify({ summary: { ratio: spread(perSeed.map((r) => r.ratio)) } }));
}

if (mode === 'missed') await missed();
else if (mode === 'fortune') await fortune();
else {
    console.error('usage: node tools/dev/shimmers.mjs missed|fortune [hours] [seeds]');
    process.exit(1);
}
