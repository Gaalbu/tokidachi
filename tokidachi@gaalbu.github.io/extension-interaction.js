import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {clamp} from './extension-support.js';

export const interactionMethods = {
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
    },

    _validMonitorIndex(index) {
        const monitors = Main.layoutManager.monitors ?? [];
        if (index >= 0 && index < monitors.length)
            return index;
        const primaryIndex = monitors.indexOf(Main.layoutManager.primaryMonitor);
        return primaryIndex >= 0 ? primaryIndex : 0;
    },

    _workArea(index, monitor) {
        try {
            return Main.layoutManager.getWorkAreaForMonitor(index);
        } catch (_error) {
            return monitor;
        }
    },

    _scaledCardSize() {
        const scale = this._layoutState.scale;
        const fallbackWidth = this._state.minimized ? 42 : 370;
        const fallbackHeight = this._state.minimized ? 42 : 260;
        return [
            Math.max(1, (this._card.width > 0 ? this._card.width : fallbackWidth) * scale),
            Math.max(1, (this._card.height > 0 ? this._card.height : fallbackHeight) * scale),
        ];
    },

    _monitorAt(x, y) {
        const monitors = Main.layoutManager.monitors ?? [];
        const index = monitors.findIndex(monitor =>
            x >= monitor.x && x < monitor.x + monitor.width &&
            y >= monitor.y && y < monitor.y + monitor.height);
        return index >= 0 ? index : this._validMonitorIndex(this._layoutState.monitorIndex);
    },

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
    },

    _capturePointer(onMotion, onRelease) {
        const grab = this._grabPointer();
        const target = grab ? this._card : global.stage;
        return {
            grab,
            target,
            motionId: target.connect('motion-event', (_actor, event) => onMotion(event)),
            releaseId: target.connect('button-release-event', () => onRelease()),
        };
    },

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
            } catch (error) {
                console.warn(`[Tokidachi] Pointer grab was already released: ${error.message}`);
            }
        }
    },

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
    },

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
    },

    _endDrag() {
        this._releasePointer(this._dragCapture);
        this._dragCapture = null;
        if (this._drag?.moved) {
            this._scheduleStateSave();
            this._scheduleInputAudit();
        }
        this._drag = null;
    },

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
    },

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
    },

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
    },

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
    },

    _endResize() {
        this._releasePointer(this._resizeCapture);
        this._resizeCapture = null;
        this._setResizeCursor(Meta.Cursor.DEFAULT);
        this._resize = null;
    },

    _setResizeCursor(cursor) {
        try {
            global.display.set_cursor(cursor);
        } catch (_error) {
            // Cursor changes are a visual enhancement; resizing still works
            // on Shell versions without this Meta.Display method.
        }
    },

    _setScale(scale) {
        this._layoutState.scale = clamp(scale, this._minimumScale(), this._maximumScale());
        this._card.set_scale(this._layoutState.scale, this._layoutState.scale);
        this._placeWidget();
        this._scheduleStateSave();
    },

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
    },

    _pointInMenu(x, y) {
        if (!this._menu)
            return false;
        const [menuX, menuY] = this._menu.get_transformed_position();
        const [menuWidth, menuHeight] = this._menu.get_transformed_size();
        return x >= menuX && x <= menuX + menuWidth &&
            y >= menuY && y <= menuY + menuHeight;
    },

    _onStageButtonPress(event) {
        if (!this._menuOpen || !this._card)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        if (!this._pointInMenu(x, y))
            this._closeMenu();
        return Clutter.EVENT_PROPAGATE;
    },

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
    },

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

};
