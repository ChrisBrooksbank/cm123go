/**
 * Bus Stop Error Types
 */

import type { BusStopErrorCodeType } from '@/types';
import { BusStopErrorCode } from '@/types';

/**
 * Custom error for bus stop failures
 * Provides structured error information for UI handling
 */
export class BusStopError extends Error {
    constructor(
        message: string,
        public readonly code: BusStopErrorCodeType,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = 'BusStopError';
    }

    /** Check if no stops were found */
    isNoStopsFound(): boolean {
        return this.code === BusStopErrorCode.NO_STOPS_FOUND;
    }

    /** Check if rate limited */
    isRateLimited(): boolean {
        return this.code === BusStopErrorCode.RATE_LIMITED;
    }

    /** Check if API key is missing */
    isApiKeyMissing(): boolean {
        return this.code === BusStopErrorCode.API_KEY_MISSING;
    }

    /** Get user-friendly error message */
    getUserMessage(): string {
        switch (this.code) {
            case BusStopErrorCode.NO_STOPS_FOUND:
                return 'No bus stops found nearby. Try a different location.';
            case BusStopErrorCode.DEPARTURES_UNAVAILABLE:
                return 'Could not load departure times. Please try again.';
            case BusStopErrorCode.RATE_LIMITED:
                return 'Too many requests. Please wait a moment and try again.';
            case BusStopErrorCode.API_KEY_MISSING:
                return 'Bus departure service not configured.';
            default:
                return 'An error occurred loading bus information.';
        }
    }
}
