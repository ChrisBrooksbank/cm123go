/**
 * Favorites Manager
 * Handles localStorage persistence for favorite bus stops and train stations
 */

const BUS_FAVORITES_KEY = 'cm123go-favorite-stops';
const TRAIN_FAVORITES_KEY = 'cm123go-favorite-stations';

interface FavoriteStop {
    atcoCode: string;
    addedAt: number;
}

interface FavoriteStation {
    crsCode: string;
    addedAt: number;
}

/**
 * Manages favorite bus stops in localStorage
 */
export const FavoritesManager = {
    /**
     * Get all favorite bus stops
     */
    getAll(): FavoriteStop[] {
        try {
            const raw = localStorage.getItem(BUS_FAVORITES_KEY);
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
     * Check if a bus stop is favorited
     */
    isFavorite(atcoCode: string): boolean {
        return this.getAll().some(f => f.atcoCode === atcoCode);
    },

    /**
     * Add a bus stop to favorites
     */
    add(atcoCode: string): void {
        const favorites = this.getAll().filter(f => f.atcoCode !== atcoCode);
        favorites.push({ atcoCode, addedAt: Date.now() });
        localStorage.setItem(BUS_FAVORITES_KEY, JSON.stringify(favorites));
    },

    /**
     * Remove a bus stop from favorites
     */
    remove(atcoCode: string): void {
        const favorites = this.getAll().filter(f => f.atcoCode !== atcoCode);
        localStorage.setItem(BUS_FAVORITES_KEY, JSON.stringify(favorites));
    },

    /**
     * Toggle bus stop favorite status
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

    // Train station favorites

    /**
     * Get all favorite train stations
     */
    getAllStations(): FavoriteStation[] {
        try {
            const raw = localStorage.getItem(TRAIN_FAVORITES_KEY);
            if (!raw) return [];
            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed as FavoriteStation[];
        } catch {
            return [];
        }
    },

    /**
     * Get set of favorite CRS codes for fast lookup
     */
    getCrsCodes(): Set<string> {
        return new Set(this.getAllStations().map(f => f.crsCode));
    },

    /**
     * Check if a train station is favorited
     */
    isStationFavorite(crsCode: string): boolean {
        return this.getAllStations().some(f => f.crsCode === crsCode);
    },

    /**
     * Add a train station to favorites
     */
    addStation(crsCode: string): void {
        const favorites = this.getAllStations().filter(f => f.crsCode !== crsCode);
        favorites.push({ crsCode, addedAt: Date.now() });
        localStorage.setItem(TRAIN_FAVORITES_KEY, JSON.stringify(favorites));
    },

    /**
     * Remove a train station from favorites
     */
    removeStation(crsCode: string): void {
        const favorites = this.getAllStations().filter(f => f.crsCode !== crsCode);
        localStorage.setItem(TRAIN_FAVORITES_KEY, JSON.stringify(favorites));
    },

    /**
     * Toggle train station favorite status
     * @returns true if now favorited, false if unfavorited
     */
    toggleStation(crsCode: string): boolean {
        if (this.isStationFavorite(crsCode)) {
            this.removeStation(crsCode);
            return false;
        }
        this.addStation(crsCode);
        return true;
    },
};
