import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../../src/game/boot.js';

function fakeGame() {
    const game = {
        mods: {},
        hooks: { logic: [] },
        registerMod(id, mod) {
            game.mods[id] = mod;
        },
        registerHook(name, fn) {
            game.hooks[name].push(fn);
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
        startDelayFrames: 3,
        onError: (error) => log.push(['error', error.message]),
    });
    return { game, log, ran, handle, mod: () => game.mods.mushie_cookies };
}

test('registers at once, before the game has initialised', () => {
    const { game, log } = setup();
    assert.ok(game.mods.mushie_cookies);
    assert.deepEqual(log, [], 'nothing may be evaluated before the game is ready');
    assert.equal(game.hooks.logic.length, 0, 'hooks are registered in init, not before');
});

test('starts once, on the configured frame, and only then runs the loop', () => {
    const { game, log, ran, handle, mod } = setup();
    mod().init();
    game.frame();
    game.frame();
    assert.deepEqual(log, []);
    assert.equal(handle.started(), false);
    game.frame();
    assert.deepEqual(log, ['evaluate', ['start', null]]);
    assert.equal(handle.started(), true);
    assert.deepEqual(ran, [], 'the starting frame does not also run the loop');
    game.frame();
    game.frame();
    assert.deepEqual(ran, [4, 5]);
    assert.deepEqual(log, ['evaluate', ['start', null]], 'started exactly once');
});

test('settings loaded before the start are handed to the start', () => {
    const { game, log, mod } = setup();
    mod().init();
    mod().load('{"autoBuy":1}');
    for (let i = 0; i < 3; i++) game.frame();
    assert.deepEqual(log, ['evaluate', ['start', '{"autoBuy":1}']]);
});

test('a save loaded while running is applied directly', () => {
    const { game, log, mod } = setup();
    mod().init();
    for (let i = 0; i < 3; i++) game.frame();
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
    for (let i = 0; i < 3; i++) game.frame();
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
    for (let i = 0; i < 10; i++) game.frame();
    assert.equal(attempts, 1);
    assert.deepEqual(log, [['error', 'legacy broke']]);
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
    for (let i = 0; i < 5; i++) game.frame();
    assert.equal(mod().save(), 'precious');
});
