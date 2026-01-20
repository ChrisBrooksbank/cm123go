/**
 * Favorites Manager
 * Handles localStorage persistence for favorite bus stops
 */

const FAVORITES_KEY = 'cm123go-favorite-stops';

interface FavoriteStop {
    atcoCode: string;
    addedAt: number;
}

/**
 * Manages favorite bus stops in localStorage
 */
export const FavoritesManager = {
    /**
     * Get all favorite stops
     */
    getAll(): FavoriteStop[] {
        try {
            const raw = localStorage.getItem(FAVORITES_KEY);
            if (!raw) return [];
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed as FavoriteStop[];
        } catch {
            return [];
        }
    },

    /**
     * Get set of favorite ATCOcodes for fast lookup
     */
    getAtcoCodes(): Set<string> {
        return new Set(this.getAll().map(f => f.atcoCode));
    },

    /**
     * Check if a stop is favorited
     */
    isFavorite(atcoCode: string): boolean {
        return this.getAll().some(f => f.atcoCode === atcoCode);
    },

    /**
     * Add a stop to favorites
     */
    add(atcoCode: string): void {
        const favorites = this.getAll().filter(f => f.atcoCode !== atcoCode);
        favorites.push({ atcoCode, addedAt: Date.now() });
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    },

    /**
     * Remove a stop from favorites
     */
    remove(atcoCode: string): void {
        const favorites = this.getAll().filter(f => f.atcoCode !== atcoCode);
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    },

    /**
     * Toggle favorite status
     * @returns true if now favorited, false if unfavorited
     */
    toggle(atcoCode: string): boolean {
        if (this.isFavorite(atcoCode)) {
            this.remove(atcoCode);
            return false;
        }
        this.add(atcoCode);
        return true;
    },
};
