/**
 * Geolocation Error Types
 */

import type { GeolocationErrorCodeType } from '@/types';
import { GeolocationErrorCode } from '@/types';

/**
 * Custom error for geolocation failures
 * Provides structured error information for UI handling
 */
export class GeolocationError extends Error {
    constructor(
        message: string,
        public readonly code: GeolocationErrorCodeType,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = 'GeolocationError';
    }

    /** Check if user denied permission */
    isPermissionDenied(): boolean {
        return this.code === GeolocationErrorCode.PERMISSION_DENIED;
    }

    /** Check if this is a timeout error */
    isTimeout(): boolean {
        return this.code === GeolocationErrorCode.TIMEOUT;
    }

    /** Check if geolocation is not supported */
    isNotSupported(): boolean {
        return this.code === GeolocationErrorCode.NOT_SUPPORTED;
    }

    /** Get user-friendly error message */
    getUserMessage(): string {
        switch (this.code) {
            case GeolocationErrorCode.PERMISSION_DENIED:
                return 'Location access was denied. Please enter your postcode instead.';
            case GeolocationErrorCode.POSITION_UNAVAILABLE:
                return 'Could not determine your location. Please enter your postcode.';
            case GeolocationErrorCode.TIMEOUT:
                return 'Location request timed out. Please try again or enter your postcode.';
            case GeolocationErrorCode.NOT_SUPPORTED:
                return 'Your browser does not support location services. Please enter your postcode.';
            case GeolocationErrorCode.POSTCODE_NOT_FOUND:
                return 'Postcode not found. Please check and try again.';
            case GeolocationErrorCode.NETWORK_ERROR:
                return 'Network error. Please check your connection and try again.';
            default:
                return 'An unknown error occurred. Please enter your postcode.';
        }
    }
}
