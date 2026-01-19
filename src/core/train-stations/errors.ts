/**
 * Train Station Error Types
 */

import type { TrainStationErrorCodeType } from '@/types';
import { TrainStationErrorCode } from '@/types';

/**
 * Custom error for train station failures
 * Provides structured error information for UI handling
 */
export class TrainStationError extends Error {
    constructor(
        message: string,
        public readonly code: TrainStationErrorCodeType,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = 'TrainStationError';
    }

    /** Check if departures unavailable */
    isDeparturesUnavailable(): boolean {
        return this.code === TrainStationErrorCode.DEPARTURES_UNAVAILABLE;
    }

    /** Check if rate limited */
    isRateLimited(): boolean {
        return this.code === TrainStationErrorCode.RATE_LIMITED;
    }

    /** Check if API key is missing */
    isApiKeyMissing(): boolean {
        return this.code === TrainStationErrorCode.API_KEY_MISSING;
    }

    /** Get user-friendly error message */
    getUserMessage(): string {
        switch (this.code) {
            case TrainStationErrorCode.DEPARTURES_UNAVAILABLE:
                return 'Could not load train departure times. Please try again.';
            case TrainStationErrorCode.RATE_LIMITED:
                return 'Too many requests. Please wait a moment and try again.';
            case TrainStationErrorCode.API_KEY_MISSING:
                return 'Train departure service not configured.';
            default:
                return 'An error occurred loading train information.';
        }
    }
}
