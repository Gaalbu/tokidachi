import {
    LANGUAGE_SELECTIONS,
    normalizeLanguageSelection,
} from './i18n.js';

export {LANGUAGE_SELECTIONS, normalizeLanguageSelection};

export const DEFAULT_CONFIG = {
    refreshSeconds: 300,
    position: 'top-right',
    margin: 28,
    scale: 1,
    minScale: 0.45,
    maxScale: 2.5,
    scaleStep: 0.1,
    language: 'auto',
    theme: 'dark',
    petAnimations: true,
    layer: 'auto',
};

export const DEFAULT_STATE = {
    minimized: false,
    language: 'auto',
    providers: null,
    layer: 'auto',
};

export const THEME_ORDER = ['dark', 'light', 'glass'];
export const THEME_MESSAGE_KEYS = new Map([
    ['dark', 'themeDark'],
    ['light', 'themeLight'],
    ['glass', 'themeGlass'],
]);
export const LANGUAGE_MESSAGE_KEYS = new Map([
    ['auto', 'languageAuto'],
    ['en', 'languageEnglish'],
    ['pt-BR', 'languagePortuguese'],
]);
export const LAYER_SELECTIONS = Object.freeze(['auto', 'desktop', 'overlay']);
export const LAYER_MESSAGE_KEYS = new Map([
    ['auto', 'layerAuto'],
    ['desktop', 'layerDesktop'],
    ['overlay', 'layerOverlay'],
]);

const THEME_ALIASES = new Map([
    ['dark', 'dark'],
    ['light', 'light'],
    ['glass', 'glass'],
    ['transparent', 'glass'],
]);

export function normalizeLayerSelection(value) {
    return LAYER_SELECTIONS.includes(value) ? value : 'auto';
}

export {THEME_ALIASES};
