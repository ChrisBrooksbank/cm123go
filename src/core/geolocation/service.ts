/**
 * Geolocation Service
 * Main service for acquiring user location
 */

import { Logger } from '@utils/logger';
import { getConfig } from '@config/index';
import { getCurrentPosition, isGeolocationSupported } from './browser';
import { GeolocationError } from './errors';
import { geocodePostcode } from '@api/geocoding';
import type { Location, GeolocationOptions, Coordinates } from '@/types';
import { LocationSchema, GeolocationErrorCode } from '@/types';

/**
 * Result type for location acquisition
 */
type LocationResult =
    | { success: true; location: Location }
    | { success: false; error: GeolocationError; requiresManualEntry: boolean };

function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/**
 * GeolocationService - Main service for acquiring user location
 *
 * Provides methods for:
 * - Getting location via browser Geolocation API
 * - Getting location via UK postcode lookup
 * - Checking capability support
 */
export const GeolocationService = {
    /**
     * Check if browser geolocation is available
     */
    isSupported(): boolean {
        return isGeolocationSupported();
    },

    /**
     * Get user's current location using browser Geolocation API
     *
     * This is a one-time fetch, not continuous tracking.
     * Uses high accuracy mode by default for best results on mobile.
     *
     * @param options - Override default geolocation options
     * @returns LocationResult with location or error details
     */
    async getLocationFromBrowser(options?: Partial<GeolocationOptions>): Promise<LocationResult> {
        const config = getConfig();
        const defaultOptions: GeolocationOptions = {
            enableHighAccuracy: config.geolocation.enableHighAccuracy,
            timeout: config.geolocation.timeout,
            maximumAge: config.geolocation.maximumAge,
        };

        const mergedOptions = { ...defaultOptions, ...options };

        Logger.info('Requesting location from browser', mergedOptions);

        try {
            const result = await getCurrentPosition(mergedOptions);

            const location: Location = {
                coordinates: result.coordinates,
                accuracy: result.accuracy,
                source: result.accuracy < 100 ? 'gps' : 'network',
                timestamp: Date.now(),
            };

            // Validate with Zod
            const validated = LocationSchema.safeParse(location);
            if (!validated.success) {
                Logger.error('Location validation failed', validated.error);
                throw new GeolocationError(
                    'Invalid location data',
                    GeolocationErrorCode.POSITION_UNAVAILABLE
                );
            }

            Logger.success('Location acquired from browser', {
                source: location.source,
                accuracy: location.accuracy,
            });

            return { success: true, location: validated.data };
        } catch (error) {
            const geoError =
                error instanceof GeolocationError
                    ? error
                    : new GeolocationError(
                          String(error),
                          GeolocationErrorCode.POSITION_UNAVAILABLE
                      );

            Logger.warn('Browser geolocation failed', {
                code: geoError.code,
                message: geoError.message,
            });

            return {
                success: false,
                error: geoError,
                requiresManualEntry: true,
            };
        }
    },

    /**
     * Get location from a UK postcode
     *
     * @param postcode - UK postcode (e.g., "CM1 1AB")
     * @returns LocationResult with location or error details
     */
    async getLocationFromPostcode(postcode: string): Promise<LocationResult> {
        Logger.info('Getting location from postcode', { postcode });

        try {
            const result = await geocodePostcode(postcode);

            const location: Location = {
                coordinates: result.coordinates,
                source: 'postcode',
                timestamp: Date.now(),
                postcode: result.normalizedPostcode,
            };

            // Validate with Zod
            const validated = LocationSchema.safeParse(location);
            if (!validated.success) {
                Logger.error('Location validation failed', validated.error);
                throw new GeolocationError(
                    'Invalid location data',
                    GeolocationErrorCode.POSTCODE_NOT_FOUND
                );
            }

            Logger.success('Location acquired from postcode', {
                postcode: result.normalizedPostcode,
            });

            return { success: true, location: validated.data };
        } catch (error) {
            const geoError =
                error instanceof GeolocationError
                    ? error
                    : new GeolocationError(String(error), GeolocationErrorCode.NETWORK_ERROR);

            Logger.warn('Postcode geocoding failed', {
                code: geoError.code,
                message: geoError.message,
            });

            return {
                success: false,
                error: geoError,
                requiresManualEntry: true,
            };
        }
    },

    /**
     * Get location with automatic fallback indication
     *
     * Tries browser geolocation first, then signals if manual entry is needed.
     * This method does NOT automatically fall back to postcode - it returns
     * an indication that manual entry is required.
     *
     * @param options - Geolocation options
     * @returns LocationResult
     */
    async getLocation(options?: Partial<GeolocationOptions>): Promise<LocationResult> {
        // Try browser geolocation first
        const browserResult = await this.getLocationFromBrowser(options);

        if (browserResult.success) {
            return browserResult;
        }

        // Return the error with flag indicating manual entry needed
        Logger.info('Browser geolocation failed, manual entry required');
        return browserResult;
    },

    /**
     * Calculate distance between two coordinates (Haversine formula)
     * Returns distance in meters
     */
    calculateDistance(from: Coordinates, to: Coordinates): number {
        const R = 6371000; // Earth radius in meters
        const dLat = toRadians(to.latitude - from.latitude);
        const dLon = toRadians(to.longitude - from.longitude);
        const lat1 = toRadians(from.latitude);
        const lat2 = toRadians(to.latitude);

        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    },
};
