import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {configMethods} from './extension-config-methods.js';
import {interactionMethods} from './extension-interaction.js';
import {lifecycleMethods} from './extension-lifecycle.js';
import {renderingMethods} from './extension-rendering.js';
import {uiMethods} from './extension-ui.js';

export default class TokidachiExtension extends Extension {}

Object.assign(TokidachiExtension.prototype,
    lifecycleMethods,
    configMethods,
    uiMethods,
    interactionMethods,
    renderingMethods);
