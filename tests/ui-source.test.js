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
