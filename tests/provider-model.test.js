import test from 'node:test';
import assert from 'node:assert/strict';

import {animationState, providerEntries, providerVisuals} from '../ai-usage-widget@gaalbu.github.io/providerModel.js';

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
});

test('animationState reflects attention and high usage', () => {
    assert.equal(animationState({status: 'error', windows: []}), 'attention');
    assert.equal(animationState({status: 'ok', windows: [{usedPercent: 81}]}), 'high');
    assert.equal(animationState({status: 'ok', windows: [{usedPercent: 80}]}), 'idle');
});
