import GLib from 'gi://GLib';

import {
    DEFAULT_CONFIG,
    DEFAULT_STATE,
    THEME_ALIASES,
    normalizeLanguageSelection,
    normalizeLayerSelection,
} from './extension-config.js';
import {clamp} from './extension-support.js';

export const configMethods = {
    _readConfig() {
        try {
            const [ok, bytes] = GLib.file_get_contents(`${this.path}/config.json`);
            if (ok) {
                const config = {
                    ...DEFAULT_CONFIG,
                    ...JSON.parse(new TextDecoder().decode(bytes)),
                };
                const requestedTheme = typeof config.theme === 'string'
                    ? config.theme.trim().toLowerCase() : '';
                config.theme = THEME_ALIASES.get(requestedTheme) ?? DEFAULT_CONFIG.theme;
                config.language = normalizeLanguageSelection(config.language);
                config.layer = normalizeLayerSelection(config.layer);
                return config;
            }
        } catch (error) {
            console.warn(`[Tokidachi] Invalid config.json: ${error.message}`);
        }
        return {...DEFAULT_CONFIG};
    },

    _readState() {
        try {
            const [ok, bytes] = GLib.file_get_contents(this._uiStatePath);
            if (ok) {
                const state = JSON.parse(new TextDecoder().decode(bytes));
                return {
                    ...DEFAULT_STATE,
                    minimized: state.minimized === true,
                    theme: THEME_ALIASES.get(state.theme) ?? this._config.theme,
                    language: normalizeLanguageSelection(state.language ?? this._config.language),
                    providers: state.providers && typeof state.providers === 'object' && !Array.isArray(state.providers)
                        ? {...state.providers} : null,
                    layer: normalizeLayerSelection(state.layer ?? this._config.layer),
                };
            }
        } catch (error) {
            if (!error.matches?.(GLib.FileError, GLib.FileError.NOENT))
                console.warn(`[Tokidachi] Invalid user state: ${error.message}`);
        }
        return {
            ...DEFAULT_STATE,
            theme: this._config.theme,
            language: this._config.language,
            layer: this._config.layer,
        };
    },

    _writeState() {
        try {
            const directory = GLib.path_get_dirname(this._uiStatePath);
            GLib.mkdir_with_parents(directory, 0o700);
            GLib.chmod(directory, 0o700);
            const contents = `${JSON.stringify(this._state)}\n`;
            GLib.file_set_contents(this._uiStatePath, contents);
            GLib.chmod(this._uiStatePath, 0o600);
        } catch (error) {
            console.warn(`[Tokidachi] Could not save user state: ${error.message}`);
        }
    },

    _isProviderVisible(name) {
        const map = this._state.providers;
        if (!map || typeof map !== 'object') return true;
        if (!(name in map)) return true;
        return map[name] !== false;
    },

    _toggleProvider(name) {
        if (!this._state.providers || typeof this._state.providers !== 'object' || Array.isArray(this._state.providers))
            this._state.providers = {};
        this._state.providers[name] = !this._isProviderVisible(name);
        this._writeState();
        this._refreshMenuProviders();
        if (this._lastUsageData) this._render(this._lastUsageData);
        else if (this._lastFailureMessage) this._renderFailure(this._lastFailureMessage);
    },

    _refreshMenuProviders() {
        if (!this._providerMenuRows) return;
        for (const row of this._providerMenuRows.values()) {
            const name = row._providerName;
            row._check.text = this._isProviderVisible(name) ? '☑' : '☐';
        }
    },

    _readLayoutState() {
        const fallback = {version: 1, monitorIndex: -1, xRatio: null, yRatio: null,
            scale: clamp(this._config.scale, this._minimumScale(), this._maximumScale())};
        try {
            const [ok, bytes] = GLib.file_get_contents(this._layoutStatePath);
            if (!ok)
                return fallback;
            const saved = JSON.parse(new TextDecoder().decode(bytes));
            return {
                ...fallback,
                monitorIndex: Number.isInteger(saved.monitorIndex) ? saved.monitorIndex : -1,
                xRatio: Number.isFinite(saved.xRatio) ? clamp(saved.xRatio, 0, 1) : null,
                yRatio: Number.isFinite(saved.yRatio) ? clamp(saved.yRatio, 0, 1) : null,
                scale: Number.isFinite(saved.scale)
                    ? clamp(saved.scale, this._minimumScale(), this._maximumScale())
                    : fallback.scale,
            };
        } catch (error) {
            if (!error.matches?.(GLib.FileError, GLib.FileError.NOENT))
                console.warn(`[Tokidachi] Invalid layout state: ${error.message}`);
            return fallback;
        }
    },

    _scheduleStateSave() {
        if (this._stateSaveTimer)
            GLib.source_remove(this._stateSaveTimer);
        this._stateSaveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._stateSaveTimer = null;
            this._writeLayoutState();
            return GLib.SOURCE_REMOVE;
        });
    },

    _writeLayoutState() {
        try {
            const directory = GLib.path_get_dirname(this._layoutStatePath);
            GLib.mkdir_with_parents(directory, 0o700);
            GLib.chmod(directory, 0o700);
            const contents = JSON.stringify({
                version: 1,
                monitorIndex: this._layoutState.monitorIndex,
                xRatio: this._layoutState.xRatio,
                yRatio: this._layoutState.yRatio,
                scale: this._layoutState.scale,
            }, null, 2);
            GLib.file_set_contents(this._layoutStatePath, `${contents}\n`);
            GLib.chmod(this._layoutStatePath, 0o600);
        } catch (error) {
            console.warn(`[Tokidachi] Cannot save layout state: ${error.message}`);
        }
    },

    _minimumScale() {
        return clamp(this._config.minScale, 0.35, 1);
    },

    _maximumScale() {
        return clamp(this._config.maxScale, 1, 3);
    }

};
