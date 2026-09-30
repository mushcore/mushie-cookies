/**
 * When to ascend. Pure.
 *
 * Prestige is what a run produces. The run's average yield is the log-prestige it has earned
 * per second, charged for the time an ascension costs; its current yield is the same over the
 * last window. Once the current yield falls under the average, staying earns less per second
 * than starting again would, so the run ends. The log scale is what makes runs comparable: the
 * prestige multiplier compounds, so a level gained on a large base is worth as much as the
 * same fraction gained on a small one.
 */

const u = (projected) => Math.log(1 + Math.max(0, projected));

/**
 * @param {object} args
 * @param {number} args.prestige         prestige level now
 * @param {number} args.projected        prestige level after ascending now
 * @param {Array<{t: number, projected: number}>} args.history  samples over this run, seconds since it began, oldest first
 * @param {number} args.runSeconds       seconds since reincarnation
 * @param {number} [args.overheadSeconds=300]  what an ascension costs: the animation and the rebuild lag
 * @param {number} [args.windowSeconds=900]    how far back the current yield looks
 * @param {number} [args.minRunSeconds=1800]   never ascend earlier than this
 * @param {number} [args.firstTarget=365]      a first ascension waits for this prestige instead
 * @returns {{ascend: boolean, reason: string, instantRate: number, averageRate: number}}
 */
export function shouldAscend({
    prestige,
    projected,
    history,
    runSeconds,
    overheadSeconds = 300,
    windowSeconds = 900,
    minRunSeconds = 1800,
    firstTarget = 365,
}) {
    const gain = Math.floor(projected) - prestige;
    const now = u(projected);
    const start = history.length ? u(history[0].projected) : now;
    const averageRate = (now - start) / Math.max(1, runSeconds + overheadSeconds);

    // The sample at or before the window's edge; with a short history, the oldest there is.
    let past = null;
    for (const sample of history) {
        if (sample.t <= runSeconds - windowSeconds) past = sample;
        else break;
    }
    if (!past && history.length) past = history[0];
    const span = past ? Math.max(1, runSeconds - past.t) : 0;
    const instantRate = past ? (now - u(past.projected)) / span : Infinity;

    const verdict = (ascend, reason) => ({ ascend, reason, instantRate, averageRate });

    if (gain < 1) return verdict(false, 'no prestige to gain');
    if (prestige === 0) {
        return projected >= firstTarget
            ? verdict(true, `first ascension: ${Math.floor(projected)} reaches the target of ${firstTarget}`)
            : verdict(false, `first ascension waits for ${firstTarget} prestige`);
    }
    if (runSeconds < minRunSeconds) return verdict(false, 'run too short');
    if (!past || span < windowSeconds / 2) return verdict(false, 'not enough history');
    if (instantRate < averageRate) {
        return verdict(true, `growth has slowed: ${instantRate.toExponential(2)}/s now against ${averageRate.toExponential(2)}/s for the run`);
    }
    return verdict(false, 'still growing faster than the run average');
}
