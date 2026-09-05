import {Actor} from './actor.js';

export class WindowActor extends Actor {
    constructor(metaWindow) {
        super();
        this.meta_window = metaWindow;
    }
}

export class Window {
    constructor({type, frame, wmClass = 'unknown', title = '', minimized = false}) {
        this._type = type;
        this._frame = frame;
        this._wmClass = wmClass;
        this._title = title;
        this.minimized = minimized;
    }

    get_window_type() {
        return this._type;
    }

    get_frame_rect() {
        return this._frame;
    }

    get_wm_class() {
        return this._wmClass;
    }

    get_title() {
        return this._title;
    }
}

export default {
    WindowActor,
    Window,
    Display: class Display {},
    WindowType: {NORMAL: 'normal', DESKTOP: 'desktop', DOCK: 'dock'},
    Cursor: {DEFAULT: 'default', SE_RESIZE: 'se-resize'},
};
