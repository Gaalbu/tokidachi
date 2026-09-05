// Maps the GJS and GNOME Shell import specifiers used by extension.js onto
// the stub modules in this directory, so the extension can be imported and
// exercised by node:test without a running shell.
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const stubs = new Map([
    ['gi://Clutter', 'gjs/clutter.js'],
    ['gi://Gio', 'gjs/gio.js'],
    ['gi://GLib', 'gjs/glib.js'],
    ['gi://Meta', 'gjs/meta.js'],
    ['gi://St', 'gjs/st.js'],
    ['resource:///org/gnome/shell/ui/main.js', 'gjs/main.js'],
    ['resource:///org/gnome/shell/extensions/extension.js', 'gjs/extension.js'],
]);

export async function resolve(specifier, context, nextResolve) {
    const stub = stubs.get(specifier);
    if (stub)
        return {url: pathToFileURL(path.join(here, stub)).href, shortCircuit: true};
    return nextResolve(specifier, context);
}
