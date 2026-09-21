import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {
    LANGUAGE_MESSAGE_KEYS,
    LANGUAGE_SELECTIONS,
    LAYER_MESSAGE_KEYS,
    LAYER_SELECTIONS,
    THEME_MESSAGE_KEYS,
    THEME_ORDER,
} from './extension-config.js';
import {box, clamp, iconButton, label} from './extension-support.js';
import {resolveLanguage, translate} from './i18n.js';

export const uiMethods = {
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
        this._expandedView.y_expand = false;
        this._expandedView.x_align = Clutter.ActorAlign.FILL;
        this._expandedView.y_align = Clutter.ActorAlign.START;

        this._contentView = box(true, 'ai-usage-content');
        this._contentView.x_expand = true;
        this._contentView.y_expand = true;
        this._contentView.x_align = Clutter.ActorAlign.FILL;
        this._contentView.y_align = Clutter.ActorAlign.FILL;
        this._contentView.add_child(this._expandedView);

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
        this._card.add_child(this._contentView);

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
    },

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

        this._contentView.add_child(this._menu);
    },

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
    },

    _t(key, values = {}) {
        return translate(this._language, key, values);
    },

    _themeName() {
        return this._t(THEME_MESSAGE_KEYS.get(this._state.theme));
    },

    _languageName() {
        return this._t(LANGUAGE_MESSAGE_KEYS.get(this._state.language));
    },

    _layerName() {
        const selection = this._t(LAYER_MESSAGE_KEYS.get(this._state.layer) ?? 'layerAuto');
        if (this._state.layer !== 'auto' || !this._activeLayer)
            return selection;
        return `${selection} · ${this._t(LAYER_MESSAGE_KEYS.get(this._activeLayer))}`;
    },

    _cycleLayer() {
        const index = LAYER_SELECTIONS.indexOf(this._state.layer);
        this._state.layer = LAYER_SELECTIONS[(index + 1) % LAYER_SELECTIONS.length];
        this._writeState();
        this._applyLayer(this._state.layer === 'overlay' ? 'overlay' : 'desktop');
        if (this._state.layer === 'auto')
            this._scheduleInputAudit(200);
        this._layerValue.text = this._layerName();
    },

    _cycleTheme() {
        const index = THEME_ORDER.indexOf(this._state.theme);
        const next = THEME_ORDER[(index + 1) % THEME_ORDER.length];
        this._state.theme = next;
        this._card.remove_style_class_name(`theme-${THEME_ORDER[index]}`);
        this._card.add_style_class_name(`theme-${next}`);
        this._themeValue.text = this._themeName();
        this._writeState();
    },

    _cycleLanguage() {
        const index = LANGUAGE_SELECTIONS.indexOf(this._state.language);
        this._state.language = LANGUAGE_SELECTIONS[(index + 1) % LANGUAGE_SELECTIONS.length];
        this._language = resolveLanguage(this._state.language, GLib.get_language_names());
        this._writeState();
        this._applyLanguage();
    },

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
    },

    _resetLayout() {
        this._layoutState.xRatio = null;
        this._layoutState.yRatio = null;
        this._layoutState.scale = clamp(this._config.scale, this._minimumScale(), this._maximumScale());
        this._card.set_scale(this._layoutState.scale, this._layoutState.scale);
        this._placeWidget();
        this._writeLayoutState();
        this._closeMenu();
    },

    _toggleMenu() {
        if (this._menuOpen) {
            this._closeMenu();
            return;
        }
        this._menuOpen = true;
        this._menu.visible = true;
        this._contentView.set_child_above_sibling(this._menu, null);
        // Hold the pointer while the menu is open so a click anywhere else
        // closes it, even when another actor owns the desktop underneath.
        this._menuCapture = {grab: this._grabPointer(), target: this._card};
    },

    _closeMenu() {
        if (!this._menuOpen)
            return;
        this._menuOpen = false;
        this._menu.visible = false;
        this._releasePointer(this._menuCapture);
        this._menuCapture = null;
    },

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

};
