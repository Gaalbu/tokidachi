export const LANGUAGE_SELECTIONS = Object.freeze(['auto', 'en', 'pt-BR']);

const MESSAGES = Object.freeze({
    en: Object.freeze({
        updating: 'Updating…',
        updated: 'Updated {time}',
        waiting: 'Waiting',
        connected: 'Connected',
        cached: 'Cached',
        needsAttention: 'Needs attention',
        offline: 'Offline',
        noUsageWindow: 'No usage window available',
        theme: 'Theme:',
        themeDark: 'Dark',
        themeLight: 'Light',
        themeGlass: 'Glass',
        language: 'Language:',
        languageAuto: 'System',
        languageEnglish: 'English',
        languagePortuguese: 'Portuguese (Brazil)',
        resetLayout: 'Reset position and size',
        refreshNow: 'Refresh usage now',
        minimize: 'Minimize Tokidachi',
        restore: 'Restore Tokidachi',
    }),
    'pt-BR': Object.freeze({
        updating: 'Atualizando…',
        updated: 'Atualizado às {time}',
        waiting: 'Aguardando',
        connected: 'Conectado',
        cached: 'Em cache',
        needsAttention: 'Requer atenção',
        offline: 'Offline',
        noUsageWindow: 'Nenhuma janela de uso disponível',
        theme: 'Tema:',
        themeDark: 'Escuro',
        themeLight: 'Claro',
        themeGlass: 'Transparente',
        language: 'Idioma:',
        languageAuto: 'Sistema',
        languageEnglish: 'Inglês',
        languagePortuguese: 'Português (Brasil)',
        resetLayout: 'Redefinir posição e tamanho',
        refreshNow: 'Atualizar uso agora',
        minimize: 'Minimizar Tokidachi',
        restore: 'Restaurar Tokidachi',
    }),
});

export function normalizeLanguageSelection(value) {
    return LANGUAGE_SELECTIONS.includes(value) ? value : 'auto';
}

export function resolveLanguage(selection, systemLanguages = []) {
    const normalizedSelection = normalizeLanguageSelection(selection);
    if (normalizedSelection !== 'auto')
        return normalizedSelection;
    const locales = Array.isArray(systemLanguages) ? systemLanguages : [];
    for (const locale of locales) {
        const normalizedLocale = normalizeLocale(locale);
        if (normalizedLocale.startsWith('pt'))
            return 'pt-BR';
        if (normalizedLocale.startsWith('en') || normalizedLocale === 'c')
            return 'en';
    }
    return 'en';
}

export function translate(language, key, values = {}) {
    const messages = MESSAGES[language] ?? MESSAGES.en;
    const template = messages[key] ?? MESSAGES.en[key] ?? key;
    return template.replace(/{(\w+)}/g, (match, name) =>
        Object.hasOwn(values, name) ? String(values[name]) : match);
}

function normalizeLocale(locale) {
    return String(locale).split('.')[0].split('@')[0].replaceAll('_', '-').toLowerCase();
}
