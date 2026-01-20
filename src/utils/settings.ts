/**
 * User Settings Manager
 * Handles persistence and retrieval of accessibility preferences
 */

const STORAGE_KEYS = {
    textSize: 'cm123go-text-size',
    highContrast: 'cm123go-high-contrast',
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
 * Apply text size class to html element (so rem units scale)
 */
export function applyTextSize(size: TextSize): void {
    document.documentElement.classList.remove(
        'text-size-normal',
        'text-size-large',
        'text-size-xl'
    );
    document.documentElement.classList.add(`text-size-${size}`);
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
 * Trigger haptic feedback if supported
 * Always tries to vibrate - browsers handle unsupported gracefully
 */
export function triggerHapticFeedback(duration: number = 50): void {
    if ('vibrate' in navigator) {
        navigator.vibrate(duration);
    }
}
