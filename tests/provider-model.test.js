import test from 'node:test';
import assert from 'node:assert/strict';

import {
    animationState,
    providerApiUsage,
    providerEntries,
    providerNotices,
    providerVisuals,
} from '../tokidachi@gaalbu.github.io/providerModel.js';

test('providerEntries keeps every collector provider in protocol order', () => {
    const data = {providers: {
        claude: {status: 'ok'},
        codex: {status: 'ok'},
        future: {status: 'stale'},
    }};

    assert.deepEqual(providerEntries(data).map(([name]) => name), ['claude', 'codex', 'future']);
});

test('providerVisuals accepts safe metadata and rejects style or path injection', () => {
    assert.deepEqual(providerVisuals('future', {
        displayName: 'Future AI',
        color: '#12AbEF',
        pet: 'pets/future-pet.svg',
    }), {
        displayName: 'Future AI',
        color: '#12AbEF',
        pet: 'pets/future-pet.svg',
    });

    const fallback = providerVisuals('future', {
        displayName: '',
        color: 'red; width: 500px',
        pet: '../outside.svg',
    });
    assert.equal(fallback.displayName, 'Future');
    assert.match(fallback.color, /^#[0-9a-f]{6}$/i);
    assert.equal(fallback.pet, null);

    const longFallback = providerVisuals('x'.repeat(100), {});
    assert.equal(longFallback.displayName.length, 40);
});

test('animationState reflects attention and high usage', () => {
    assert.equal(animationState({status: 'error', windows: []}), 'attention');
    assert.equal(animationState({status: 'ok', windows: [{usedPercent: 81}]}), 'high');
    assert.equal(animationState({status: 'ok', windows: [{usedPercent: 80}]}), 'idle');
});

test('providerNotices accepts only bounded non-empty strings', () => {
    const notices = providerNotices({
        notices: ['  One reset available  ', '', 42, 'x'.repeat(100), 'ignored'],
    });

    assert.deepEqual(notices, ['One reset available', 'x'.repeat(80)]);
});

test('providerApiUsage accepts only a successful bounded cost estimate', () => {
    assert.deepEqual(providerApiUsage({apiUsage: {
        status: 'ok', currency: 'usd', estimatedCost: '12.50',
    }}), {currency: 'USD', estimatedCost: '12.50'});
    assert.equal(providerApiUsage({apiUsage: {status: 'error', estimatedCost: '12.50'}}), null);
    assert.equal(providerApiUsage({apiUsage: {status: 'ok', currency: 'USD', estimatedCost: '1;'}}), null);
    assert.equal(providerApiUsage({}), null);
});
