/**
 * User Settings Manager
 * Handles persistence and retrieval of accessibility preferences
 */

const STORAGE_KEYS = {
    textSize: 'cm123go-text-size',
    highContrast: 'cm123go-high-contrast',
    soundEnabled: 'cm123go-sound-enabled',
    helpSeen: 'cm123go-help-seen',
} as const;

export type TextSize = 'normal' | 'large' | 'xl';

/**
 * Get saved text size preference
 */
export function getTextSize(): TextSize {
    const saved = localStorage.getItem(STORAGE_KEYS.textSize);
    if (saved === 'large' || saved === 'xl') {
        return saved;
    }
    return 'normal';
}

/**
 * Save text size preference
 */
export function setTextSize(size: TextSize): void {
    localStorage.setItem(STORAGE_KEYS.textSize, size);
}

/**
 * Get high contrast mode preference
 */
export function getHighContrast(): boolean {
    // Check user preference first, then system preference
    const saved = localStorage.getItem(STORAGE_KEYS.highContrast);
    if (saved !== null) {
        return saved === 'true';
    }
    // Check system preference
    return window.matchMedia('(prefers-contrast: more)').matches;
}

/**
 * Save high contrast preference
 */
export function setHighContrast(enabled: boolean): void {
    localStorage.setItem(STORAGE_KEYS.highContrast, String(enabled));
}

/**
 * Get sound/vibration preference (internal use)
 */
function getSoundEnabled(): boolean {
    return localStorage.getItem(STORAGE_KEYS.soundEnabled) === 'true';
}

/**
 * Check if help has been seen
 */
export function getHelpSeen(): boolean {
    return localStorage.getItem(STORAGE_KEYS.helpSeen) === 'true';
}

/**
 * Mark help as seen
 */
export function setHelpSeen(): void {
    localStorage.setItem(STORAGE_KEYS.helpSeen, 'true');
}

/**
 * Apply text size class to body
 */
export function applyTextSize(size: TextSize): void {
    document.body.classList.remove('text-size-normal', 'text-size-large', 'text-size-xl');
    document.body.classList.add(`text-size-${size}`);
}

/**
 * Apply high contrast class to body
 */
export function applyHighContrast(enabled: boolean): void {
    document.body.classList.toggle('high-contrast', enabled);
}

/**
 * Initialize settings from localStorage and apply to DOM
 */
export function initializeSettings(): void {
    applyTextSize(getTextSize());
    applyHighContrast(getHighContrast());
}

/**
 * Trigger haptic feedback if enabled and supported
 */
export function triggerHapticFeedback(duration: number = 50): void {
    if (getSoundEnabled() && 'vibrate' in navigator) {
        navigator.vibrate(duration);
    }
}
