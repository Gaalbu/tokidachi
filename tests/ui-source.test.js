const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const extension = fs.readFileSync(
    path.join(root, 'tokidachi@gaalbu.github.io', 'extension.js'), 'utf8');
const stylesheet = fs.readFileSync(
    path.join(root, 'tokidachi@gaalbu.github.io', 'stylesheet.css'), 'utf8');

test('theme menu keeps its label distinct from the selected value', () => {
    assert.match(extension, /label\(this\._t\('theme'\), 'ai-usage-menu-label'\)/);
    assert.match(stylesheet, /\.ai-usage-menu-value\s*\{[^}]*background-color:/s);
    assert.match(stylesheet, /\.ai-usage-menu-value\s*\{[^}]*border-radius:/s);
    assert.match(stylesheet, /\.ai-usage-menu-value\s*\{[^}]*padding:/s);
    assert.match(extension, /providerNotices\(provider\)/);
});

test('resize grip uses the shared scale clamp and persists through the layout state', () => {
    assert.match(extension, /style_class: 'ai-usage-resize-grip'/);
    assert.match(extension, /_resizeGrip\.connect\('button-press-event'/);
    assert.match(extension, /_resizeCapture = this\._capturePointer\(/);
    assert.match(extension, /this\._releasePointer\(this\._resizeCapture\)/);
    assert.match(extension, /this\._setScale\(nextScale\)/);
    assert.match(extension, /minScale: 0\.45/);
    assert.match(extension, /maxScale: 2\.5/);
});

test('drag and resize hold a pointer grab so covered desktops cannot break them', () => {
    // Stage signals only fire for events that reach the stage; a window over
    // the widget swallows them and the interaction dies halfway through.
    assert.match(extension, /_grabPointer\(\)\s*\{[\s\S]*global\.stage\.grab\(this\._card\)/);
    assert.match(extension, /const target = grab \? this\._card : global\.stage;/);
    assert.match(extension, /capture\.grab\.dismiss\(\)/);
    assert.match(extension, /_dragCapture = this\._capturePointer\(/);
    assert.match(extension, /this\._releasePointer\(this\._dragCapture\)/);
    // Every grab must be released on teardown or the session stays stuck.
    assert.match(extension, /disable\(\)[\s\S]*this\._releasePointer\(this\._menuCapture\)/);
});

// The layer behaviour itself is covered end to end in
// tests/extension-behavior.test.js; this only pins the shell API surface the
// detection depends on, which that harness necessarily stubs.
test('the layer detection uses the shell APIs it needs', () => {
    assert.match(extension, /LAYER_SELECTIONS = Object\.freeze\(\['auto', 'desktop', 'overlay'\]\)/);
    // Desktop icon extensions map a DESKTOP-type window over the background.
    assert.match(extension, /Meta\.WindowType\.DESKTOP/);
    // Blur and wallpaper effects instead stack actors in the background group.
    assert.match(extension, /get_actor_at_pos\(Clutter\.PickMode\.REACTIVE/);
    assert.match(extension, /node instanceof Meta\.WindowActor/);
    assert.match(extension, /set_child_above_sibling\(this\._card, null\)/);
    assert.match(extension, /global\.window_group\.connect\('child-added'/);
});

test('the layer can be forced from the menu and from config.json', () => {
    assert.match(extension, /this\._cycleLayer\(\)/);
    assert.match(extension, /LAYER_MESSAGE_KEYS/);
    assert.match(extension, /config\.layer = normalizeLayerSelection\(config\.layer\)/);
    assert.match(extension, /layer: normalizeLayerSelection\(state\.layer \?\? this\._config\.layer\)/);
    assert.match(extension, /this\._layerLabel\.text = this\._t\('layer'\)/);

    const config = JSON.parse(fs.readFileSync(
        path.join(root, 'tokidachi@gaalbu.github.io', 'config.json'), 'utf8'));
    assert.equal(config.layer, 'auto');

    const i18n = fs.readFileSync(
        path.join(root, 'tokidachi@gaalbu.github.io', 'i18n.js'), 'utf8');
    for (const key of ['layer', 'layerAuto', 'layerDesktop', 'layerOverlay'])
        assert.equal(i18n.match(new RegExp(`\\b${key}:`, 'g')).length, 2);
});

test('language selection is persisted, translated, and shipped with the extension', () => {
    assert.match(extension, /LANGUAGE_SELECTIONS/);
    assert.match(extension, /language:\s*normalizeLanguageSelection/);
    assert.match(extension, /this\._state\.language/);
    assert.match(extension, /this\._cycleLanguage\(\)/);

    const installer = fs.readFileSync(path.join(root, 'scripts', 'install.sh'), 'utf8');
    const packager = fs.readFileSync(path.join(root, 'scripts', 'package.sh'), 'utf8');
    assert.match(installer, /i18n\.js/);
    assert.match(packager, /i18n\.js/);
});

test('installer seeds disabled Claude and Codex API settings without overwriting users', () => {
    const settings = JSON.parse(fs.readFileSync(
        path.join(root, 'config', 'api-usage.json'), 'utf8'));
    const providers = settings.apiUsage.providers;
    assert.deepEqual(providers.map(provider => provider.id), ['claude', 'codex']);
    assert.equal(providers.every(provider => provider.enabled === false), true);

    const installer = fs.readFileSync(path.join(root, 'scripts', 'install.sh'), 'utf8');
    const packager = fs.readFileSync(path.join(root, 'scripts', 'package.sh'), 'utf8');
    assert.match(installer, /api-usage\.json/);
    assert.match(installer, /! -e "\$USER_API_CONFIG" && ! -L "\$USER_API_CONFIG"/);
    assert.match(packager, /config\/api-usage\.json/);
    assert.match(packager, /"\$UUID" scripts config/);
});
