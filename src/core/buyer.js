/**
 * Purchase ranking. Pure: candidates arrive with their price and the income they would leave
 * the bakery with; this decides what is worth buying next and how much to keep in the bank.
 */

/**
 * Payback of a purchase: the time to afford what the bank does not yet cover, plus the time
 * the added income takes to repay the price. Lower is better.
 */
export function payback({ price, deltaIncome, income, bank }) {
    if (!(deltaIncome > 0) || !(income > 0)) return Infinity;
    return Math.max(price - bank, 0) / income + price / deltaIncome;
}

/**
 * Ranks candidates by payback.
 *
 * @param {object} args
 * @param {Array<{key, kind, price, steps?}>} args.candidates
 * @param {Array<{total: number, basket?: number}>} args.measured  income after each candidate, aligned with candidates
 * @param {{total: number, basket?: number}} args.income           income now
 * @param {number} args.bank
 * @returns candidates with `deltaIncome` and `payback`, best first
 */
export function rankCandidates({ candidates, measured, income, bank }) {
    const ranked = candidates.map((candidate, i) => {
        const after = measured[i];
        let deltaIncome = after.total - income.total;
        // A discount is worth the share of future spending it saves; spending runs at about
        // the rate of income, so a p% discount is worth p% of income.
        if (income.basket > 0 && after.basket > 0 && after.basket < income.basket) {
            deltaIncome += income.total * (1 - after.basket / income.basket);
        }
        return {
            ...candidate,
            deltaIncome,
            payback: payback({ price: candidate.price, deltaIncome, income: income.total, bank }),
        };
    });
    ranked.sort((a, b) => a.payback - b.payback || b.deltaIncome - a.deltaIncome || a.price - b.price);
    return ranked;
}

/**
 * How many cookies to keep in the bank for golden cookies. A reserve is a level of bank and
 * the income the bakery has at that level; keeping it costs the purchases it delays, so a
 * reserve is kept only when it pays back at least as fast as the best purchase does.
 *
 * @param {object} args
 * @param {{payback: number} | null} args.best   the best-ranked candidate
 * @param {Array<{amount: number, incomeAt: number}>} args.reserves  candidate bank levels, any order
 * @param {{total: number}} args.income          income at a bank of zero
 * @returns {number} the reserve to keep, 0 when none qualifies
 */
export function chooseReserve({ best, reserves, income }) {
    const limit = best ? best.payback : Infinity;
    let chosen = 0;
    for (const reserve of reserves) {
        if (!(reserve.amount > 0)) continue;
        const gain = reserve.incomeAt - income.total;
        if (!(gain > 0)) continue;
        const paybackOfReserve = reserve.amount / gain;
        if (paybackOfReserve <= limit && reserve.amount > chosen) chosen = reserve.amount;
    }
    return chosen;
}

/**
 * What to buy now: the best candidate if the bank covers it and the reserve, else nothing.
 * Buying something worse because it is affordable is not a shortcut: the payback ordering
 * already priced the wait.
 */
export function decide({ ranked, reserve, bank }) {
    const best = ranked.find((c) => Number.isFinite(c.payback));
    if (!best) return null;
    return best.price + reserve <= bank ? best : null;
}
