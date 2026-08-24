import test from 'node:test';
import assert from 'node:assert/strict';

import {
    LANGUAGE_SELECTIONS,
    normalizeLanguageSelection,
    resolveLanguage,
    translate,
} from '../tokidachi@gaalbu.github.io/i18n.js';

test('language selections expose system, English, and Brazilian Portuguese', () => {
    assert.deepEqual(LANGUAGE_SELECTIONS, ['auto', 'en', 'pt-BR']);
    assert.equal(normalizeLanguageSelection('pt-BR'), 'pt-BR');
    assert.equal(normalizeLanguageSelection('unsupported'), 'auto');
});

test('automatic language follows Portuguese system locales and otherwise uses English', () => {
    assert.equal(resolveLanguage('auto', ['pt_BR.UTF-8', 'pt_BR', 'pt']), 'pt-BR');
    assert.equal(resolveLanguage('auto', ['fr_FR.UTF-8', 'en_US']), 'en');
    assert.equal(resolveLanguage('auto', ['en_US.UTF-8', 'pt_BR']), 'en');
    assert.equal(resolveLanguage('pt-BR', ['en_US']), 'pt-BR');
});

test('translations localize widget copy and interpolate named values', () => {
    assert.equal(translate('pt-BR', 'updated', {time: '14:32'}), 'Atualizado às 14:32');
    assert.equal(translate('pt-BR', 'needsAttention'), 'Requer atenção');
    assert.equal(translate('en', 'updated', {time: '14:32'}), 'Updated 14:32');
});

test('unknown locales fall back to English copy', () => {
    assert.equal(translate('fr', 'refreshNow'), 'Refresh usage now');
});
