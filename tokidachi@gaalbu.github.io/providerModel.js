const FALLBACK_COLORS = ['#4f8cff', '#d97757', '#8b5cf6', '#16a085', '#d19a00'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const PET_PATH = /^pets\/[a-z0-9_-]+\.svg$/;

export function providerEntries(data) {
    const providers = data?.providers;
    if (!providers || typeof providers !== 'object' || Array.isArray(providers))
        return [];
    return Object.entries(providers)
        .filter(([name, provider]) => name.length > 0 && provider &&
            typeof provider === 'object' && !Array.isArray(provider));
}

export function providerVisuals(name, provider) {
    const requestedName = typeof provider.displayName === 'string'
        ? provider.displayName.trim() : '';
    const requestedColor = typeof provider.color === 'string' ? provider.color : '';
    const requestedPet = typeof provider.pet === 'string' ? provider.pet : '';
    return {
        displayName: (requestedName || title(name)).slice(0, 40),
        color: HEX_COLOR.test(requestedColor) ? requestedColor : fallbackColor(name),
        pet: PET_PATH.test(requestedPet) ? requestedPet : null,
    };
}

export function animationState(provider) {
    if (provider?.status !== 'ok' && provider?.status !== 'stale')
        return 'attention';
    let highestUsage = 0;
    for (const window of Array.isArray(provider?.windows) ? provider.windows : [])
        highestUsage = Math.max(highestUsage, Number(window?.usedPercent) || 0);
    return highestUsage > 80 ? 'high' : 'idle';
}

function fallbackColor(name) {
    let hash = 0;
    for (const character of name)
        hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

function title(value) {
    return value.length === 0 ? 'Provider' : value[0].toUpperCase() + value.slice(1);
}
