import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    LANGUAGE_SELECTIONS,
    normalizeLanguageSelection,
    resolveLanguage,
    translate,
} from './i18n.js';
import {
    animationState,
    providerEntries,
    providerNotices,
    providerApiUsage,
    providerVisuals,
} from './providerModel.js';

const DEFAULT_CONFIG = {
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

const DEFAULT_STATE = {
    minimized: false,
    language: 'auto',
    providers: null,
    layer: 'auto',
};

const THEME_ORDER = ['dark', 'light', 'glass'];
const THEME_MESSAGE_KEYS = new Map([
    ['dark', 'themeDark'],
    ['light', 'themeLight'],
    ['glass', 'themeGlass'],
]);
const LANGUAGE_MESSAGE_KEYS = new Map([
    ['auto', 'languageAuto'],
    ['en', 'languageEnglish'],
    ['pt-BR', 'languagePortuguese'],
]);
// 'desktop' keeps the card in the wallpaper layer, below every window.
// 'overlay' puts it in the shell chrome, above them. 'auto' starts on the
// desktop and falls back to the overlay when something else owns the desktop.
const LAYER_SELECTIONS = Object.freeze(['auto', 'desktop', 'overlay']);
const LAYER_MESSAGE_KEYS = new Map([
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

function normalizeLayerSelection(value) {
    return LAYER_SELECTIONS.includes(value) ? value : 'auto';
}

function clamp(value, low, high) {
    return Math.min(high, Math.max(low, Number(value) || 0));
}

function box(vertical = false, styleClass = '') {
    return new St.BoxLayout({vertical, style_class: styleClass});
}

function label(text, styleClass = '') {
    return new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
}

function iconButton(iconName, styleClass, accessibleName) {
    const button = new St.Button({
        style_class: styleClass,
        can_focus: false,
        reactive: true,
        track_hover: true,
        accessible_name: accessibleName,
    });
    button.set_child(new St.Icon({icon_name: iconName, style_class: 'ai-usage-icon'}));
    return button;
}

export default class TokidachiExtension extends Extension {
    enable() {
        this._config = this._readConfig();
        this._layoutStatePath = GLib.build_filenamev([
            GLib.get_user_config_dir(), 'tokidachi', 'layout.json',
        ]);
        this._uiStatePath = GLib.build_filenamev([
            GLib.get_user_config_dir(), 'tokidachi', 'state.json',
        ]);
        this._layoutState = this._readLayoutState();
        this._state = this._readState();
        this._language = resolveLanguage(this._state.language, GLib.get_language_names());
        this._menuOpen = false;
        this._buildUi();

        // Keep the widget in the desktop background layer. This gives normal
        // application windows (including maximized ones) visual priority,
        // while the widget remains interactive whenever the desktop is shown.
        this._activeLayer = null;
        this._applyLayer(this._state.layer === 'overlay' ? 'overlay' : 'desktop');
        this._monitorSignal = Main.layoutManager.connect('monitors-changed', () => {
            this._placeWidget();
            this._scheduleInputAudit();
        });
        this._outsideClickSignal = global.stage.connect('button-press-event',
            (_actor, event) => this._onStageButtonPress(event));
        // Extensions that own the desktop (desktop icons, wallpaper effects)
        // usually map their window after us, so audit again once the session
        // has settled and whenever a new window shows up.
        this._windowGroupSignal = global.window_group.connect('child-added',
            () => this._scheduleInputAudit());
        this._placeWidget();
        this._scheduleInputAudit();
        this._refresh();

        const seconds = clamp(this._config.refreshSeconds, 60, 3600);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        if (this._monitorSignal) {
            Main.layoutManager.disconnect(this._monitorSignal);
            this._monitorSignal = null;
        }
        if (this._outsideClickSignal) {
            global.stage.disconnect(this._outsideClickSignal);
            this._outsideClickSignal = null;
        }
        if (this._windowGroupSignal) {
            global.window_group.disconnect(this._windowGroupSignal);
            this._windowGroupSignal = null;
        }
        this._endDrag();
        this._endResize();
        this._releasePointer(this._menuCapture);
        this._menuCapture = null;
        // After _endDrag(), which can re-arm the audit while a drag is live.
        if (this._auditTimer) {
            GLib.source_remove(this._auditTimer);
            this._auditTimer = null;
        }
        if (this._stateSaveTimer) {
            GLib.source_remove(this._stateSaveTimer);
            this._stateSaveTimer = null;
            this._writeLayoutState();
        }
        if (this._process)
            this._process.force_exit();
        this._process = null;
        for (const provider of this._providers?.values() ?? [])
            this._stopPet(provider);
        if (this._card) {
            this._detachCard();
            this._card.destroy();
        }
        this._card = null;
        this._menu = null;
        this._desktopLayer = null;
        this._activeLayer = null;
        this._trackedChrome = false;
    }

    _applyLayer(layer) {
        const target = layer === 'overlay' ? 'overlay' : 'desktop';
        if (this._activeLayer === target)
            return;

        const backgroundGroup = Main.layoutManager._backgroundGroup;
        this._detachCard();

        // Older or customized Shell versions may not expose the background
        // group; there the overlay layer is the only option available.
        if (target === 'desktop' && backgroundGroup) {
            backgroundGroup.add_child(this._card);
            backgroundGroup.set_child_above_sibling(this._card, null);
            this._desktopLayer = backgroundGroup;
            // Being parented under the background group only makes the card
            // render below windows; Mutter still needs an explicit input
            // region registration or clicks fall through to whatever is
            // beneath (the desktop), leaving the widget visible but dead.
            Main.layoutManager.trackChrome(this._card, {affectsInputRegion: true});
            this._trackedChrome = true;
            this._activeLayer = 'desktop';
        } else {
            Main.layoutManager.addChrome(this._card, {
                affectsInputRegion: true,
                trackFullscreen: true,
            });
            this._desktopLayer = Main.layoutManager;
            this._activeLayer = 'overlay';
        }

        this._placeWidget();
        if (this._layerValue)
            this._layerValue.text = this._layerName();
    }

    _detachCard() {
        if (!this._card || !this._desktopLayer)
            return;
        if (this._desktopLayer === Main.layoutManager) {
            Main.layoutManager.removeChrome(this._card);
        } else {
            if (this._trackedChrome)
                Main.layoutManager.untrackChrome(this._card);
            this._desktopLayer.remove_child(this._card);
        }
        this._trackedChrome = false;
        this._desktopLayer = null;
        this._activeLayer = null;
    }

    _onCardAllocated() {
        this._placeWidget();
        this._scheduleInputAudit();
    }

    _scheduleInputAudit(delay = 1500) {
        if (this._auditTimer)
            GLib.source_remove(this._auditTimer);
        this._auditTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._auditTimer = null;
            this._auditInputLayer();
            return GLib.SOURCE_REMOVE;
        });
    }

    // The desktop layer is only usable while nothing else claims it. Desktop
    // icon extensions map a DESKTOP-type window over the whole screen, and
    // wallpaper or blur effects push actors on top of the background group;
    // in both cases the card stays visible but stops receiving any pointer
    // event, which reads as a frozen widget. Detect that and move to the
    // overlay layer instead of leaving the user with a dead widget.
    _auditInputLayer() {
        if (!this._card || this._state.layer !== 'auto' || this._activeLayer !== 'desktop')
            return;
        // Cheapest fix first: reclaim the top of the background group.
        if (this._desktopLayer && this._desktopLayer !== Main.layoutManager)
            this._desktopLayer.set_child_above_sibling(this._card, null);
        const blocker = this._desktopLayerBlocker();
        if (!blocker)
            return;
        console.warn(`[Tokidachi] desktop layer input is blocked by ${blocker}; ` +
            'switching the widget to the overlay layer');
        this._applyLayer('overlay');
        if (this._menuOpen)
            this._closeMenu();
    }

    _desktopLayerBlocker() {
        const [x, y] = this._card.get_transformed_position();
        const [width, height] = this._card.get_transformed_size();
        if (!(width > 0) || !(height > 0))
            return null;
        return this._desktopWindowOver(x, y, width, height) ??
            this._pickBlocker(x + width / 2, y + height / 2);
    }

    _desktopWindowOver(x, y, width, height) {
        let actors = [];
        try {
            actors = global.get_window_actors() ?? [];
        } catch (_error) {
            return null;
        }
        for (const actor of actors) {
            const window = actor.meta_window ?? actor.get_meta_window?.();
            if (!window || window.minimized)
                continue;
            let type = null;
            try {
                type = window.get_window_type();
            } catch (_error) {
                continue;
            }
            if (type !== Meta.WindowType.DESKTOP)
                continue;
            const frame = window.get_frame_rect();
            const overlaps = frame.x < x + width && x < frame.x + frame.width &&
                frame.y < y + height && y < frame.y + frame.height;
            if (overlaps)
                return `desktop window "${window.get_wm_class() || window.get_title() || 'unknown'}"`;
        }
        return null;
    }

    _pickBlocker(x, y) {
        let hit = null;
        try {
            hit = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE,
                Math.round(x), Math.round(y));
        } catch (_error) {
            return null;
        }
        if (!hit || this._isCardDescendant(hit))
            return null;
        const background = Main.layoutManager._backgroundGroup;
        for (let node = hit; node; node = node.get_parent()) {
            // An ordinary window covering the card is the whole point of the
            // desktop layer, so it never counts as a conflict. On Wayland the
            // pick lands on the surface actor inside the window actor, so the
            // whole ancestor chain has to be checked, not just the hit.
            if (node instanceof Meta.WindowActor)
                return null;
            if (node === background)
                return this._describeActor(hit);
        }
        return null;
    }

    _isCardDescendant(actor) {
        for (let node = actor; node; node = node.get_parent()) {
            if (node === this._card)
                return true;
        }
        return false;
    }

    _describeActor(actor) {
        const type = actor?.constructor?.$gtype?.name ?? 'actor';
        const name = actor?.get_name?.() || actor?.style_class || '';
        return name ? `${type} (${name})` : type;
    }

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
    }

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
    }

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
    }

    _isProviderVisible(name) {
        const map = this._state.providers;
        if (!map || typeof map !== 'object') return true;
        if (!(name in map)) return true;
        return map[name] !== false;
    }

    _toggleProvider(name) {
        if (!this._state.providers || typeof this._state.providers !== 'object' || Array.isArray(this._state.providers))
            this._state.providers = {};
        this._state.providers[name] = !this._isProviderVisible(name);
        this._writeState();
        this._refreshMenuProviders();
        if (this._lastUsageData) this._render(this._lastUsageData);
        else if (this._lastFailureMessage) this._renderFailure(this._lastFailureMessage);
    }

    _refreshMenuProviders() {
        if (!this._providerMenuRows) return;
        for (const row of this._providerMenuRows.values()) {
            const name = row._providerName;
            row._check.text = this._isProviderVisible(name) ? '☑' : '☐';
        }
    }

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
    }

    _scheduleStateSave() {
        if (this._stateSaveTimer)
            GLib.source_remove(this._stateSaveTimer);
        this._stateSaveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._stateSaveTimer = null;
            this._writeLayoutState();
            return GLib.SOURCE_REMOVE;
        });
    }

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
    }

    _minimumScale() {
        return clamp(this._config.minScale, 0.35, 1);
    }

    _maximumScale() {
        return clamp(this._config.maxScale, 1, 3);
    }

    _buildUi() {
        this._card = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: `ai-usage-card theme-${this._state.theme}`,
        });
        this._card.reactive = true;
        this._card.track_hover = true;
        this._card.can_focus = false;
        this._card.set_pivot_point(0, 0);
        this._card.set_scale(this._layoutState.scale, this._layoutState.scale);
        // Re-place on every allocation change, and re-audit: a card that has
        // not been allocated yet has no geometry for the pick to land on.
        this._card.connect('notify::width', () => this._onCardAllocated());
        this._card.connect('notify::height', () => this._onCardAllocated());
        this._card.connect('scroll-event', (_actor, event) => this._onScroll(event));
        this._card.connect('button-press-event', (_actor, event) => this._onCardButtonPress(event));

        this._expandedView = box(true, 'ai-usage-expanded');
        this._expandedView.x_expand = true;
        this._expandedView.y_expand = true;
        this._expandedView.x_align = Clutter.ActorAlign.FILL;
        this._expandedView.y_align = Clutter.ActorAlign.FILL;

        const header = box(false, 'ai-usage-header');
        header.reactive = true;
        header.track_hover = true;
        header.connect('button-press-event', (_actor, event) => this._onHeaderButtonPress(event));
        const title = label('Tokidachi', 'ai-usage-title');
        this._updated = label(this._t('updating'), 'ai-usage-updated');
        header.add_child(title);
        header.add_child(new St.Widget({x_expand: true}));
        header.add_child(this._updated);
        this._refreshButton = iconButton('view-refresh-symbolic',
            'ai-usage-window-button', this._t('refreshNow'));
        this._refreshButton.connect('clicked', () => this._refresh());
        header.add_child(this._refreshButton);
        this._minimizeButton = iconButton('window-minimize-symbolic',
            'ai-usage-window-button', this._t('minimize'));
        this._minimizeButton.connect('clicked', () => this._setMinimized(true));
        header.add_child(this._minimizeButton);
        this._expandedView.add_child(header);

        this._providers = new Map();
        this._providerList = box(true);
        this._expandedView.add_child(this._providerList);
        this._card.add_child(this._expandedView);

        this._restoreButton = iconButton('window-restore-symbolic',
            'ai-usage-restore-button', this._t('restore'));
        this._restoreButton.x_align = Clutter.ActorAlign.END;
        this._restoreButton.y_align = Clutter.ActorAlign.END;
        this._restoreButton.connect('clicked', () => this._setMinimized(false));
        this._card.add_child(this._restoreButton);

        this._resizeGrip = new St.Widget({
            style_class: 'ai-usage-resize-grip',
            reactive: true,
            track_hover: true,
            width: 18,
            height: 18,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            accessible_name: this._t('resizeWidget'),
        });
        this._resizeGrip.connect('enter-event', () => {
            this._setResizeCursor(Meta.Cursor.SE_RESIZE);
            return Clutter.EVENT_PROPAGATE;
        });
        this._resizeGrip.connect('leave-event', () => {
            if (!this._resize)
                this._setResizeCursor(Meta.Cursor.DEFAULT);
            return Clutter.EVENT_PROPAGATE;
        });
        this._resizeGrip.connect('button-press-event', (_actor, event) =>
            this._onResizeButtonPress(event));
        this._card.add_child(this._resizeGrip);

        this._buildMenu();
        this._syncPresentation();
    }

    _buildMenu() {
        this._menu = box(true, 'ai-usage-menu');
        this._menu.visible = false;
        this._menu.reactive = true;

        const themeRow = box(false, 'ai-usage-menu-row');
        this._themeLabel = label(this._t('theme'), 'ai-usage-menu-label');
        themeRow.add_child(this._themeLabel);
        themeRow.add_child(new St.Widget({x_expand: true}));
        this._themeValue = label(this._themeName(), 'ai-usage-menu-value');
        themeRow.add_child(this._themeValue);
        const themeButton = new St.Button({style_class: 'ai-usage-menu-item', can_focus: false});
        themeButton.set_child(themeRow);
        themeButton.connect('clicked', () => this._cycleTheme());
        this._menu.add_child(themeButton);

        const languageRow = box(false, 'ai-usage-menu-row');
        this._languageLabel = label(this._t('language'), 'ai-usage-menu-label');
        languageRow.add_child(this._languageLabel);
        languageRow.add_child(new St.Widget({x_expand: true}));
        this._languageValue = label(this._languageName(), 'ai-usage-menu-value');
        languageRow.add_child(this._languageValue);
        const languageButton = new St.Button({style_class: 'ai-usage-menu-item', can_focus: false});
        languageButton.set_child(languageRow);
        languageButton.connect('clicked', () => this._cycleLanguage());
        this._menu.add_child(languageButton);

        const layerRow = box(false, 'ai-usage-menu-row');
        this._layerLabel = label(this._t('layer'), 'ai-usage-menu-label');
        layerRow.add_child(this._layerLabel);
        layerRow.add_child(new St.Widget({x_expand: true}));
        this._layerValue = label(this._layerName(), 'ai-usage-menu-value');
        layerRow.add_child(this._layerValue);
        const layerButton = new St.Button({style_class: 'ai-usage-menu-item', can_focus: false});
        layerButton.set_child(layerRow);
        layerButton.connect('clicked', () => this._cycleLayer());
        this._menu.add_child(layerButton);

        const resetButton = new St.Button({style_class: 'ai-usage-menu-item', can_focus: false});
        this._resetLabel = label(this._t('resetLayout'), 'ai-usage-menu-label');
        resetButton.set_child(this._resetLabel);
        resetButton.connect('clicked', () => this._resetLayout());
        this._menu.add_child(resetButton);

        const refreshButton = new St.Button({style_class: 'ai-usage-menu-item', can_focus: false});
        this._refreshMenuLabel = label(this._t('refreshNow'), 'ai-usage-menu-label');
        refreshButton.set_child(this._refreshMenuLabel);
        refreshButton.connect('clicked', () => {
            this._closeMenu();
            this._refresh();
        });
        this._menu.add_child(refreshButton);

        this._providerMenuRows = new Map();
        this._buildProviderMenu();

        this._card.add_child(this._menu);
    }

    _buildProviderMenu() {
        const header = label(this._t('providers'), 'ai-usage-menu-label');
        this._menu.add_child(header);
        for (const name of ['claude', 'codex', 'opencode']) {
            const row = box(false, 'ai-usage-menu-row');
            const check = label(this._isProviderVisible(name) ? '☑' : '☐', 'ai-usage-menu-value');
            const nameLabel = label(name, 'ai-usage-menu-label');
            row.add_child(check);
            row.add_child(nameLabel);
            row._providerName = name;
            row._check = check;
            const btn = new St.Button({style_class: 'ai-usage-menu-item', can_focus: false});
            btn.set_child(row);
            btn.connect('clicked', () => this._toggleProvider(name));
            this._providerMenuRows.set(name, row);
            this._menu.add_child(btn);
        }
    }

    _t(key, values = {}) {
        return translate(this._language, key, values);
    }

    _themeName() {
        return this._t(THEME_MESSAGE_KEYS.get(this._state.theme));
    }

    _languageName() {
        return this._t(LANGUAGE_MESSAGE_KEYS.get(this._state.language));
    }

    _layerName() {
        const selection = this._t(LAYER_MESSAGE_KEYS.get(this._state.layer) ?? 'layerAuto');
        if (this._state.layer !== 'auto' || !this._activeLayer)
            return selection;
        return `${selection} · ${this._t(LAYER_MESSAGE_KEYS.get(this._activeLayer))}`;
    }

    _cycleLayer() {
        const index = LAYER_SELECTIONS.indexOf(this._state.layer);
        this._state.layer = LAYER_SELECTIONS[(index + 1) % LAYER_SELECTIONS.length];
        this._writeState();
        this._applyLayer(this._state.layer === 'overlay' ? 'overlay' : 'desktop');
        if (this._state.layer === 'auto')
            this._scheduleInputAudit(200);
        this._layerValue.text = this._layerName();
    }

    _cycleTheme() {
        const index = THEME_ORDER.indexOf(this._state.theme);
        const next = THEME_ORDER[(index + 1) % THEME_ORDER.length];
        this._state.theme = next;
        this._card.remove_style_class_name(`theme-${THEME_ORDER[index]}`);
        this._card.add_style_class_name(`theme-${next}`);
        this._themeValue.text = this._themeName();
        this._writeState();
    }

    _cycleLanguage() {
        const index = LANGUAGE_SELECTIONS.indexOf(this._state.language);
        this._state.language = LANGUAGE_SELECTIONS[(index + 1) % LANGUAGE_SELECTIONS.length];
        this._language = resolveLanguage(this._state.language, GLib.get_language_names());
        this._writeState();
        this._applyLanguage();
    }

    _applyLanguage() {
        this._themeLabel.text = this._t('theme');
        this._themeValue.text = this._themeName();
        this._languageLabel.text = this._t('language');
        this._languageValue.text = this._languageName();
        this._layerLabel.text = this._t('layer');
        this._layerValue.text = this._layerName();
        this._resetLabel.text = this._t('resetLayout');
        this._refreshMenuLabel.text = this._t('refreshNow');
        this._resizeGrip.accessible_name = this._t('resizeWidget');
        this._refreshButton.accessible_name = this._t('refreshNow');
        this._minimizeButton.accessible_name = this._t('minimize');
        this._restoreButton.accessible_name = this._t('restore');

        if (this._lastFailureMessage !== null && this._lastFailureMessage !== undefined)
            this._renderFailure(this._lastFailureMessage);
        else if (this._lastUsageData)
            this._render(this._lastUsageData);
        else
            this._updated.text = this._t('updating');
    }

    _resetLayout() {
        this._layoutState.xRatio = null;
        this._layoutState.yRatio = null;
        this._layoutState.scale = clamp(this._config.scale, this._minimumScale(), this._maximumScale());
        this._card.set_scale(this._layoutState.scale, this._layoutState.scale);
        this._placeWidget();
        this._writeLayoutState();
        this._closeMenu();
    }

    _toggleMenu() {
        if (this._menuOpen) {
            this._closeMenu();
            return;
        }
        this._menuOpen = true;
        this._menu.visible = true;
        this._card.set_child_above_sibling(this._menu, null);
        // Hold the pointer while the menu is open so a click anywhere else
        // closes it, even when another actor owns the desktop underneath.
        this._menuCapture = {grab: this._grabPointer(), target: this._card};
    }

    _closeMenu() {
        if (!this._menuOpen)
            return;
        this._menuOpen = false;
        this._menu.visible = false;
        this._releasePointer(this._menuCapture);
        this._menuCapture = null;
    }

    _makeProvider(name, visuals) {
        const divider = new St.Widget({style_class: 'ai-usage-divider'});
        divider.visible = false;
        const container = box(true);
        container.visible = false;
        const heading = box(false, 'ai-usage-provider');
        const pet = new St.Icon({style_class: 'ai-usage-pet'});
        heading.add_child(pet);
        const nameLabel = label(visuals.displayName, 'ai-usage-provider-name');
        heading.add_child(nameLabel);
        heading.add_child(new St.Widget({x_expand: true}));
        const status = new St.Widget({style_class: 'ai-usage-status-dot'});
        const statusLabel = label(this._t('waiting'), 'ai-usage-provider-status');
        heading.add_child(status);
        heading.add_child(statusLabel);
        container.add_child(heading);

        const rows = box(true);
        container.add_child(rows);
        const view = {name, providerName: name, divider, container, rows, status, statusLabel, nameLabel,
            petActor: pet, petPath: visuals.pet, displayName: visuals.displayName,
            color: visuals.color, animationState: 'idle', animationGeneration: 0};
        this._updatePetIcon(view);
        return view;
    }

    _placeWidget() {
        const monitorIndex = this._validMonitorIndex(this._layoutState.monitorIndex);
        const monitor = (Main.layoutManager.monitors ?? [])[monitorIndex] ??
            Main.layoutManager.primaryMonitor;
        if (!monitor || !this._card)
            return;

        const margin = clamp(this._config.margin, 0, 200);
        const area = this._workArea(monitorIndex, monitor);
        const [width, height] = this._scaledCardSize();
        const travelX = Math.max(0, area.width - width);
        const travelY = Math.max(0, area.height - height);
        let xRatio = this._layoutState.xRatio;
        let yRatio = this._layoutState.yRatio;

        if (xRatio === null)
            xRatio = this._config.position.includes('left')
                ? Math.min(1, margin / Math.max(1, travelX))
                : Math.max(0, 1 - margin / Math.max(1, travelX));
        if (yRatio === null)
            yRatio = this._config.position.includes('bottom')
                ? Math.max(0, 1 - margin / Math.max(1, travelY))
                : Math.min(1, margin / Math.max(1, travelY));

        this._layoutState.monitorIndex = monitorIndex;
        this._layoutState.xRatio = clamp(xRatio, 0, 1);
        this._layoutState.yRatio = clamp(yRatio, 0, 1);
        this._card.set_position(
            Math.round(area.x + travelX * this._layoutState.xRatio),
            Math.round(area.y + travelY * this._layoutState.yRatio)
        );
    }

    _validMonitorIndex(index) {
        const monitors = Main.layoutManager.monitors ?? [];
        if (index >= 0 && index < monitors.length)
            return index;
        const primaryIndex = monitors.indexOf(Main.layoutManager.primaryMonitor);
        return primaryIndex >= 0 ? primaryIndex : 0;
    }

    _workArea(index, monitor) {
        try {
            return Main.layoutManager.getWorkAreaForMonitor(index);
        } catch (_error) {
            return monitor;
        }
    }

    _scaledCardSize() {
        const scale = this._layoutState.scale;
        const fallbackWidth = this._state.minimized ? 42 : 370;
        const fallbackHeight = this._state.minimized ? 42 : 260;
        return [
            Math.max(1, (this._card.width > 0 ? this._card.width : fallbackWidth) * scale),
            Math.max(1, (this._card.height > 0 ? this._card.height : fallbackHeight) * scale),
        ];
    }

    _monitorAt(x, y) {
        const monitors = Main.layoutManager.monitors ?? [];
        const index = monitors.findIndex(monitor =>
            x >= monitor.x && x < monitor.x + monitor.width &&
            y >= monitor.y && y < monitor.y + monitor.height);
        return index >= 0 ? index : this._validMonitorIndex(this._layoutState.monitorIndex);
    }

    // Listening for motion on the stage only works while the pointer events
    // actually reach the stage. A window sitting over the desktop (or over
    // the card in the overlay layer) swallows them and the drag dies halfway.
    // A Clutter grab routes every pointer event to the card until released.
    _grabPointer() {
        if (typeof global.stage.grab !== 'function')
            return null;
        try {
            return global.stage.grab(this._card);
        } catch (_error) {
            return null;
        }
    }

    _capturePointer(onMotion, onRelease) {
        const grab = this._grabPointer();
        const target = grab ? this._card : global.stage;
        return {
            grab,
            target,
            motionId: target.connect('motion-event', (_actor, event) => onMotion(event)),
            releaseId: target.connect('button-release-event', () => onRelease()),
        };
    }

    _releasePointer(capture) {
        if (!capture)
            return;
        if (capture.motionId)
            capture.target.disconnect(capture.motionId);
        if (capture.releaseId)
            capture.target.disconnect(capture.releaseId);
        if (capture.grab) {
            try {
                capture.grab.dismiss();
            } catch (_error) {
                // The grab is already gone; nothing left to release.
            }
        }
    }

    _onHeaderButtonPress(event) {
        if (event.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;
        this._closeMenu();
        const [x, y] = event.get_coords();
        this._drag = {
            pointerX: x,
            pointerY: y,
            cardX: this._card.x,
            cardY: this._card.y,
            moved: false,
        };
        this._dragCapture = this._capturePointer(
            motionEvent => this._onDragMotion(motionEvent),
            () => this._endDrag());
        return Clutter.EVENT_STOP;
    }

    _onDragMotion(event) {
        if (!this._drag)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const dx = x - this._drag.pointerX;
        const dy = y - this._drag.pointerY;
        if (!this._drag.moved && Math.hypot(dx, dy) < 4)
            return Clutter.EVENT_PROPAGATE;
        this._drag.moved = true;
        this._moveTo(this._drag.cardX + dx, this._drag.cardY + dy, x, y);
        return Clutter.EVENT_STOP;
    }

    _endDrag() {
        this._releasePointer(this._dragCapture);
        this._dragCapture = null;
        if (this._drag?.moved) {
            this._scheduleStateSave();
            this._scheduleInputAudit();
        }
        this._drag = null;
    }

    _moveTo(x, y, pointerX, pointerY) {
        const monitorIndex = this._monitorAt(pointerX, pointerY);
        const monitor = (Main.layoutManager.monitors ?? [])[monitorIndex] ??
            Main.layoutManager.primaryMonitor;
        const area = this._workArea(monitorIndex, monitor);
        const [width, height] = this._scaledCardSize();
        const travelX = Math.max(0, area.width - width);
        const travelY = Math.max(0, area.height - height);
        const boundedX = clamp(x, area.x, area.x + travelX);
        const boundedY = clamp(y, area.y, area.y + travelY);
        this._layoutState.monitorIndex = monitorIndex;
        this._layoutState.xRatio = travelX > 0 ? (boundedX - area.x) / travelX : 0;
        this._layoutState.yRatio = travelY > 0 ? (boundedY - area.y) / travelY : 0;
        this._card.set_position(Math.round(boundedX), Math.round(boundedY));
    }

    _onScroll(event) {
        const direction = event.get_scroll_direction();
        let amount = 0;
        if (direction === Clutter.ScrollDirection.UP)
            amount = 1;
        else if (direction === Clutter.ScrollDirection.DOWN)
            amount = -1;
        else if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [, deltaY] = event.get_scroll_delta();
            amount = -Math.sign(deltaY);
        }
        if (amount === 0)
            return Clutter.EVENT_PROPAGATE;
        this._setScale(this._layoutState.scale + amount *
            clamp(this._config.scaleStep, 0.02, 0.5));
        return Clutter.EVENT_STOP;
    }

    _onResizeButtonPress(event) {
        if (event.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;
        this._closeMenu();
        const [x, y] = event.get_coords();
        this._resize = {
            pointerX: x,
            pointerY: y,
            scale: this._layoutState.scale,
            moved: false,
        };
        this._resizeCapture = this._capturePointer(
            motionEvent => this._onResizeMotion(motionEvent),
            () => this._endResize());
        this._setResizeCursor(Meta.Cursor.SE_RESIZE);
        return Clutter.EVENT_STOP;
    }

    _onResizeMotion(event) {
        if (!this._resize)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const dx = x - this._resize.pointerX;
        const dy = y - this._resize.pointerY;
        if (!this._resize.moved && Math.hypot(dx, dy) < 3)
            return Clutter.EVENT_PROPAGATE;
        this._resize.moved = true;
        const baseSize = Math.max(this._card.width, this._card.height, 1);
        const pointerDelta = (dx + dy) / 2;
        const nextScale = this._resize.scale + pointerDelta / baseSize;
        this._setScale(nextScale);
        return Clutter.EVENT_STOP;
    }

    _endResize() {
        this._releasePointer(this._resizeCapture);
        this._resizeCapture = null;
        this._setResizeCursor(Meta.Cursor.DEFAULT);
        this._resize = null;
    }

    _setResizeCursor(cursor) {
        try {
            global.display.set_cursor(cursor);
        } catch (_error) {
            // Cursor changes are a visual enhancement; resizing still works
            // on Shell versions without this Meta.Display method.
        }
    }

    _setScale(scale) {
        this._layoutState.scale = clamp(scale, this._minimumScale(), this._maximumScale());
        this._card.set_scale(this._layoutState.scale, this._layoutState.scale);
        this._placeWidget();
        this._scheduleStateSave();
    }

    _onCardButtonPress(event) {
        const [x, y] = event.get_coords();
        if (this._menuOpen && !this._pointInMenu(x, y)) {
            this._closeMenu();
            return Clutter.EVENT_STOP;
        }
        if (event.get_button() === 3) {
            this._toggleMenu();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _pointInMenu(x, y) {
        if (!this._menu)
            return false;
        const [menuX, menuY] = this._menu.get_transformed_position();
        const [menuWidth, menuHeight] = this._menu.get_transformed_size();
        return x >= menuX && x <= menuX + menuWidth &&
            y >= menuY && y <= menuY + menuHeight;
    }

    _onStageButtonPress(event) {
        if (!this._menuOpen || !this._card)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        if (!this._pointInMenu(x, y))
            this._closeMenu();
        return Clutter.EVENT_PROPAGATE;
    }

    _setMinimized(minimized) {
        if (this._state.minimized === minimized)
            return;
        this._state.minimized = minimized;
        this._writeState();
        this._syncPresentation();
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._placeWidget();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncPresentation() {
        const wasVisible = this._cardVisible === true;
        const minimized = this._state.minimized;
        this._expandedView.visible = !minimized;
        this._restoreButton.visible = minimized;
        this._resizeGrip.visible = !minimized;
        if (minimized) {
            this._closeMenu();
            this._card.add_style_class_name('minimized');
            this._card.visible = true;
        } else {
            this._card.remove_style_class_name('minimized');
            this._card.visible = this._hasVisibleProviders === true;
        }
        // A hidden card has no size to pick against, so the layer audit is a
        // no-op while it is invisible: run it again as soon as it shows up.
        this._cardVisible = this._card.visible;
        if (this._cardVisible && !wasVisible)
            this._scheduleInputAudit();
        this._syncPetAnimations();
    }

    _refresh() {
        if (this._process)
            return;
        this._lastFailureMessage = null;
        this._updated.text = this._t('updating');

        try {
            this._process = Gio.Subprocess.new(
                [`${this.path}/collector`],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            this._process.communicate_utf8_async(null, null, (process, result) => {
                // disable() can run while the collector is still working; the
                // callback then lands on an already destroyed widget tree.
                if (!this._card) {
                    this._process = null;
                    return;
                }
                try {
                    const [, stdout, stderr] = process.communicate_utf8_finish(result);
                    if (!process.get_successful())
                        throw new Error(stderr.trim() || 'collector failed');
                    this._render(JSON.parse(stdout));
                } catch (error) {
                    this._renderFailure(error.message);
                } finally {
                    this._process = null;
                }
            });
        } catch (error) {
            this._process = null;
            this._renderFailure(error.message);
        }
    }

    _render(data) {
        this._lastUsageData = data;
        this._lastFailureMessage = null;
        const current = new Set();
        let visibleProviders = 0;
        for (const [name, provider] of providerEntries(data)) {
            const visuals = providerVisuals(name, provider);
            let view = this._providers.get(name);
            if (!view) {
                view = this._makeProvider(name, visuals);
                this._providers.set(name, view);
                this._providerList.add_child(view.divider);
                this._providerList.add_child(view.container);
            } else {
                view.displayName = visuals.displayName;
                view.color = visuals.color;
                view.petPath = visuals.pet;
                view.nameLabel.text = visuals.displayName;
                this._updatePetIcon(view);
            }
            current.add(name);
            if (this._renderProvider(view, provider))
                visibleProviders++;
        }
        for (const [name, view] of this._providers) {
            if (!current.has(name)) {
                view.container.visible = false;
                this._stopPet(view);
            }
        }
        this._syncDividers();
        const hasProviders = providerEntries(data).length > 0;
        this._hasVisibleProviders = visibleProviders > 0 || hasProviders;
        this._syncPresentation();
        const time = new Date((data.updatedAt ?? Date.now() / 1000) * 1000);
        const formattedTime = time.toLocaleTimeString(this._language,
            {hour: '2-digit', minute: '2-digit'});
        this._updated.text = this._t('updated', {time: formattedTime});
        this._placeWidget();
    }

    _renderProvider(view, provider) {
        view.rows.destroy_all_children();
        const windows = provider.windows ?? [];
        let visible = provider.configured === true || windows.length > 0;
        if (visible && !this._isProviderVisible(view.providerName ?? '')) {
            visible = false;
        }
        view.container.visible = visible;
        if (!visible)
            this._stopPet(view);
        if (!visible)
            return false;
        const status = provider.status === 'ok'
            ? 'ok' : provider.status === 'stale' ? 'stale' : 'attention';
        view.status.style_class = `ai-usage-status-dot ${status}`;
        view.statusLabel.text = status === 'ok'
            ? this._t('connected')
            : status === 'stale' ? this._t('cached') : this._t('needsAttention');
        view.animationState = animationState(provider);

        for (const window of windows)
            view.rows.add_child(this._makeUsageRow(window, view.color));

        for (const notice of providerNotices(provider))
            view.rows.add_child(label(notice, 'ai-usage-provider-status'));

        const apiUsage = providerApiUsage(provider);
        if (apiUsage) {
            view.rows.add_child(label(this._t('apiEstimatedCost', apiUsage),
                'ai-usage-provider-status'));
        }

        if (windows.length > 0 && provider.message) {
            view.rows.add_child(label(String(provider.message).slice(0, 120),
                'ai-usage-error'));
        }

        if (windows.length === 0) {
            view.rows.add_child(label(provider.message || this._t('noUsageWindow'),
                'ai-usage-error'));
        }
        return true;
    }

    _makeUsageRow(window, color) {
        if (window.kind === 'count') {
            const container = box(true, 'ai-usage-row');
            const line = box(false);
            line.add_child(label(this._t('countLabel', {label: window.label, count: window.count}), 'ai-usage-row-label'));
            container.add_child(line);
            if (window.resetLabel)
                container.add_child(label(window.resetLabel, 'ai-usage-provider-status'));
            return container;
        }
        const usedPercent = Math.round(clamp(window.usedPercent, 0, 100));
        const container = box(true, 'ai-usage-row');
        const line = box(false);
        line.add_child(label(window.label, 'ai-usage-row-label'));
        line.add_child(new St.Widget({x_expand: true}));
        line.add_child(label(`${usedPercent}%`, 'ai-usage-row-value'));
        container.add_child(line);

        const track = new St.Widget({style_class: 'ai-usage-bar'});
        const fill = new St.Widget({
            style_class: 'ai-usage-bar-fill',
            style: `background-color: ${color};`,
        });
        track.add_child(fill);
        const updateFillWidth = () => {
            fill.width = Math.round(track.width * usedPercent / 100);
        };
        track.connect('notify::width', updateFillWidth);
        updateFillWidth();
        container.add_child(track);

        if (window.resetLabel)
            container.add_child(label(window.resetLabel, 'ai-usage-provider-status'));
        return container;
    }

    _renderFailure(message) {
        const safeMessage = String(message).slice(0, 120);
        this._lastFailureMessage = safeMessage;
        this._updated.text = this._t('offline');
        let visibleProviders = 0;
        for (const provider of this._providers.values()) {
            if (!provider.container.visible)
                continue;
            visibleProviders++;
            provider.rows.destroy_all_children();
            provider.rows.add_child(label(safeMessage, 'ai-usage-error'));
            provider.status.style_class = 'ai-usage-status-dot attention';
            provider.statusLabel.text = this._t('needsAttention');
            provider.animationState = 'attention';
        }
        this._syncDividers();
        this._hasVisibleProviders = visibleProviders > 0;
        this._syncPresentation();
        this._placeWidget();
    }

    _syncDividers() {
        let hasVisibleProvider = false;
        for (const provider of this._providers.values()) {
            provider.divider.visible = provider.container.visible && hasVisibleProvider;
            if (provider.container.visible)
                hasVisibleProvider = true;
        }
    }

    _updatePetIcon(provider) {
        provider.petActor.visible = provider.petPath !== null;
        if (!provider.petPath)
            return;
        provider.petActor.gicon = new Gio.FileIcon({
            file: Gio.File.new_for_path(`${this.path}/${provider.petPath}`),
        });
    }

    _syncPetAnimations() {
        for (const provider of this._providers?.values() ?? [])
            this._syncPetAnimation(provider);
    }

    _syncPetAnimation(provider) {
        this._stopPet(provider);
        if (this._config.petAnimations !== true || this._state.minimized ||
            !provider.container.visible || !provider.petActor.visible)
            return;
        const generation = provider.animationGeneration;
        this._animatePetStep(provider, generation, true);
    }

    _animatePetStep(provider, generation, forward) {
        if (generation !== provider.animationGeneration || this._state.minimized ||
            this._config.petAnimations !== true || !provider.container.visible)
            return;
        const target = this._petAnimationTarget(provider.animationState, forward);
        provider.petActor.ease({
            ...target,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            onComplete: () => this._animatePetStep(provider, generation, !forward),
        });
    }

    _petAnimationTarget(state, forward) {
        if (state === 'high') {
            return {
                translation_x: forward ? 3 : -3,
                translation_y: forward ? -1 : 1,
                rotation_angle_z: forward ? 4 : -4,
                duration: 220,
            };
        }
        if (state === 'attention') {
            return {
                translation_x: 0,
                translation_y: forward ? -4 : 0,
                rotation_angle_z: forward ? 7 : -7,
                duration: 500,
            };
        }
        return {
            translation_x: 0,
            translation_y: forward ? -3 : 0,
            rotation_angle_z: forward ? 2 : -2,
            duration: 1300,
        };
    }

    _stopPet(provider) {
        provider.animationGeneration++;
        provider.petActor.remove_all_transitions();
        provider.petActor.translation_x = 0;
        provider.petActor.translation_y = 0;
        provider.petActor.rotation_angle_z = 0;
    }
}
