// Behavioural tests: extension.js runs against a stub GNOME Shell (see
// tests/harness) so the layer, input and teardown logic can be exercised
// end to end instead of pattern-matched in the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import Meta from './harness/gjs/meta.js';
import {layoutManager, stage} from './harness/gjs/main.js';
import {Actor} from './harness/gjs/actor.js';
import {advance, pendingTimers, resetWorld, world} from './harness/gjs/world.js';
import TokidachiExtension from '../tokidachi@gaalbu.github.io/extension.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(root, 'tokidachi@gaalbu.github.io');

const COLLECTOR_OUTPUT = JSON.stringify({
    version: 1,
    updatedAt: 1757000000,
    providers: {
        claude: {
            configured: true,
            status: 'ok',
            windows: [{kind: 'percent', label: 'Last 5 hours', usedPercent: 42}],
        },
    },
});

function windowActor(type, frame, wmClass = 'test-window') {
    return new Meta.WindowActor(new Meta.Window({type, frame, wmClass}));
}

const FULL_SCREEN = {x: 0, y: 0, width: 1920, height: 1080};

function pressEvent(button, x = 0, y = 0) {
    return {get_button: () => button, get_coords: () => [x, y]};
}

function motionEvent(x, y) {
    return {get_coords: () => [x, y]};
}

function findByStyleClass(actor, styleClass) {
    if (String(actor.style_class).split(' ').includes(styleClass))
        return actor;
    for (const child of actor.get_children()) {
        const found = findByStyleClass(child, styleClass);
        if (found)
            return found;
    }
    return null;
}

// Builds an enabled extension with a laid-out card, and returns it plus a
// teardown that always runs so a failing assertion cannot leak shell state.
function enabled({state = null, subprocess = {stdout: COLLECTOR_OUTPUT}} = {}) {
    resetWorld();
    world.subprocess = subprocess;
    const warnings = [];
    const realWarn = console.warn;
    console.warn = message => warnings.push(String(message));

    if (state) {
        fs.mkdirSync(path.join(world.configDir, 'tokidachi'), {recursive: true});
        fs.writeFileSync(path.join(world.configDir, 'tokidachi', 'state.json'),
            JSON.stringify(state));
    }

    const extension = new TokidachiExtension({path: extensionPath});
    extension.enable();
    // Stand in for a collector reply that has already landed: the widget is
    // only mapped, and therefore only pickable, once it has providers.
    extension._hasVisibleProviders = true;
    extension._syncPresentation();
    extension._card.set_size(370, 260);

    const teardown = () => {
        console.warn = realWarn;
        try {
            extension.disable();
        } catch (_error) {
            // A test that already disabled the extension is fine.
        }
    };
    return {extension, warnings, teardown};
}

function cardCentre(extension) {
    const [x, y] = extension._card.get_transformed_position();
    const [width, height] = extension._card.get_transformed_size();
    return [x + width / 2, y + height / 2];
}

test('enable parks the card in the background group with an input region', () => {
    const {extension, teardown} = enabled();
    try {
        assert.equal(extension._card.get_parent(), layoutManager._backgroundGroup);
        assert.equal(extension._activeLayer, 'desktop');
        assert.deepEqual(world.chromeLog, [['trackChrome', {affectsInputRegion: true}]]);
    } finally {
        teardown();
    }
});

test('a desktop-type window over the card moves the widget to the overlay layer', () => {
    const {extension, warnings, teardown} = enabled();
    try {
        // This is what desktop icon extensions (DING and friends) map.
        world.windowActors = [windowActor(Meta.WindowType.DESKTOP, FULL_SCREEN, 'gjs')];
        advance(1500);

        assert.equal(extension._activeLayer, 'overlay');
        assert.equal(extension._card.get_parent(), layoutManager.uiGroup);
        assert.deepEqual(world.chromeLog.map(entry => entry[0]),
            ['trackChrome', 'untrackChrome', 'addChrome']);
        assert.deepEqual(world.chromeLog.at(-1)[1],
            {affectsInputRegion: true, trackFullscreen: true});
        assert.match(warnings.join('\n'), /blocked by desktop window "gjs"/);
    } finally {
        teardown();
    }
});

test('an ordinary window over the card is not a conflict', () => {
    const {extension, warnings, teardown} = enabled();
    try {
        // Living below normal windows is the whole point of the desktop layer.
        const normal = windowActor(Meta.WindowType.NORMAL, FULL_SCREEN, 'firefox');
        world.windowActors = [normal];
        world.pick = () => normal;
        advance(1500);

        assert.equal(extension._activeLayer, 'desktop');
        assert.equal(warnings.length, 0);
    } finally {
        teardown();
    }
});

test('a minimized desktop window does not trigger a migration', () => {
    const {extension, teardown} = enabled();
    try {
        const actor = windowActor(Meta.WindowType.DESKTOP, FULL_SCREEN, 'gjs');
        actor.meta_window.minimized = true;
        world.windowActors = [actor];
        advance(1500);

        assert.equal(extension._activeLayer, 'desktop');
    } finally {
        teardown();
    }
});

test('a desktop window that does not overlap the card is ignored', () => {
    const {extension, teardown} = enabled();
    try {
        world.windowActors = [windowActor(Meta.WindowType.DESKTOP,
            {x: 0, y: 0, width: 100, height: 100}, 'gjs')];
        advance(1500);

        assert.equal(extension._activeLayer, 'desktop');
    } finally {
        teardown();
    }
});

test('a background-group actor stealing the pick is out-raised before migrating', () => {
    const {extension, teardown} = enabled();
    try {
        // A blur or wallpaper effect stacked over the card: raising the card
        // back to the top of the background group is enough to fix it.
        const effect = new Actor({style_class: 'blur-effect'});
        layoutManager._backgroundGroup.add_child(effect);
        world.pick = () => layoutManager._backgroundGroup.get_children().at(-1) === effect
            ? effect : extension._card;
        advance(1500);

        assert.equal(extension._activeLayer, 'desktop');
        assert.equal(layoutManager._backgroundGroup.get_children().at(-1), extension._card);
    } finally {
        teardown();
    }
});

test('a background-group actor that keeps the pick forces the overlay layer', () => {
    const {extension, warnings, teardown} = enabled();
    try {
        const effect = new Actor({style_class: 'blur-effect', name: 'wallpaper'});
        layoutManager._backgroundGroup.add_child(effect);
        world.pick = () => effect;
        advance(1500);

        assert.equal(extension._activeLayer, 'overlay');
        assert.match(warnings.join('\n'), /blocked by Actor \(wallpaper\)/);
    } finally {
        teardown();
    }
});

test('a pick landing inside the card leaves the layer alone', () => {
    const {extension, teardown} = enabled();
    try {
        world.pick = () => findByStyleClass(extension._card, 'ai-usage-header');
        advance(1500);

        assert.equal(extension._activeLayer, 'desktop');
    } finally {
        teardown();
    }
});

test('the audit runs again for extensions that map their window later', () => {
    const {extension, teardown} = enabled();
    try {
        advance(1500);
        assert.equal(extension._activeLayer, 'desktop');

        // The conflicting extension finishes loading after Tokidachi.
        const desktop = windowActor(Meta.WindowType.DESKTOP, FULL_SCREEN, 'gjs');
        world.windowActors = [desktop];
        globalThis.global.window_group.add_child(desktop);
        globalThis.global.window_group.emit('child-added');
        advance(1500);

        assert.equal(extension._activeLayer, 'overlay');
    } finally {
        teardown();
    }
});

test('a layer forced to desktop never migrates on its own', () => {
    const {extension, warnings, teardown} = enabled({state: {layer: 'desktop'}});
    try {
        world.windowActors = [windowActor(Meta.WindowType.DESKTOP, FULL_SCREEN, 'gjs')];
        advance(1500);

        assert.equal(extension._activeLayer, 'desktop');
        assert.equal(warnings.length, 0);
    } finally {
        teardown();
    }
});

test('a layer forced to overlay starts in the chrome layer', () => {
    const {extension, teardown} = enabled({state: {layer: 'overlay'}});
    try {
        assert.equal(extension._activeLayer, 'overlay');
        assert.equal(extension._card.get_parent(), layoutManager.uiGroup);
        assert.deepEqual(world.chromeLog.map(entry => entry[0]), ['addChrome']);
    } finally {
        teardown();
    }
});

test('cycling the layer from the menu re-parents the card and persists the choice', () => {
    const {extension, teardown} = enabled();
    try {
        const statePath = path.join(world.configDir, 'tokidachi', 'state.json');

        extension._cycleLayer();
        assert.equal(extension._state.layer, 'desktop');
        assert.equal(extension._activeLayer, 'desktop');
        assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).layer, 'desktop');

        extension._cycleLayer();
        assert.equal(extension._state.layer, 'overlay');
        assert.equal(extension._activeLayer, 'overlay');
        assert.equal(extension._card.get_parent(), layoutManager.uiGroup);

        extension._cycleLayer();
        assert.equal(extension._state.layer, 'auto');
        assert.equal(extension._card.get_parent(), layoutManager._backgroundGroup);
        assert.match(extension._layerValue.text, /Automatic/);
    } finally {
        teardown();
    }
});

test('the layer survives a restart through state.json', () => {
    const first = enabled();
    try {
        first.extension._cycleLayer();
        first.extension._cycleLayer();
        assert.equal(first.extension._state.layer, 'overlay');
    } finally {
        first.teardown();
    }

    const saved = JSON.parse(fs.readFileSync(
        path.join(world.configDir, 'tokidachi', 'state.json'), 'utf8'));
    world.subprocess = {stdout: COLLECTOR_OUTPUT};
    const second = new TokidachiExtension({path: extensionPath});
    second.enable();
    try {
        assert.equal(second._state.layer, 'overlay');
        assert.equal(second._activeLayer, 'overlay');
        assert.equal(saved.layer, 'overlay');
    } finally {
        second.disable();
    }
});

test('dragging the header holds a pointer grab instead of listening on the stage', () => {
    const {extension, teardown} = enabled();
    try {
        const header = findByStyleClass(extension._card, 'ai-usage-header');
        const stageHandlersBefore = stage.handlerCount('motion-event');

        header.emit('button-press-event', pressEvent(1, 500, 500));
        assert.equal(stage.activeGrab?.actor, extension._card);
        assert.equal(stage.handlerCount('motion-event'), stageHandlersBefore);
        assert.equal(extension._card.handlerCount('motion-event'), 1);

        extension._card.emit('motion-event', motionEvent(400, 600));
        extension._card.emit('button-release-event');

        assert.equal(stage.activeGrab, null);
        assert.equal(world.grabs.every(grab => grab.dismissed), true);
        assert.equal(extension._card.handlerCount('motion-event'), 0);
        // The card follows the pointer delta, not the pointer itself.
        assert.equal(extension._card.x, 1422);
        assert.equal(extension._card.y, 128);
    } finally {
        teardown();
    }
});

test('a drag keeps working while a desktop window covers the widget', () => {
    const {extension, teardown} = enabled();
    try {
        // The regression: with the old stage listeners these motion events
        // never reached the extension and the widget froze mid-drag.
        world.windowActors = [windowActor(Meta.WindowType.DESKTOP, FULL_SCREEN, 'gjs')];
        advance(1500);
        assert.equal(extension._activeLayer, 'overlay');

        const header = findByStyleClass(extension._card, 'ai-usage-header');
        header.emit('button-press-event', pressEvent(1, 800, 400));
        extension._card.emit('motion-event', motionEvent(300, 700));
        extension._card.emit('button-release-event');

        assert.equal(extension._layoutState.xRatio > 0, true);
        assert.notEqual(extension._card.x, 1522);
    } finally {
        teardown();
    }
});

test('a drag under the movement threshold does not move or save', () => {
    const {extension, teardown} = enabled();
    try {
        const [x, y] = [extension._card.x, extension._card.y];
        const header = findByStyleClass(extension._card, 'ai-usage-header');
        header.emit('button-press-event', pressEvent(1, 500, 500));
        extension._card.emit('motion-event', motionEvent(502, 501));
        extension._card.emit('button-release-event');

        assert.equal(extension._card.x, x);
        assert.equal(extension._card.y, y);
        assert.equal(extension._drag, null);
        assert.equal(stage.activeGrab, null);
    } finally {
        teardown();
    }
});

test('a right-click drag is ignored and takes no grab', () => {
    const {extension, teardown} = enabled();
    try {
        const header = findByStyleClass(extension._card, 'ai-usage-header');
        assert.equal(header.emit('button-press-event', pressEvent(3, 500, 500)), false);
        assert.equal(stage.activeGrab, null);
        assert.equal(extension._drag, undefined);
    } finally {
        teardown();
    }
});

test('the resize grip grabs the pointer and rescales the card', () => {
    const {extension, teardown} = enabled();
    try {
        const grip = findByStyleClass(extension._card, 'ai-usage-resize-grip');
        grip.emit('button-press-event', pressEvent(1, 900, 900));
        assert.equal(stage.activeGrab?.actor, extension._card);
        assert.equal(world.cursor, 'se-resize');

        extension._card.emit('motion-event', motionEvent(1000, 1000));
        assert.equal(extension._layoutState.scale > 1, true);

        extension._card.emit('button-release-event');
        assert.equal(stage.activeGrab, null);
        assert.equal(world.cursor, 'default');
    } finally {
        teardown();
    }
});

// The shipped config.json narrows the built-in clamp to 0.65 - 1.75.
test('scrolling stays inside the configured scale bounds', () => {
    const {extension, teardown} = enabled();
    try {
        for (let step = 0; step < 100; step++)
            extension._card.emit('scroll-event', {get_scroll_direction: () => 'up'});
        assert.equal(extension._layoutState.scale, 1.75);

        for (let step = 0; step < 200; step++)
            extension._card.emit('scroll-event', {get_scroll_direction: () => 'down'});
        assert.equal(extension._layoutState.scale, 0.65);
    } finally {
        teardown();
    }
});

test('the menu holds a grab while open and a click outside closes it', () => {
    const {extension, teardown} = enabled();
    try {
        extension._card.emit('button-press-event', pressEvent(3, 100, 100));
        assert.equal(extension._menuOpen, true);
        assert.equal(extension._menu.visible, true);
        assert.equal(stage.activeGrab?.actor, extension._card);

        // With the grab, a press anywhere is delivered to the card.
        extension._menu.set_size(200, 300);
        extension._card.emit('button-press-event', pressEvent(1, 5, 5));
        assert.equal(extension._menuOpen, false);
        assert.equal(extension._menu.visible, false);
        assert.equal(stage.activeGrab, null);
    } finally {
        teardown();
    }
});

test('a press inside the menu keeps it open', () => {
    const {extension, teardown} = enabled();
    try {
        extension._card.emit('button-press-event', pressEvent(3, 100, 100));
        extension._menu.set_size(200, 300);
        const [menuX, menuY] = extension._menu.get_transformed_position();
        extension._card.emit('button-press-event', pressEvent(1, menuX + 10, menuY + 10));

        assert.equal(extension._menuOpen, true);
        assert.equal(stage.activeGrab?.actor, extension._card);
    } finally {
        teardown();
    }
});

test('starting a drag from the header closes the menu and releases its grab', () => {
    const {extension, teardown} = enabled();
    try {
        extension._card.emit('button-press-event', pressEvent(3, 100, 100));
        const header = findByStyleClass(extension._card, 'ai-usage-header');
        header.emit('button-press-event', pressEvent(1, 500, 500));

        assert.equal(extension._menuOpen, false);
        assert.equal(extension._menuCapture, null);
        assert.equal(stage.activeGrab?.actor, extension._card);

        extension._card.emit('button-release-event');
        assert.equal(stage.activeGrab, null);
    } finally {
        teardown();
    }
});

test('an automatic migration closes an open menu instead of stranding its grab', () => {
    const {extension, teardown} = enabled();
    try {
        extension._card.emit('button-press-event', pressEvent(3, 100, 100));
        assert.equal(extension._menuOpen, true);

        world.windowActors = [windowActor(Meta.WindowType.DESKTOP, FULL_SCREEN, 'gjs')];
        advance(1500);

        assert.equal(extension._activeLayer, 'overlay');
        assert.equal(extension._menuOpen, false);
        assert.equal(stage.activeGrab, null);
    } finally {
        teardown();
    }
});

test('disable releases every grab, timer, signal and parent', () => {
    const {extension, teardown} = enabled();
    try {
        extension._card.emit('button-press-event', pressEvent(3, 100, 100));
        const card = extension._card;
        extension.disable();

        assert.equal(pendingTimers(), 0);
        assert.equal(world.grabs.every(grab => grab.dismissed), true);
        assert.equal(stage.activeGrab, null);
        assert.equal(stage.handlerCount(), 0);
        assert.equal(globalThis.global.window_group.handlerCount(), 0);
        assert.equal(layoutManager.handlerCount(), 0);
        assert.equal(card.get_parent(), null);
        assert.equal(card.destroyed, true);
        assert.equal(layoutManager._chrome.size, 0);
        assert.equal(layoutManager._tracked.size, 0);
    } finally {
        teardown();
    }
});

test('disable during a live drag leaves no audit timer behind', () => {
    const {extension, teardown} = enabled();
    try {
        const header = findByStyleClass(extension._card, 'ai-usage-header');
        header.emit('button-press-event', pressEvent(1, 500, 500));
        extension._card.emit('motion-event', motionEvent(400, 600));

        extension.disable();
        assert.equal(pendingTimers(), 0);
        assert.equal(world.grabs.every(grab => grab.dismissed), true);
    } finally {
        teardown();
    }
});

test('disable from the overlay layer unwinds the chrome registration', () => {
    const {extension, teardown} = enabled({state: {layer: 'overlay'}});
    try {
        const card = extension._card;
        extension.disable();

        assert.equal(card.get_parent(), null);
        assert.equal(layoutManager._chrome.size, 0);
        assert.equal(pendingTimers(), 0);
    } finally {
        teardown();
    }
});

test('enable, migrate and disable can be repeated without leaking shell state', () => {
    for (let round = 0; round < 3; round++) {
        const {extension, teardown} = enabled();
        try {
            world.windowActors = [windowActor(Meta.WindowType.DESKTOP, FULL_SCREEN, 'gjs')];
            advance(1500);
            assert.equal(extension._activeLayer, 'overlay');
        } finally {
            teardown();
        }
        assert.equal(layoutManager._chrome.size, 0);
        assert.equal(layoutManager._tracked.size, 0);
        assert.equal(pendingTimers(), 0);
    }
});

test('collector output still renders while the layer logic runs', async () => {
    const {extension, teardown} = enabled();
    try {
        await new Promise(resolve => queueMicrotask(resolve));
        assert.match(extension._updated.text, /Updated/);
        assert.equal(extension._providers.has('claude'), true);

        world.windowActors = [windowActor(Meta.WindowType.DESKTOP, FULL_SCREEN, 'gjs')];
        advance(1500);
        assert.equal(extension._activeLayer, 'overlay');
        assert.match(extension._updated.text, /Updated/);
    } finally {
        teardown();
    }
});

test('a fresh install does not warn about the missing layout state', () => {
    const {warnings, teardown} = enabled();
    try {
        assert.deepEqual(warnings, []);
    } finally {
        teardown();
    }
});

test('a collector reply that arrives after disable is dropped', async () => {
    const {extension, warnings, teardown} = enabled({subprocess: null});
    try {
        world.subprocess = {stdout: COLLECTOR_OUTPUT};
        extension._refresh();
        extension.disable();
        await new Promise(resolve => queueMicrotask(resolve));

        assert.equal(extension._process, null);
        assert.equal(extension._card, null);
        assert.deepEqual(warnings, []);
    } finally {
        teardown();
    }
});

test('a failing collector renders the offline state without touching the layer', async () => {
    const {extension, teardown} = enabled({
        subprocess: {stdout: '', stderr: 'collector exploded', successful: false},
    });
    try {
        await new Promise(resolve => queueMicrotask(resolve));
        assert.equal(extension._updated.text, 'Offline');
        assert.equal(extension._lastFailureMessage, 'collector exploded');
        assert.equal(extension._activeLayer, 'desktop');
    } finally {
        teardown();
    }
});

test('a corrupt state file falls back to defaults instead of failing to enable', () => {
    resetWorld();
    world.subprocess = {stdout: COLLECTOR_OUTPUT};
    fs.mkdirSync(path.join(world.configDir, 'tokidachi'), {recursive: true});
    fs.writeFileSync(path.join(world.configDir, 'tokidachi', 'state.json'), '{not json');
    fs.writeFileSync(path.join(world.configDir, 'tokidachi', 'layout.json'), '{not json');

    const warnings = [];
    const realWarn = console.warn;
    console.warn = message => warnings.push(String(message));
    const extension = new TokidachiExtension({path: extensionPath});
    try {
        extension.enable();
        assert.equal(extension._state.layer, 'auto');
        assert.equal(extension._activeLayer, 'desktop');
        assert.equal(extension._layoutState.scale, 1);
        assert.equal(warnings.length, 2);
    } finally {
        console.warn = realWarn;
        extension.disable();
    }
});

test('an unknown layer value in state.json is normalized to auto', () => {
    const {extension, teardown} = enabled({state: {layer: 'floating'}});
    try {
        assert.equal(extension._state.layer, 'auto');
        assert.equal(extension._activeLayer, 'desktop');
    } finally {
        teardown();
    }
});

test('minimizing and restoring keeps the card placed and interactive', () => {
    const {extension, teardown} = enabled();
    try {
        extension._setMinimized(true);
        advance(0);
        assert.equal(extension._state.minimized, true);
        assert.equal(extension._expandedView.visible, false);
        assert.equal(extension._restoreButton.visible, true);
        assert.match(extension._card.style_class, /minimized/);

        extension._setMinimized(false);
        advance(0);
        assert.equal(extension._expandedView.visible, true);
        assert.doesNotMatch(extension._card.style_class, /minimized/);
        assert.equal(extension._card.get_parent(), layoutManager._backgroundGroup);
    } finally {
        teardown();
    }
});

test('minimizing closes an open menu and releases its grab', () => {
    const {extension, teardown} = enabled();
    try {
        extension._card.emit('button-press-event', pressEvent(3, 100, 100));
        extension._setMinimized(true);
        advance(0);

        assert.equal(extension._menuOpen, false);
        assert.equal(stage.activeGrab, null);
    } finally {
        teardown();
    }
});

test('theme and language cycles persist next to the layer choice', () => {
    const {extension, teardown} = enabled();
    try {
        const statePath = path.join(world.configDir, 'tokidachi', 'state.json');
        extension._cycleTheme();
        extension._cycleLanguage();
        extension._cycleLayer();

        const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        assert.equal(saved.theme, 'light');
        assert.equal(saved.language, 'en');
        assert.equal(saved.layer, 'desktop');
        assert.match(extension._card.style_class, /theme-light/);
        assert.equal(extension._layerLabel.text, 'Layer:');
    } finally {
        teardown();
    }
});

test('the Portuguese menu translates the layer entry', () => {
    const {extension, teardown} = enabled({state: {language: 'pt-BR'}});
    try {
        assert.equal(extension._layerLabel.text, 'Camada:');
        assert.match(extension._layerValue.text, /Automática · Área de trabalho/);

        world.windowActors = [windowActor(Meta.WindowType.DESKTOP, FULL_SCREEN, 'gjs')];
        advance(1500);
        assert.match(extension._layerValue.text, /Automática · Sobreposta/);
    } finally {
        teardown();
    }
});

test('resetting the layout returns the card to its default spot and layer', () => {
    const {extension, teardown} = enabled();
    try {
        const [defaultX, defaultY] = [extension._card.x, extension._card.y];
        const header = findByStyleClass(extension._card, 'ai-usage-header');
        header.emit('button-press-event', pressEvent(1, 500, 500));
        extension._card.emit('motion-event', motionEvent(200, 800));
        extension._card.emit('button-release-event');
        extension._setScale(1.5);
        assert.notEqual(extension._card.x, defaultX);

        extension._resetLayout();
        assert.equal(extension._card.x, defaultX);
        assert.equal(extension._card.y, defaultY);
        assert.equal(extension._layoutState.scale, 1);
        assert.equal(extension._activeLayer, 'desktop');
    } finally {
        teardown();
    }
});

test('a drag onto a second monitor records that monitor', () => {
    const {extension, teardown} = enabled();
    try {
        world.monitors = [
            {x: 0, y: 0, width: 1920, height: 1080},
            {x: 1920, y: 0, width: 1280, height: 1024},
        ];
        layoutManager.emit('monitors-changed');

        const header = findByStyleClass(extension._card, 'ai-usage-header');
        header.emit('button-press-event', pressEvent(1, 500, 500));
        extension._card.emit('motion-event', motionEvent(2400, 600));
        extension._card.emit('button-release-event');

        assert.equal(extension._layoutState.monitorIndex, 1);
        assert.equal(extension._card.x >= 1920, true);
        advance(1500);
        assert.equal(extension._activeLayer, 'desktop');
    } finally {
        teardown();
    }
});

test('the card is kept inside the work area, clear of panels', () => {
    const {extension, teardown} = enabled();
    try {
        world.workAreas = {0: {x: 0, y: 40, width: 1920, height: 1000}};
        extension._placeWidget();

        assert.equal(extension._card.y >= 40, true);
        assert.equal(extension._card.y + 260 <= 1040, true);
        assert.equal(extension._card.x + 370 <= 1920, true);
    } finally {
        teardown();
    }
});

test('hiding a provider from the menu persists and re-renders', async () => {
    const {extension, teardown} = enabled();
    try {
        await new Promise(resolve => queueMicrotask(resolve));
        assert.equal(extension._providers.get('claude').container.visible, true);

        extension._toggleProvider('claude');
        assert.equal(extension._providers.get('claude').container.visible, false);

        const saved = JSON.parse(fs.readFileSync(
            path.join(world.configDir, 'tokidachi', 'state.json'), 'utf8'));
        assert.equal(saved.providers.claude, false);
    } finally {
        teardown();
    }
});

test('a disabled extension leaves no timer able to touch the shell again', () => {
    const {extension, teardown} = enabled();
    try {
        extension.disable();
        // Nothing should be left to fire, and firing anyway must not throw.
        advance(60_000);
        assert.equal(pendingTimers(), 0);
    } finally {
        teardown();
    }
});

test('the layer audit is retried once the card becomes visible', () => {
    // A hidden card has no geometry to pick against, so a conflict present
    // at enable time would otherwise never be noticed.
    const {extension, teardown} = enabled({subprocess: null});
    try {
        extension._hasVisibleProviders = false;
        extension._syncPresentation();
        world.windowActors = [windowActor(Meta.WindowType.DESKTOP, FULL_SCREEN, 'gjs')];
        advance(1500);
        assert.equal(extension._activeLayer, 'desktop');

        extension._hasVisibleProviders = true;
        extension._syncPresentation();
        extension._card.set_size(370, 260);
        advance(1500);

        assert.equal(extension._activeLayer, 'overlay');
    } finally {
        teardown();
    }
});

test('a card that stays hidden does not schedule endless audits', () => {
    const {extension, teardown} = enabled({subprocess: null});
    try {
        extension._hasVisibleProviders = false;
        extension._syncPresentation();
        extension._syncPresentation();
        advance(1500);

        assert.equal(extension._activeLayer, 'desktop');
        assert.equal(pendingTimers(), 1); // only the refresh timer
    } finally {
        teardown();
    }
});

test('the audit is retried when the card is finally allocated', () => {
    // In a freshly started session the card can be visible but not yet
    // allocated, so the first audit has nothing to pick against.
    const {extension, teardown} = enabled();
    try {
        extension._card.width = 0;
        extension._card.height = 0;
        world.windowActors = [windowActor(Meta.WindowType.DESKTOP, FULL_SCREEN, 'gjs')];
        advance(1500);
        assert.equal(extension._activeLayer, 'desktop');

        extension._card.set_size(370, 260);
        advance(1500);
        assert.equal(extension._activeLayer, 'overlay');
    } finally {
        teardown();
    }
});

test('a pick landing on a window surface actor is not a conflict', () => {
    // Wayland picks the surface actor nested inside the window actor.
    const {extension, teardown} = enabled();
    try {
        const window = windowActor(Meta.WindowType.NORMAL, FULL_SCREEN, 'firefox');
        const surface = new Actor({style_class: 'surface'});
        window.add_child(surface);
        world.windowActors = [window];
        world.pick = () => surface;
        advance(1500);

        assert.equal(extension._activeLayer, 'desktop');
    } finally {
        teardown();
    }
});
