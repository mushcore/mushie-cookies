/**
 * Registers the mod the way the game's mod API intends: at script load, before the game has
 * created anything.
 *
 * The legacy code reads game state as soon as it is evaluated, so it is evaluated and started
 * later: on the first logic frame after the game has loaded its save. The game loads the save
 * synchronously while initialising on the web and about a tenth of a second later on Steam;
 * either way it goes through `Game.LoadSave`, which is watched. If no load is seen within
 * `fallbackFrames`, the mod starts anyway.
 *
 * `runtime` is the only thing that touches the page and the legacy globals:
 *   evaluate()  evaluates the legacy source
 *   start(data) starts the legacy code with the saved settings, or null
 *   save()      returns the settings to store
 *   load(data)  applies settings from a save loaded while running
 */
export function register(game, { id, runtime, loop, fallbackFrames = 300, onError = () => {} }) {
    const state = { started: false, failed: false, frame: 0, saved: null, saveSeen: false };

    const report = (what, thrown) => onError(thrown instanceof Error ? thrown : new Error(String(thrown)), what);

    function start() {
        try {
            runtime.evaluate();
            runtime.start(state.saved);
            state.started = true;
            state.saved = null;
        } catch (error) {
            // Retrying every frame would only repeat the failure.
            state.failed = true;
            report('start', error);
        }
    }

    function watchSaveLoads() {
        const original = game.LoadSave;
        if (typeof original !== 'function') return;
        game.LoadSave = function (...args) {
            try {
                return original.apply(this, args);
            } finally {
                state.saveSeen = true;
            }
        };
    }

    game.registerMod(id, {
        init() {
            watchSaveLoads();
            game.registerHook('logic', () => {
                state.frame++;
                if (state.failed) return;
                if (!state.started) {
                    if (state.saveSeen || state.frame >= fallbackFrames) start();
                    return;
                }
                loop.run(state.frame);
            });
        },
        save() {
            if (!state.started) {
                // Not running yet: hand back what was loaded, so an early save cannot erase the settings.
                return state.saved || '';
            }
            try {
                return runtime.save();
            } catch (error) {
                report('save', error);
                return state.saved || '';
            }
        },
        load(data) {
            if (!state.started) {
                state.saved = data;
                return;
            }
            try {
                runtime.load(data);
            } catch (error) {
                report('load', error);
            }
        },
    });

    return {
        started: () => state.started,
        failed: () => state.failed,
    };
}
