// Runs under the real GJS/GNOME introspection data, not the node harness:
// verifies every Clutter, Meta and St symbol the extension depends on exists
// in the GNOME version installed on this machine. Run via scripts/gjs-test.sh.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

let failures = 0;

function check(description, value) {
    const ok = value !== undefined && value !== null;
    if (!ok)
        failures++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${description}`);
}

// Pointer grabs: what keeps dragging and resizing alive when another window
// covers the widget.
check('Clutter.Stage.grab', Clutter.Stage.prototype.grab);
check('Clutter.Grab.dismiss', Clutter.Grab.prototype.dismiss);

// Layer conflict detection.
check('Clutter.Stage.get_actor_at_pos', Clutter.Stage.prototype.get_actor_at_pos);
check('Clutter.PickMode.REACTIVE', Clutter.PickMode.REACTIVE);
check('Meta.WindowActor', Meta.WindowActor);
check('Meta.WindowType.DESKTOP', Meta.WindowType.DESKTOP);
check('Meta.Window.get_window_type', Meta.Window.prototype.get_window_type);
check('Meta.Window.get_frame_rect', Meta.Window.prototype.get_frame_rect);
check('Meta.Window.get_wm_class', Meta.Window.prototype.get_wm_class);
check('Meta.Window.get_title', Meta.Window.prototype.get_title);

// Widget tree and placement.
check('Clutter.Actor.set_child_above_sibling', Clutter.Actor.prototype.set_child_above_sibling);
check('Clutter.Actor.get_transformed_position', Clutter.Actor.prototype.get_transformed_position);
check('Clutter.Actor.get_transformed_size', Clutter.Actor.prototype.get_transformed_size);
check('Clutter.BinLayout', Clutter.BinLayout);
check('Clutter.ActorAlign.END', Clutter.ActorAlign.END);
check('Clutter.AnimationMode.EASE_IN_OUT_SINE', Clutter.AnimationMode.EASE_IN_OUT_SINE);
check('Clutter.ScrollDirection.SMOOTH', Clutter.ScrollDirection.SMOOTH);
check('Meta.Cursor.SE_RESIZE', Meta.Cursor.SE_RESIZE);
check('Meta.Cursor.DEFAULT', Meta.Cursor.DEFAULT);
check('Meta.Display.set_cursor', Meta.Display.prototype.set_cursor);
check('St.Widget', St.Widget);
check('St.BoxLayout', St.BoxLayout);
check('St.Button', St.Button);
check('St.Icon', St.Icon);
check('St.Label', St.Label);

// Storage and the collector process.
check('GLib.file_get_contents', GLib.file_get_contents);
check('GLib.file_set_contents', GLib.file_set_contents);
check('GLib.FileError.NOENT', GLib.FileError.NOENT);
check('Gio.Subprocess.new', Gio.Subprocess.new);
check('Gio.FileIcon', Gio.FileIcon);

// The NOENT guard both state readers rely on must actually match.
try {
    GLib.file_get_contents('/nonexistent/tokidachi/state.json');
    print('FAIL GLib.file_get_contents throws on a missing file');
    failures++;
} catch (error) {
    check('GLib file error matches FileError.NOENT',
        error.matches(GLib.FileError, GLib.FileError.NOENT) || null);
}

print(failures === 0
    ? `# all ${'checks'} passed on GNOME introspection data`
    : `# ${failures} failing checks`);
if (failures > 0)
    imports.system.exit(1);
