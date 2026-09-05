import {Actor} from './actor.js';

class Widget extends Actor {}

class BoxLayout extends Widget {}

class Label extends Widget {
    constructor(props = {}) {
        super({text: '', ...props});
    }
}

class Icon extends Widget {}

class Button extends Widget {
    set_child(child) {
        this.destroy_all_children();
        this.add_child(child);
    }

    get_child() {
        return this.get_children()[0] ?? null;
    }
}

export default {Widget, BoxLayout, Label, Icon, Button};
