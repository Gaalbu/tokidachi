import fs from 'node:fs';
import nodePath from 'node:path';

import {world} from './world.js';

export class FileErrorEnum extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }

    matches(domain, code) {
        return domain === FileError && code === this.code;
    }
}

export const FileError = {NOENT: 'noent'};

const GLib = {
    PRIORITY_DEFAULT: 0,
    PRIORITY_DEFAULT_IDLE: 200,
    SOURCE_REMOVE: false,
    SOURCE_CONTINUE: true,
    FileError,

    get_user_config_dir() {
        return world.configDir;
    },

    get_language_names() {
        return world.languages;
    },

    build_filenamev(parts) {
        return nodePath.join(...parts);
    },

    path_get_dirname(target) {
        return nodePath.dirname(target);
    },

    mkdir_with_parents(directory, _mode) {
        fs.mkdirSync(directory, {recursive: true});
        return 0;
    },

    chmod(target, mode) {
        fs.chmodSync(target, mode);
        return 0;
    },

    file_get_contents(target) {
        if (!fs.existsSync(target))
            throw new FileErrorEnum(FileError.NOENT, `No such file: ${target}`);
        return [true, new Uint8Array(fs.readFileSync(target))];
    },

    file_set_contents(target, contents) {
        fs.writeFileSync(target, contents);
        return true;
    },

    timeout_add(_priority, interval, callback) {
        const id = world.nextTimerId++;
        world.timers.set(id, {deadline: world.now + interval, interval, callback});
        return id;
    },

    timeout_add_seconds(priority, seconds, callback) {
        return GLib.timeout_add(priority, seconds * 1000, callback);
    },

    idle_add(_priority, callback) {
        const id = world.nextTimerId++;
        world.timers.set(id, {deadline: world.now, interval: 0, callback});
        return id;
    },

    source_remove(id) {
        if (!world.timers.has(id))
            throw new Error(`source_remove: unknown source ${id}`);
        world.timers.delete(id);
        return true;
    },
};

export default GLib;
