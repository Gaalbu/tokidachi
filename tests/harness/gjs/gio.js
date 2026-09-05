import {world} from './world.js';

class Subprocess {
    constructor(argv) {
        this.argv = argv;
        this._plan = world.subprocess;
    }

    communicate_utf8_async(_stdin, _cancellable, callback) {
        queueMicrotask(() => callback(this, 'result'));
    }

    communicate_utf8_finish(_result) {
        return [true, this._plan?.stdout ?? '', this._plan?.stderr ?? ''];
    }

    get_successful() {
        return this._plan?.successful !== false;
    }

    force_exit() {
        this.killed = true;
    }
}

export default {
    Subprocess: {
        new(argv, _flags) {
            if (world.subprocess === null)
                throw new Error('collector is not installed');
            return new Subprocess(argv);
        },
    },
    SubprocessFlags: {STDOUT_PIPE: 1, STDERR_PIPE: 2},
    File: {new_for_path: path => ({path})},
    FileIcon: class FileIcon {
        constructor({file}) {
            this.file = file;
        }
    },
};
