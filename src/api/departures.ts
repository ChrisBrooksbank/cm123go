/**
 * TransportAPI Departures Client
 * Fetches real-time bus departure boards
 */

import { z } from 'zod';
import { Logger } from '@utils/logger';
import { retryWithBackoff } from '@utils/helpers';
import { getConfig } from '@config/index';
import { BusStopError } from '@core/bus-stops/errors';
import type { Departure } from '@/types';
import { BusStopErrorCode } from '@/types';

// TransportAPI response schema for departures
const TransportApiDepartureSchema = z.object({
    line: z.string(),
    direction: z.string(),
    aimed_departure_time: z.string().nullable().optional(),
    expected_departure_time: z.string().nullable().optional(),
    best_departure_estimate: z.string().nullable().optional(),
    operator_name: z.string().nullable().optional(),
});

const TransportApiResponseSchema = z.object({
    departures: z
        .object({
            all: z.array(TransportApiDepartureSchema).optional(),
        })
        .optional(),
});

/**
 * Calculate minutes until departure from a time string (HH:MM format)
 */
function calculateMinutesUntil(timeStr: string): number {
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

/**
 * Map TransportAPI response to our Departure type
 */
function mapToDeparture(raw: z.infer<typeof TransportApiDepartureSchema>): Departure {
    const expectedTime =
        raw.expected_departure_time ||
        raw.best_departure_estimate ||
        raw.aimed_departure_time ||
        'Unknown';

    const minutesUntil = calculateMinutesUntil(expectedTime || '');

    return {
        line: raw.line,
        destination: raw.direction,
        expectedDeparture: expectedTime || 'Unknown',
        minutesUntil,
        status: minutesUntil < 0 ? 'delayed' : 'on-time',
        operatorName: raw.operator_name || undefined,
    };
}

/**
 * Fetch departures for a specific bus stop
 * @param atcoCode - NAPTAN ATCO code for the stop
 * @param limit - Maximum departures to return (default: 3)
 */
export async function fetchDepartures(atcoCode: string, limit = 3): Promise<Departure[]> {
    const config = getConfig();
    const { transportApiUrl, transportApiAppId, transportApiAppKey } = config.busStops;

    if (!transportApiAppId || !transportApiAppKey) {
        throw new BusStopError(
            'TransportAPI credentials not configured',
            BusStopErrorCode.API_KEY_MISSING
        );
    }

    const url =
        `${transportApiUrl}/uk/bus/stop/${atcoCode}/live.json` +
        `?app_id=${transportApiAppId}&app_key=${transportApiAppKey}` +
        `&group=no&nextbuses=yes`;

    Logger.debug('Fetching departures', { atcoCode });

    const response = await retryWithBackoff(
        async () => {
            const res = await fetch(url);

            if (res.status === 429) {
                throw new BusStopError(
                    'Rate limited by TransportAPI',
                    BusStopErrorCode.RATE_LIMITED
                );
            }

            if (!res.ok) {
                throw new BusStopError(
                    `TransportAPI error: ${res.status}`,
                    BusStopErrorCode.DEPARTURES_UNAVAILABLE
                );
            }

            return res.json();
        },
        2,
        1000
    );

    const parseResult = TransportApiResponseSchema.safeParse(response);

    if (!parseResult.success) {
        Logger.warn('Invalid TransportAPI response', parseResult.error);
        return [];
    }

    const departures = parseResult.data.departures?.all ?? [];

    return departures.slice(0, limit).map(mapToDeparture);
}
