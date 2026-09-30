// Spends sugar lumps on building levels. Harvesting stays with the legacy setting, which already
// harvests at ripe.
import { nextLevelUp } from '../core/lumps.js';

const TICK_EVERY = 30; // frames

/**
 * @param {object} deps
 * @param {object} deps.game
 * @param {object} deps.settings  the mod's settings (autoLumps)
 * @param {object} deps.loop
 * @param {(what: string) => void} [deps.log]
 */
export function createLumps({ game, settings, loop, log = () => {} }) {
    const state = { last: null, spent: 0 };

    function buildingsNow() {
        const total = game.ObjectsById.reduce((sum, b) => sum + (b.storedTotalCps || 0), 0);
        return game.ObjectsById.map((b) => ({
            name: b.name,
            level: b.level,
            amount: b.amount,
            share: total > 0 ? (b.storedTotalCps || 0) / total : 0,
        }));
    }

    function tick() {
        if (!game.canLumps() || game.OnAscend) return;
        const choice = nextLevelUp({
            buildings: buildingsNow(),
            lumps: game.lumps,
            sugarBaking: !!game.Has('Sugar baking'),
        });
        if (!choice) return;
        const building = game.Objects[choice.name];
        const before = building.level;
        // The game asks the player to confirm spending lumps when that preference is on;
        // this is the player saying yes.
        const ask = game.prefs.askLumps;
        game.prefs.askLumps = 0;
        try {
            building.levelUp();
        } finally {
            game.prefs.askLumps = ask;
        }
        if (building.level > before) {
            state.spent += choice.cost;
            state.last = { ...choice, level: building.level };
            log(`levelled ${choice.name} to ${building.level} for ${choice.cost} lumps: ${choice.reason}`);
        }
    }

    loop.add('lumps', tick, { everyFrames: TICK_EVERY, enabled: () => settings.autoLumps == 1 });

    return {
        report() {
            return { lumps: game.lumps, last: state.last, spent: state.spent };
        },
    };
}
