import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {box, clamp, label} from './extension-support.js';
import {animationState, providerApiUsage, providerEntries, providerNotices, providerVisuals} from './providerModel.js';

export const renderingMethods = {
    _refresh() {
        if (this._process)
            return;
        this._lastFailureMessage = null;
        this._updated.text = this._t('updating');

        try {
            this._process = Gio.Subprocess.new(
                [`${this.path}/collector`],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            this._process.communicate_utf8_async(null, null, (process, result) => {
                // disable() can run while the collector is still working; the
                // callback then lands on an already destroyed widget tree.
                if (!this._card) {
                    this._process = null;
                    return;
                }
                try {
                    const [, stdout, stderr] = process.communicate_utf8_finish(result);
                    if (!process.get_successful())
                        throw new Error(stderr.trim() || 'collector failed');
                    this._render(JSON.parse(stdout));
                } catch (error) {
                    this._renderFailure(error.message);
                } finally {
                    this._process = null;
                }
            });
        } catch (error) {
            this._process = null;
            this._renderFailure(error.message);
        }
    },

    _render(data) {
        this._lastUsageData = data;
        this._lastFailureMessage = null;
        const current = new Set();
        let visibleProviders = 0;
        for (const [name, provider] of providerEntries(data)) {
            const visuals = providerVisuals(name, provider);
            let view = this._providers.get(name);
            if (!view) {
                view = this._makeProvider(name, visuals);
                this._providers.set(name, view);
                this._providerList.add_child(view.divider);
                this._providerList.add_child(view.container);
            } else {
                view.displayName = visuals.displayName;
                view.color = visuals.color;
                view.petPath = visuals.pet;
                view.nameLabel.text = visuals.displayName;
                this._updatePetIcon(view);
            }
            current.add(name);
            if (this._renderProvider(view, provider))
                visibleProviders++;
        }
        for (const [name, view] of this._providers) {
            if (!current.has(name)) {
                view.container.visible = false;
                this._stopPet(view);
            }
        }
        this._syncDividers();
        const hasProviders = providerEntries(data).length > 0;
        this._hasVisibleProviders = visibleProviders > 0 || hasProviders;
        this._syncPresentation();
        const time = new Date((data.updatedAt ?? Date.now() / 1000) * 1000);
        const formattedTime = time.toLocaleTimeString(this._language,
            {hour: '2-digit', minute: '2-digit'});
        this._updated.text = this._t('updated', {time: formattedTime});
        this._placeWidget();
    },

    _renderProvider(view, provider) {
        view.rows.destroy_all_children();
        const windows = provider.windows ?? [];
        let visible = provider.configured === true || windows.length > 0;
        if (visible && !this._isProviderVisible(view.providerName ?? '')) {
            visible = false;
        }
        view.container.visible = visible;
        if (!visible)
            this._stopPet(view);
        if (!visible)
            return false;
        const status = provider.status === 'ok'
            ? 'ok' : provider.status === 'stale' ? 'stale' : 'attention';
        view.status.style_class = `ai-usage-status-dot ${status}`;
        view.statusLabel.text = status === 'ok'
            ? this._t('connected')
            : status === 'stale' ? this._t('cached') : this._t('needsAttention');
        view.animationState = animationState(provider);

        for (const window of windows)
            view.rows.add_child(this._makeUsageRow(window, view.color));

        for (const notice of providerNotices(provider))
            view.rows.add_child(label(notice, 'ai-usage-provider-status'));

        const apiUsage = providerApiUsage(provider);
        if (apiUsage) {
            view.rows.add_child(label(this._t('apiEstimatedCost', apiUsage),
                'ai-usage-provider-status'));
        }

        if (windows.length > 0 && provider.message) {
            view.rows.add_child(label(String(provider.message).slice(0, 120),
                'ai-usage-error'));
        }

        if (windows.length === 0) {
            view.rows.add_child(label(provider.message || this._t('noUsageWindow'),
                'ai-usage-error'));
        }
        return true;
    },

    _makeUsageRow(window, color) {
        if (window.kind === 'count') {
            const container = box(true, 'ai-usage-row');
            const line = box(false);
            line.add_child(label(this._t('countLabel', {label: window.label, count: window.count}), 'ai-usage-row-label'));
            container.add_child(line);
            if (window.resetLabel)
                container.add_child(label(window.resetLabel, 'ai-usage-provider-status'));
            return container;
        }
        const usedPercent = Math.round(clamp(window.usedPercent, 0, 100));
        const container = box(true, 'ai-usage-row');
        const line = box(false);
        line.add_child(label(window.label, 'ai-usage-row-label'));
        line.add_child(new St.Widget({x_expand: true}));
        line.add_child(label(`${usedPercent}%`, 'ai-usage-row-value'));
        container.add_child(line);

        const track = new St.Widget({style_class: 'ai-usage-bar'});
        const fill = new St.Widget({
            style_class: 'ai-usage-bar-fill',
            style: `background-color: ${color};`,
        });
        track.add_child(fill);
        const updateFillWidth = () => {
            fill.width = Math.round(track.width * usedPercent / 100);
        };
        track.connect('notify::width', updateFillWidth);
        updateFillWidth();
        container.add_child(track);

        if (window.resetLabel)
            container.add_child(label(window.resetLabel, 'ai-usage-provider-status'));
        return container;
    },

    _renderFailure(message) {
        const safeMessage = String(message).slice(0, 120);
        this._lastFailureMessage = safeMessage;
        this._updated.text = this._t('offline');
        let visibleProviders = 0;
        for (const provider of this._providers.values()) {
            if (!provider.container.visible)
                continue;
            visibleProviders++;
            provider.rows.destroy_all_children();
            provider.rows.add_child(label(safeMessage, 'ai-usage-error'));
            provider.status.style_class = 'ai-usage-status-dot attention';
            provider.statusLabel.text = this._t('needsAttention');
            provider.animationState = 'attention';
        }
        this._syncDividers();
        this._hasVisibleProviders = visibleProviders > 0;
        this._syncPresentation();
        this._placeWidget();
    },

    _syncDividers() {
        let hasVisibleProvider = false;
        for (const provider of this._providers.values()) {
            provider.divider.visible = provider.container.visible && hasVisibleProvider;
            if (provider.container.visible)
                hasVisibleProvider = true;
        }
    },

    _updatePetIcon(provider) {
        provider.petActor.visible = provider.petPath !== null;
        if (!provider.petPath)
            return;
        provider.petActor.gicon = new Gio.FileIcon({
            file: Gio.File.new_for_path(`${this.path}/${provider.petPath}`),
        });
    },

    _syncPetAnimations() {
        for (const provider of this._providers?.values() ?? [])
            this._syncPetAnimation(provider);
    },

    _syncPetAnimation(provider) {
        this._stopPet(provider);
        if (this._config.petAnimations !== true || this._state.minimized ||
            !provider.container.visible || !provider.petActor.visible)
            return;
        const generation = provider.animationGeneration;
        this._animatePetStep(provider, generation, true);
    },

    _animatePetStep(provider, generation, forward) {
        if (generation !== provider.animationGeneration || this._state.minimized ||
            this._config.petAnimations !== true || !provider.container.visible)
            return;
        const target = this._petAnimationTarget(provider.animationState, forward);
        provider.petActor.ease({
            ...target,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            onComplete: () => this._animatePetStep(provider, generation, !forward),
        });
    },

    _petAnimationTarget(state, forward) {
        if (state === 'high') {
            return {
                translation_x: forward ? 3 : -3,
                translation_y: forward ? -1 : 1,
                rotation_angle_z: forward ? 4 : -4,
                duration: 220,
            };
        }
        if (state === 'attention') {
            return {
                translation_x: 0,
                translation_y: forward ? -4 : 0,
                rotation_angle_z: forward ? 7 : -7,
                duration: 500,
            };
        }
        return {
            translation_x: 0,
            translation_y: forward ? -3 : 0,
            rotation_angle_z: forward ? 2 : -2,
            duration: 1300,
        };
    },

    _stopPet(provider) {
        provider.animationGeneration++;
        provider.petActor.remove_all_transitions();
        provider.petActor.translation_x = 0;
        provider.petActor.translation_y = 0;
        provider.petActor.rotation_angle_z = 0;
    }
};
