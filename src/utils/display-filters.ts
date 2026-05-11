/**
 * Display filter persistence for departure boards
 */

const DISPLAY_FILTERS_KEY = 'cm123go-display-filters';

export interface DisplayFilters {
    bus: boolean;
    train: boolean;
}

export const DEFAULT_DISPLAY_FILTERS: DisplayFilters = {
    bus: true,
    train: true,
};

function isDisplayFilters(value: unknown): value is DisplayFilters {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Record<string, unknown>;
    return typeof candidate.bus === 'boolean' && typeof candidate.train === 'boolean';
}

/**
 * Get saved display filters, defaulting to all transport types visible
 */
export function getDisplayFilters(): DisplayFilters {
    const saved = localStorage.getItem(DISPLAY_FILTERS_KEY);
    if (!saved) {
        return { ...DEFAULT_DISPLAY_FILTERS };
    }

    try {
        const parsed: unknown = JSON.parse(saved);
        if (isDisplayFilters(parsed)) {
            return parsed;
        }
    } catch {
        // Ignore malformed saved filters and fall back to defaults.
    }

    return { ...DEFAULT_DISPLAY_FILTERS };
}

/**
 * Save display filters for future sessions
 */
export function setDisplayFilters(filters: DisplayFilters): void {
    localStorage.setItem(DISPLAY_FILTERS_KEY, JSON.stringify(filters));
}
