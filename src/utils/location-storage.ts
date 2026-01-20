import { Logger } from '@utils/logger';
import type { Coordinates } from '@/types';

const LOCATION_STORAGE_KEY = 'cm123go-last-location';

export interface SavedLocation {
    coordinates: Coordinates;
    postcode?: string;
    timestamp: number;
}

/**
 * Save user location to localStorage
 */
export function saveLocation(coordinates: Coordinates, postcode?: string): void {
    try {
        const savedLocation: SavedLocation = {
            coordinates,
            postcode,
            timestamp: Date.now(),
        };
        localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(savedLocation));
        Logger.debug('Location saved to localStorage', { postcode });
    } catch (error) {
        Logger.warn('Failed to save location', error);
    }
}

/**
 * Retrieve saved location from localStorage
 * Returns null if no location is saved or if it's too old (> 30 days)
 */
export function getSavedLocation(): SavedLocation | null {
    try {
        const saved = localStorage.getItem(LOCATION_STORAGE_KEY);
        if (!saved) {
            return null;
        }

        const location = JSON.parse(saved) as SavedLocation;

        // Check if saved location is too old (30 days)
        const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
        if (Date.now() - location.timestamp > MAX_AGE_MS) {
            Logger.debug('Saved location is too old, ignoring');
            clearSavedLocation();
            return null;
        }

        return location;
    } catch (error) {
        Logger.warn('Failed to retrieve saved location', error);
        return null;
    }
}

/**
 * Clear saved location from localStorage
 */
function clearSavedLocation(): void {
    try {
        localStorage.removeItem(LOCATION_STORAGE_KEY);
        Logger.debug('Saved location cleared');
    } catch (error) {
        Logger.warn('Failed to clear saved location', error);
    }
}
