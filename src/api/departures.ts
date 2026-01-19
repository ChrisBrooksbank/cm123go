/**
 * BODS Departures Client
 * Fetches bus departure information using Bus Open Data Service
 */

import { Logger } from '@utils/logger';
import { getConfig } from '@config/index';
import { BusStopError } from '@core/bus-stops/errors';
import { calculateDepartures } from '@core/bus-stops/eta-calculator';
import type { Departure, BusStop } from '@/types';
import { BusStopErrorCode } from '@/types';

/**
 * Fetch departures for a specific bus stop using BODS data
 * @param atcoCode - NAPTAN ATCO code for the stop
 * @param limit - Maximum departures to return (default: 3)
 * @param stopInfo - Optional stop info if already available (avoids lookup)
 */
export async function fetchDepartures(
    atcoCode: string,
    limit = 3,
    stopInfo?: BusStop
): Promise<Departure[]> {
    const config = getConfig();
    const { bodsApiKey } = config.busStops;

    if (!bodsApiKey) {
        throw new BusStopError('BODS API key not configured', BusStopErrorCode.API_KEY_MISSING);
    }

    Logger.debug('Fetching departures via BODS', { atcoCode });

    // If stop info not provided, create a minimal stop object
    // In practice, the service layer should always provide this
    const stop: BusStop = stopInfo || {
        atcoCode,
        commonName: 'Unknown Stop',
        coordinates: { latitude: 0, longitude: 0 },
    };

    try {
        const departures = await calculateDepartures(stop, limit);
        Logger.debug(`Found ${departures.length} departures for ${atcoCode}`);
        return departures;
    } catch (error) {
        if (error instanceof BusStopError) {
            throw error;
        }
        Logger.warn('Failed to fetch BODS departures', error);
        throw new BusStopError(
            'Failed to fetch departure information',
            BusStopErrorCode.DEPARTURES_UNAVAILABLE
        );
    }
}

/**
 * Fetch departures with full stop context
 * This is the preferred method when stop details are available
 */
export async function fetchDeparturesForStop(stop: BusStop, limit = 3): Promise<Departure[]> {
    return fetchDepartures(stop.atcoCode, limit, stop);
}

/**
 * Calculate minutes until departure from a time string (HH:MM format)
 * Exported for backward compatibility with existing code
 */
export function calculateMinutesUntil(timeStr: string): number {
    if (!timeStr || timeStr === 'Due') {
        return 0;
    }

    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);

    if (isNaN(hours) || isNaN(minutes)) {
        return 0;
    }

    const departureDate = new Date();
    departureDate.setHours(hours, minutes, 0, 0);

    // If the time is earlier than now, assume it's tomorrow
    if (departureDate < now) {
        departureDate.setDate(departureDate.getDate() + 1);
    }

    const diffMs = departureDate.getTime() - now.getTime();
    return Math.round(diffMs / 60000);
}
