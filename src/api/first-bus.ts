/**
 * First Bus API Client
 * Fetches real-time bus departures from First Bus website API
 *
 * Note: This uses the public API endpoint used by the First Bus website.
 * It may change without notice.
 */

import { Logger } from '@utils/logger';
import { resilientFetch, CircuitOpenError } from '@utils/helpers';
import type { Departure } from '@/types';

/** First Bus API response - TransportAPI format (departures.all) */
interface FirstBusDeparture {
    mode: string;
    line: string;
    line_name: string;
    direction: string;
    operator: string;
    operator_name: string;
    aimed_departure_time: string;
    expected_departure_time: string | null;
    best_departure_estimate: string;
    dir: string;
    source: string;
}

/** First Bus API response - Traveline format (times array) */
interface FirstBusTime {
    ServiceRef: string;
    ServiceNumber: string;
    Destination: string;
    Due: string;
    IsFG: string; // "Y" or "N" - is First Group
    IsLive: string; // "Y" or "N" - is real-time
}

interface FirstBusResponse {
    departures?: {
        all?: FirstBusDeparture[];
        [key: string]: FirstBusDeparture[] | undefined;
    };
    times?: FirstBusTime[];
    atcocode?: string;
    name?: string;
    error?: string;
}

/** First Bus API base URL - proxied to avoid CORS */
const FIRST_BUS_API_PATH = '/api/firstbus';

/**
 * Fetch departures from First Bus API for a specific stop
 * @param atcoCode - NAPTAN ATCO code for the stop
 * @param limit - Maximum number of departures to return
 */
export async function fetchFirstBusDepartures(atcoCode: string, limit = 3): Promise<Departure[]> {
    // First Bus redirects /getNextBus to /api/get-next-bus
    const url = `${FIRST_BUS_API_PATH}/api/get-next-bus?stop=${atcoCode}`;

    Logger.info('Fetching First Bus departures', { atcoCode });

    try {
        const response = await resilientFetch<FirstBusResponse>(
            'first-bus',
            atcoCode,
            async () => {
                const res = await fetch(url);

                if (!res.ok) {
                    throw new Error(`First Bus API error: ${res.status}`);
                }

                return res.json() as Promise<FirstBusResponse>;
            },
            { retry: { maxAttempts: 2, initialDelay: 1000 } }
        );

        // Log raw response for debugging
        Logger.debug('First Bus API response', { response });

        // Note: API often returns error field even when data is present
        // Only log the error, don't short-circuit if we might have data
        if (response.error) {
            Logger.debug('First Bus API warning', { error: response.error, atcoCode });
        }

        // Try TransportAPI format first (departures.all)
        const transportApiDepartures = response.departures?.all || [];
        if (transportApiDepartures.length > 0) {
            const departures: Departure[] = transportApiDepartures.slice(0, limit).map(dep => {
                const isRealTime = dep.expected_departure_time !== null;
                const departureTime = dep.best_departure_estimate || dep.aimed_departure_time;

                return {
                    line: dep.line_name || dep.line,
                    destination: dep.direction,
                    expectedDeparture: departureTime,
                    minutesUntil: calculateMinutesUntil(departureTime),
                    status: 'on-time' as const,
                    operatorName: dep.operator_name || 'First Bus',
                    isRealTime,
                };
            });

            Logger.info('Fetched First Bus departures (TransportAPI format)', {
                atcoCode,
                count: departures.length,
            });
            return departures;
        }

        // Fall back to Traveline format (times array)
        if (response.times && response.times.length > 0) {
            const departures: Departure[] = response.times.slice(0, limit).map(time => {
                const isRealTime = time.IsLive === 'Y';

                return {
                    line: time.ServiceNumber,
                    destination: time.Destination,
                    expectedDeparture: time.Due,
                    minutesUntil: calculateMinutesUntil(time.Due),
                    status: 'on-time' as const,
                    operatorName: time.IsFG === 'Y' ? 'First Bus' : undefined,
                    isRealTime,
                };
            });

            Logger.info('Fetched First Bus departures (Traveline format)', {
                atcoCode,
                count: departures.length,
            });
            return departures;
        }

        Logger.debug('No First Bus departures found', { atcoCode });
        return [];
    } catch (error) {
        if (error instanceof CircuitOpenError) {
            Logger.warn('First Bus circuit open, skipping', {
                atcoCode,
                retryAfter: error.retryAfter,
            });
            return [];
        }
        Logger.warn('Failed to fetch First Bus departures', { atcoCode, error });
        return [];
    }
}

/**
 * Calculate minutes until departure from a time string
 * First Bus returns times like "10:30" or "Due"
 */
function calculateMinutesUntil(timeStr: string): number {
    if (!timeStr || timeStr.toLowerCase() === 'due') {
        return 0;
    }

    // Handle "X mins" format
    const minsMatch = timeStr.match(/(\d+)\s*min/i);
    if (minsMatch) {
        return parseInt(minsMatch[1], 10);
    }

    // Handle "HH:MM" format
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
        const now = new Date();
        const [hours, minutes] = [parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10)];

        const departureDate = new Date();
        departureDate.setHours(hours, minutes, 0, 0);

        // If the time is earlier than now, assume it's tomorrow
        if (departureDate < now) {
            departureDate.setDate(departureDate.getDate() + 1);
        }

        const diffMs = departureDate.getTime() - now.getTime();
        return Math.max(0, Math.round(diffMs / 60000));
    }

    return 0;
}
