const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('public runtime and release identity is Tokidachi', () => {
    const metadata = JSON.parse(read('tokidachi@gaalbu.github.io/metadata.json'));
    assert.equal(metadata.uuid, 'tokidachi@gaalbu.github.io');
    assert.equal(metadata.name, 'Tokidachi');
    assert.equal(metadata.url, 'https://github.com/Gaalbu/tokidachi');

    assert.match(read('tokidachi@gaalbu.github.io/extension.js'),
        /label\('Tokidachi', 'ai-usage-title'\)/);

    assert.match(read('pom.xml'), /<artifactId>tokidachi<\/artifactId>/);
    assert.match(read('pom.xml'), /<imageName>tokidachi<\/imageName>/);
    assert.match(read('scripts/package.sh'), /tokidachi-linux-x86_64\.tar\.gz/);
    assert.match(read('src/main/java/io/github/gaalbu/tokidachi/CodexProvider.java'),
        /clientInfo\.put\("name", "tokidachi"\)/);
    assert.match(read('docs/MIGRATION.md'), /ai-usage-widget@gaalbu\.github\.io/);
});
