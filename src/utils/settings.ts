/**
 * User Settings Manager
 * Handles persistence and retrieval of accessibility preferences
 */

const STORAGE_KEYS = {
    textSize: 'cm123go-text-size',
    highContrast: 'cm123go-high-contrast',
    helpSeen: 'cm123go-help-seen',
    colorScheme: 'cm123go-color-scheme',
} as const;

export type TextSize = 'normal' | 'large' | 'xl';
export type ColorScheme = 'light' | 'dark';

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
 * Get saved color scheme preference
 */
function getColorScheme(): ColorScheme {
    const saved = localStorage.getItem(STORAGE_KEYS.colorScheme);
    if (saved === 'light' || saved === 'dark') {
        return saved;
    }
    // Default to system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Save color scheme preference
 */
export function setColorScheme(scheme: ColorScheme): void {
    localStorage.setItem(STORAGE_KEYS.colorScheme, scheme);
}

/**
 * Check if dark mode is currently active
 */
export function isDarkMode(): boolean {
    return getColorScheme() === 'dark';
}

/**
 * Apply dark mode class to body and update theme-color meta tag
 */
export function applyColorScheme(dark: boolean): void {
    document.body.classList.toggle('dark-mode', dark);

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
        themeColorMeta.setAttribute('content', dark ? '#1a1f23' : '#5C6B73');
    }
}

/**
 * Initialize color scheme and listen for system preference changes
 */
function initializeColorScheme(): void {
    applyColorScheme(isDarkMode());

    // Listen for system preference changes when no explicit preference is saved
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!localStorage.getItem(STORAGE_KEYS.colorScheme)) {
            applyColorScheme(isDarkMode());
        }
    });
}

/**
 * Initialize settings from localStorage and apply to DOM
 */
export function initializeSettings(): void {
    applyTextSize(getTextSize());
    applyHighContrast(getHighContrast());
    initializeColorScheme();
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
