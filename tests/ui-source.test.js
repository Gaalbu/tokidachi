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
    assert.match(extension, /label\('Theme:', 'ai-usage-menu-label'\)/);
    assert.match(stylesheet, /\.ai-usage-menu-value\s*\{[^}]*background-color:/s);
    assert.match(stylesheet, /\.ai-usage-menu-value\s*\{[^}]*border-radius:/s);
    assert.match(stylesheet, /\.ai-usage-menu-value\s*\{[^}]*padding:/s);
});
