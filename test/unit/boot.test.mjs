import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../../src/game/boot.js';

function fakeGame() {
    const game = {
        mods: {},
        hooks: { logic: [] },
        loads: 0,
        registerMod(id, mod) {
            game.mods[id] = mod;
        },
        registerHook(name, fn) {
            game.hooks[name].push(fn);
        },
        LoadSave() {
            game.loads++;
            return true;
        },
        frame() {
            for (const fn of game.hooks.logic) fn();
        },
    };
    return game;
}

function fakeRuntime(log) {
    return {
        evaluate: () => log.push('evaluate'),
        start: (data) => log.push(['start', data]),
        save: () => 'live-settings',
        load: (data) => log.push(['load', data]),
    };
}

function setup(options = {}) {
    const log = [];
    const ran = [];
    const game = fakeGame();
    const runtime = { ...fakeRuntime(log), ...options.runtime };
    const handle = register(game, {
        id: 'mushie_cookies',
        runtime,
        loop: { run: (frame) => ran.push(frame) },
        fallbackFrames: 5,
        onError: (error, what) => log.push(['error', what, error.message]),
    });
    return { game, log, ran, handle, mod: () => game.mods.mushie_cookies };
}

test('registers at once, before the game has initialised', () => {
    const { game, log } = setup();
    assert.ok(game.mods.mushie_cookies);
    assert.deepEqual(log, [], 'nothing may be evaluated before the game is ready');
    assert.equal(game.hooks.logic.length, 0, 'hooks are registered in init, not before');
});

test('starts on the first frame after the game has loaded its save', () => {
    const { game, log, ran, handle, mod } = setup();
    mod().init();
    game.frame();
    game.frame();
    assert.deepEqual(log, [], 'no save load seen yet');
    game.LoadSave('data');
    assert.equal(game.loads, 1, 'the game\'s own load still runs');
    assert.equal(handle.started(), false, 'starting waits for a frame');
    game.frame();
    assert.deepEqual(log, ['evaluate', ['start', null]]);
    assert.equal(handle.started(), true);
    assert.deepEqual(ran, [], 'the starting frame does not also run the loop');
    game.frame();
    game.frame();
    assert.deepEqual(ran, [4, 5]);
    assert.deepEqual(log, ['evaluate', ['start', null]], 'started exactly once');
});

test('a save loaded before init, as on the web, starts the mod on the first frame', () => {
    const { game, handle, mod } = setup();
    mod().init();
    game.LoadSave();
    game.frame();
    assert.equal(handle.started(), true);
});

test('without any save load it starts at the fallback frame', () => {
    const { game, handle, mod } = setup();
    mod().init();
    for (let i = 0; i < 4; i++) game.frame();
    assert.equal(handle.started(), false);
    game.frame();
    assert.equal(handle.started(), true);
});

test('a save load that throws still counts as seen and the error propagates to the game', () => {
    const { game, handle, mod } = setup();
    game.LoadSave = () => {
        throw new Error('corrupt');
    };
    mod().init();
    assert.throws(() => game.LoadSave(), /corrupt/);
    game.frame();
    assert.equal(handle.started(), true);
});

test('settings loaded before the start are handed to the start', () => {
    const { game, log, mod } = setup();
    mod().init();
    mod().load('{"autoBuy":1}');
    game.LoadSave();
    game.frame();
    assert.deepEqual(log, ['evaluate', ['start', '{"autoBuy":1}']]);
});

test('a save loaded while running is applied directly', () => {
    const { game, log, mod } = setup();
    mod().init();
    game.LoadSave();
    game.frame();
    mod().load('{"autoBuy":0}');
    assert.deepEqual(log[2], ['load', '{"autoBuy":0}']);
});

test('saving before the start returns what was loaded, so settings are not erased', () => {
    const { mod } = setup();
    mod().init();
    assert.equal(mod().save(), '');
    mod().load('kept');
    assert.equal(mod().save(), 'kept');
});

test('saving after the start returns the live settings', () => {
    const { game, mod } = setup();
    mod().init();
    mod().load('old');
    game.LoadSave();
    game.frame();
    assert.equal(mod().save(), 'live-settings');
});

test('a start that throws is reported once and never retried', () => {
    let attempts = 0;
    const { game, log, ran, handle, mod } = setup({
        runtime: {
            evaluate() {
                attempts++;
                throw new Error('legacy broke');
            },
        },
    });
    mod().init();
    game.LoadSave();
    for (let i = 0; i < 10; i++) game.frame();
    assert.equal(attempts, 1);
    assert.deepEqual(log, [['error', 'start', 'legacy broke']]);
    assert.equal(handle.started(), false);
    assert.equal(handle.failed(), true);
    assert.deepEqual(ran, []);
});

test('after a failed start, saving still returns the loaded settings', () => {
    const { game, mod } = setup({
        runtime: {
            start() {
                throw new Error('start broke');
            },
        },
    });
    mod().init();
    mod().load('precious');
    game.LoadSave();
    for (let i = 0; i < 5; i++) game.frame();
    assert.equal(mod().save(), 'precious');
});

test('a save or load that throws while running is reported and does not reach the game', () => {
    const { game, log, mod } = setup({
        runtime: {
            save() {
                throw new Error('save broke');
            },
            load() {
                throw new Error('load broke');
            },
        },
    });
    mod().init();
    mod().load('before');
    game.LoadSave();
    game.frame();
    assert.equal(mod().save(), '', 'nothing kept once running, so nothing to hand back');
    assert.doesNotThrow(() => mod().load('x'));
    assert.deepEqual(log.slice(2), [['error', 'save', 'save broke'], ['error', 'load', 'load broke']]);
});
