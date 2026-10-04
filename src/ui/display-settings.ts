/**
 * Display Settings Panel
 * Text size, high contrast and dark mode live in one panel opened from the
 * header, so the header itself only holds the controls used every day
 */

function showDisplaySettings(): void {
    const modal = document.getElementById('display-modal');
    if (!modal) return;

    modal.hidden = false;
    document.getElementById('display-close')?.focus();
}

function hideDisplaySettings(): void {
    const modal = document.getElementById('display-modal');
    if (!modal) return;

    modal.hidden = true;
    document.getElementById('display-btn')?.focus();
}

/**
 * Set up display settings panel event handlers
 */
export function setupDisplaySettingsHandlers(): void {
    document.getElementById('display-btn')?.addEventListener('click', showDisplaySettings);
    document.getElementById('display-close')?.addEventListener('click', hideDisplaySettings);

    const overlay = document.getElementById('display-modal');
    overlay?.addEventListener('click', e => {
        if (e.target === overlay) {
            hideDisplaySettings();
        }
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && overlay && !overlay.hidden) {
            hideDisplaySettings();
        }
    });
}
