// Plays on Autopilot from a fresh save under Chrome's sampling profiler and reports the functions
// that take the wall-clock time, by self time and by inclusive time.
// Usage: node tools/dev/profile-autopilot.mjs [gameMinutes] [seed] [--skip=gameMinutes]
import { launchWithMod } from '../../test/harness/game.mjs';

const minutes = Number(process.argv[2] || 60);
const seed = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'profile';
const skipArg = process.argv.find((a) => a.startsWith('--skip='));
const skip = skipArg ? Number(skipArg.split('=')[1]) : 0;
const game = await launchWithMod({ seed, autopilot: true });
if (!game) {
    console.error('game location not configured');
    process.exit(1);
}
try {
    if (skip) await game.advanceSeconds(skip * 60); // profile a later stage of the game
    const cdp = await game.page.context().newCDPSession(game.page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    const t0 = Date.now();
    await game.advanceSeconds(minutes * 60);
    const wall = (Date.now() - t0) / 1000;
    const { profile } = await cdp.send('Profiler.stop');
    const out = await game.eval(() => ({ earned: Game.cookiesEarned, buildings: Game.BuildingsOwned }));
    console.log(`${minutes} game minutes in ${wall.toFixed(1)} s: ${((minutes * 60) / wall).toFixed(0)}x real time; earned ${out.earned.toExponential(2)}, ${out.buildings} buildings`);

    // Self time per node from the samples, then roll up by function and fold into ancestors.
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const selfUs = new Map();
    const deltas = profile.timeDeltas;
    profile.samples.forEach((id, i) => selfUs.set(id, (selfUs.get(id) || 0) + (deltas[i] || 0)));
    const label = (n) => {
        const f = n.callFrame;
        const file = (f.url || '').split('/').pop() || '(native)';
        return `${f.functionName || '(anonymous)'} ${file}:${f.lineNumber + 1}`;
    };
    const self = new Map();
    const inclusive = new Map();
    for (const [id, us] of selfUs) {
        const n = byId.get(id);
        self.set(label(n), (self.get(label(n)) || 0) + us);
        // Each distinct function on the stack gets the sample once.
        const seen = new Set();
        for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
            const l = label(byId.get(cur));
            if (seen.has(l)) continue;
            seen.add(l);
            inclusive.set(l, (inclusive.get(l) || 0) + us);
        }
    }
    const total = [...selfUs.values()].reduce((a, b) => a + b, 0);
    const show = (title, map, n) => {
        console.log(`\n${title}`);
        [...map.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, n)
            .forEach(([l, us]) => console.log(`${(us / 1e6).toFixed(2).padStart(8)} s ${((100 * us) / total).toFixed(1).padStart(5)}%  ${l}`));
    };
    show('self time', self, 25);
    show('inclusive time', inclusive, 40);
} finally {
    await game.close();
}
