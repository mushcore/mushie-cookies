/**
 * Registers the mod the way the game's mod API intends: at script load, before the game has
 * created anything.
 *
 * The legacy code reads game state as soon as it is evaluated, so it is evaluated and started
 * later: `startDelayFrames` logic frames after the game calls init(). On Steam the game loads
 * its save a tenth of a second after initialising; one second of frames is safely past that.
 *
 * `runtime` is the only thing that touches the page and the legacy globals:
 *   evaluate()  evaluates the legacy source
 *   start(data) starts the legacy code with the saved settings, or null
 *   save()      returns the settings to store
 *   load(data)  applies settings from a save loaded while running
 */
export function register(game, { id, runtime, loop, startDelayFrames = 30, onError = () => {} }) {
    const state = { started: false, failed: false, frame: 0, saved: null };

    function start() {
        try {
            runtime.evaluate();
            runtime.start(state.saved);
            state.started = true;
            state.saved = null;
        } catch (error) {
            // Retrying every frame would only repeat the failure.
            state.failed = true;
            onError(error instanceof Error ? error : new Error(String(error)));
        }
    }

    game.registerMod(id, {
        init() {
            game.registerHook('logic', () => {
                state.frame++;
                if (state.failed) return;
                if (!state.started) {
                    if (state.frame >= startDelayFrames) start();
                    return;
                }
                loop.run(state.frame);
            });
        },
        save() {
            if (state.started) return runtime.save();
            // Not running yet: hand back what was loaded, so an early save cannot erase the settings.
            return state.saved || '';
        },
        load(data) {
            if (state.started) runtime.load(data);
            else state.saved = data;
        },
    });

    return {
        started: () => state.started,
        failed: () => state.failed,
    };
}
