// Stand-in for resource:///org/gnome/shell/ui/main.js plus the `global`
// singleton the shell injects. Chrome bookkeeping is strict: an unbalanced
// add/remove or track/untrack throws instead of quietly leaking.

import {Actor} from './actor.js';
import {world} from './world.js';

class Grab {
    constructor(actor, stage) {
        this.actor = actor;
        this._stage = stage;
        this.dismissed = false;
    }

    dismiss() {
        if (this.dismissed)
            throw new Error('Grab.dismiss called twice');
        this.dismissed = true;
        const index = this._stage._grabStack.indexOf(this);
        if (index >= 0)
            this._stage._grabStack.splice(index, 1);
    }
}

class Stage extends Actor {
    constructor() {
        super({width: 1920, height: 1080});
        this._grabStack = [];
    }

    grab(actor) {
        const grab = new Grab(actor, this);
        this._grabStack.push(grab);
        world.grabs.push(grab);
        return grab;
    }

    get activeGrab() {
        return this._grabStack.at(-1) ?? null;
    }

    get_actor_at_pos(_mode, x, y) {
        return typeof world.pick === 'function' ? world.pick(x, y) : world.pick;
    }
}

export const stage = new Stage();
const windowGroup = new Actor();
const uiGroup = new Actor();
const backgroundGroup = new Actor();

uiGroup.add_child(windowGroup);

class LayoutManager extends Actor {
    constructor() {
        super();
        this.uiGroup = uiGroup;
        this._backgroundGroup = backgroundGroup;
        this._chrome = new Map();
        this._tracked = new Set();
    }

    get monitors() {
        return world.monitors;
    }

    get primaryMonitor() {
        return world.monitors[0];
    }

    getWorkAreaForMonitor(index) {
        const custom = world.workAreas?.[index];
        if (custom)
            return custom;
        const monitor = world.monitors[index];
        if (!monitor)
            throw new Error(`getWorkAreaForMonitor: no monitor ${index}`);
        return monitor;
    }

    addChrome(actor, options = {}) {
        if (this._chrome.has(actor))
            throw new Error('addChrome: actor is already chrome');
        this._chrome.set(actor, options);
        uiGroup.add_child(actor);
        world.chromeLog.push(['addChrome', options]);
    }

    removeChrome(actor) {
        if (!this._chrome.has(actor))
            throw new Error('removeChrome: actor is not chrome');
        this._chrome.delete(actor);
        uiGroup.remove_child(actor);
        world.chromeLog.push(['removeChrome']);
    }

    trackChrome(actor, options = {}) {
        if (this._tracked.has(actor))
            throw new Error('trackChrome: actor is already tracked');
        this._tracked.add(actor);
        world.chromeLog.push(['trackChrome', options]);
    }

    untrackChrome(actor) {
        if (!this._tracked.has(actor))
            throw new Error('untrackChrome: actor is not tracked');
        this._tracked.delete(actor);
        world.chromeLog.push(['untrackChrome']);
    }
}

export const layoutManager = new LayoutManager();

globalThis.global = {
    stage,
    window_group: windowGroup,
    display: {
        set_cursor(cursor) {
            world.cursor = cursor;
        },
    },
    get_window_actors() {
        return world.windowActors;
    },
};

export const shellGlobal = globalThis.global;
