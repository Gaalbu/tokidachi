import Clutter from 'gi://Clutter';
import St from 'gi://St';

export function clamp(value, low, high) {
    return Math.min(high, Math.max(low, Number(value) || 0));
}

export function box(vertical = false, styleClass = '') {
    return new St.BoxLayout({vertical, style_class: styleClass});
}

export function label(text, styleClass = '') {
    return new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
}

export function iconButton(iconName, styleClass, accessibleName) {
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
