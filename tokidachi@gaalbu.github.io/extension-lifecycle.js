import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {resolveLanguage} from './i18n.js';
import {clamp} from './extension-support.js';

export const lifecycleMethods = {
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
    },

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
    },

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
    },

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
    },

    _onCardAllocated() {
        this._placeWidget();
        this._scheduleInputAudit();
    },

    _scheduleInputAudit(delay = 1500) {
        if (this._auditTimer)
            GLib.source_remove(this._auditTimer);
        this._auditTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._auditTimer = null;
            this._auditInputLayer();
            return GLib.SOURCE_REMOVE;
        });
    },

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
    },

    _desktopLayerBlocker() {
        const [x, y] = this._card.get_transformed_position();
        const [width, height] = this._card.get_transformed_size();
        if (!(width > 0) || !(height > 0))
            return null;
        return this._desktopWindowOver(x, y, width, height) ??
            this._pickBlocker(x + width / 2, y + height / 2);
    },

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
    },

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
    },

    _isCardDescendant(actor) {
        for (let node = actor; node; node = node.get_parent()) {
            if (node === this._card)
                return true;
        }
        return false;
    },

    _describeActor(actor) {
        const type = actor?.constructor?.$gtype?.name ?? 'actor';
        const name = actor?.get_name?.() || actor?.style_class || '';
        return name ? `${type} (${name})` : type;
    }

};
