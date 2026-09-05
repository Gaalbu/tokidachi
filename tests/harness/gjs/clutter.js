import {Actor} from './actor.js';

const Clutter = {
    Actor,
    BinLayout: class BinLayout {},
    EVENT_PROPAGATE: false,
    EVENT_STOP: true,
    ActorAlign: {FILL: 0, START: 1, CENTER: 2, END: 3},
    AnimationMode: {EASE_IN_OUT_SINE: 'ease-in-out-sine'},
    PickMode: {NONE: 0, REACTIVE: 1, ALL: 2},
    ScrollDirection: {UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right', SMOOTH: 'smooth'},
};

export default Clutter;
