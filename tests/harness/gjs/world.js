// Shared, resettable state for the fake compositor. Tests drive the shell
// through this module; the stub gi:// modules only read from it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const world = {
    configDir: null,
    languages: ['en_US.UTF-8'],
    timers: new Map(),
    nextTimerId: 1,
    now: 0,
    windowActors: [],
    pick: null,
    cursor: null,
    chromeLog: [],
    grabs: [],
    warnings: [],
    subprocess: null,
    monitors: [{x: 0, y: 0, width: 1920, height: 1080}],
    workAreas: null,
};

export function resetWorld() {
    if (world.configDir)
        fs.rmSync(world.configDir, {recursive: true, force: true});
    world.configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokidachi-test-'));
    world.languages = ['en_US.UTF-8'];
    world.timers = new Map();
    world.nextTimerId = 1;
    world.now = 0;
    world.windowActors = [];
    world.pick = null;
    world.cursor = null;
    world.chromeLog = [];
    world.grabs = [];
    world.warnings = [];
    world.subprocess = null;
    world.monitors = [{x: 0, y: 0, width: 1920, height: 1080}];
    world.workAreas = null;
}

// Fires every timer whose deadline has passed, repeatedly, so chained
// timeouts settle. Guarded against timers that re-arm themselves forever.
export function advance(milliseconds) {
    world.now += milliseconds;
    for (let round = 0; round < 100; round++) {
        const due = [...world.timers.entries()]
            .filter(([, timer]) => timer.deadline <= world.now)
            .sort((a, b) => a[1].deadline - b[1].deadline);
        if (due.length === 0)
            return;
        for (const [id, timer] of due) {
            if (!world.timers.has(id))
                continue;
            const keep = timer.callback();
            if (keep === true && world.timers.has(id))
                world.timers.set(id, {...timer, deadline: world.now + timer.interval});
            else
                world.timers.delete(id);
        }
    }
    throw new Error('advance: timers did not settle');
}

export function pendingTimers() {
    return world.timers.size;
}
