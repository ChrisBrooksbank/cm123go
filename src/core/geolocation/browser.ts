/**
 * Browser Geolocation API Wrapper
 */

import { Logger } from '@utils/logger';
import { GeolocationError } from './errors';
import type { Coordinates, GeolocationOptions, GeolocationErrorCodeType } from '@/types';
import { GeolocationErrorCode } from '@/types';

/**
 * Check if geolocation is supported in the current browser
 */
export function isGeolocationSupported(): boolean {
    return 'geolocation' in navigator;
}

/**
 * Get current position using Browser Geolocation API
 * Returns a promise that resolves with coordinates
 *
 * @param options - Geolocation options (timeout, accuracy, etc.)
 * @returns Promise resolving to coordinates and accuracy
 * @throws GeolocationError on failure
 */
export function getCurrentPosition(options: GeolocationOptions = {}): Promise<{
    coordinates: Coordinates;
    accuracy: number;
}> {
    return new Promise((resolve, reject) => {
        if (!isGeolocationSupported()) {
            Logger.error('Geolocation API not supported');
            reject(
                new GeolocationError(
                    'Geolocation is not supported by this browser',
                    GeolocationErrorCode.NOT_SUPPORTED
                )
            );
            return;
        }

        const positionOptions: PositionOptions = {
            enableHighAccuracy: options.enableHighAccuracy ?? true,
            timeout: options.timeout ?? 10000,
            maximumAge: options.maximumAge ?? 60000,
        };

        Logger.debug('Requesting browser geolocation', positionOptions);

        navigator.geolocation.getCurrentPosition(
            position => {
                Logger.success('Browser geolocation succeeded', {
                    accuracy: position.coords.accuracy,
                });
                resolve({
                    coordinates: {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                    },
                    accuracy: position.coords.accuracy,
                });
            },
            error => {
                Logger.warn('Browser geolocation failed', {
                    code: error.code,
                    message: error.message,
                });

                let code: GeolocationErrorCodeType = GeolocationErrorCode.POSITION_UNAVAILABLE;
                if (error.code === error.PERMISSION_DENIED) {
                    code = GeolocationErrorCode.PERMISSION_DENIED;
                } else if (error.code === error.TIMEOUT) {
                    code = GeolocationErrorCode.TIMEOUT;
                }

                reject(new GeolocationError(error.message, code));
            },
            positionOptions
        );
    });
}
