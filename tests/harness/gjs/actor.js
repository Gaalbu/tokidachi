// Minimal Clutter/St actor model: enough of the object graph for extension.js
// to build its widget tree, move it between parents, and route signals.

let nextHandlerId = 1;

export class Actor {
    // GJS exposes the GObject type on the constructor; _describeActor reads it.
    static get $gtype() {
        return {name: this.name};
    }

    constructor(props = {}) {
        this._children = [];
        this._parent = null;
        this._handlers = new Map();
        this._transitions = 0;
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.scale_x = 1;
        this.scale_y = 1;
        this.translation_x = 0;
        this.translation_y = 0;
        this.rotation_angle_z = 0;
        this.visible = true;
        this.reactive = false;
        this.track_hover = false;
        this.can_focus = false;
        this.style_class = '';
        this.name = '';
        this.destroyed = false;
        Object.assign(this, props);
    }

    add_child(child) {
        if (child._parent)
            child._parent.remove_child(child);
        child._parent = this;
        this._children.push(child);
    }

    remove_child(child) {
        const index = this._children.indexOf(child);
        if (index < 0)
            throw new Error('remove_child: actor is not a child of this actor');
        this._children.splice(index, 1);
        child._parent = null;
    }

    set_child_above_sibling(child, sibling) {
        const index = this._children.indexOf(child);
        if (index < 0)
            throw new Error('set_child_above_sibling: unknown child');
        this._children.splice(index, 1);
        if (sibling === null) {
            this._children.push(child);
            return;
        }
        this._children.splice(this._children.indexOf(sibling) + 1, 0, child);
    }

    get_parent() {
        return this._parent;
    }

    get_children() {
        return [...this._children];
    }

    get_name() {
        return this.name;
    }

    destroy_all_children() {
        for (const child of [...this._children])
            child.destroy();
    }

    destroy() {
        this.destroy_all_children();
        if (this._parent)
            this._parent.remove_child(this);
        this.destroyed = true;
        this.emit('destroy');
        this._handlers.clear();
    }

    add_style_class_name(name) {
        const classes = new Set(String(this.style_class).split(' ').filter(Boolean));
        classes.add(name);
        this.style_class = [...classes].join(' ');
    }

    remove_style_class_name(name) {
        this.style_class = String(this.style_class).split(' ')
            .filter(entry => entry && entry !== name).join(' ');
    }

    set_position(x, y) {
        this.x = x;
        this.y = y;
    }

    set_scale(x, y) {
        this.scale_x = x;
        this.scale_y = y;
    }

    set_pivot_point() {}

    set_size(width, height) {
        this.width = width;
        this.height = height;
        this.emit('notify::width');
        this.emit('notify::height');
    }

    get_transformed_position() {
        let [x, y] = [this.x, this.y];
        for (let node = this._parent; node; node = node._parent) {
            x += node.x;
            y += node.y;
        }
        return [x, y];
    }

    // An unmapped actor has no allocation, which is what a real shell reports
    // for a hidden widget (and what makes the layer audit a no-op then).
    get_transformed_size() {
        let [scaleX, scaleY] = [this.scale_x, this.scale_y];
        for (let node = this; node; node = node._parent) {
            if (!node.visible)
                return [0, 0];
        }
        for (let node = this._parent; node; node = node._parent) {
            scaleX *= node.scale_x;
            scaleY *= node.scale_y;
        }
        return [this.width * scaleX, this.height * scaleY];
    }

    connect(signal, callback) {
        const id = nextHandlerId++;
        this._handlers.set(id, {signal, callback});
        return id;
    }

    disconnect(id) {
        if (!this._handlers.has(id))
            throw new Error(`disconnect: no handler ${id}`);
        this._handlers.delete(id);
    }

    handlerCount(signal) {
        return [...this._handlers.values()]
            .filter(handler => !signal || handler.signal === signal).length;
    }

    emit(signal, ...args) {
        let result;
        for (const handler of [...this._handlers.values()]) {
            if (handler.signal !== signal)
                continue;
            result = handler.callback(this, ...args);
            if (result === true)
                return result;
        }
        return result;
    }

    // Animations resolve to their end state immediately; onComplete is not
    // chained so the pet animation loop cannot spin inside a test.
    ease(target) {
        this._transitions++;
        for (const [key, value] of Object.entries(target)) {
            if (['mode', 'duration', 'onComplete'].includes(key))
                continue;
            this[key] = value;
        }
    }

    remove_all_transitions() {
        this._transitions = 0;
    }
}
