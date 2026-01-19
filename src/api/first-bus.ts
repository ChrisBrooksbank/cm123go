/**
 * First Bus API Client
 * Fetches real-time bus departures from First Bus website API
 *
 * Note: This uses the public API endpoint used by the First Bus website.
 * It may change without notice.
 */

import { Logger } from '@utils/logger';
import { retryWithBackoff } from '@utils/helpers';
import type { Departure } from '@/types';

/** First Bus API response structure (TransportAPI format) */
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

interface FirstBusResponse {
    departures?: {
        all?: FirstBusDeparture[];
        [key: string]: FirstBusDeparture[] | undefined;
    };
    atcocode?: string;
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
        const response = await retryWithBackoff(
            async () => {
                const res = await fetch(url);

                if (!res.ok) {
                    throw new Error(`First Bus API error: ${res.status}`);
                }

                return res.json() as Promise<FirstBusResponse>;
            },
            2,
            1000
        );

        // Log raw response for debugging
        Logger.debug('First Bus API response', { response });

        // Check if response has valid data
        if (!response.departures || !response.atcocode) {
            Logger.debug('No First Bus departures found', { atcoCode });
            return [];
        }

        // Get all departures from the response (they're grouped by line)
        const allDepartures: FirstBusDeparture[] = response.departures.all || [];

        if (allDepartures.length === 0) {
            Logger.debug('No departures in response', { atcoCode });
            return [];
        }

        // Convert to our Departure format
        const departures: Departure[] = allDepartures.slice(0, limit).map(dep => {
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

        Logger.info('Fetched First Bus departures', {
            atcoCode,
            count: departures.length,
            hasRealTime: departures.some(d => d.isRealTime),
        });

        return departures;
    } catch (error) {
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

/**
 * Check if First Bus API is available for a stop
 * First Bus only operates in certain areas
 */
export async function isFirstBusAvailable(atcoCode: string): Promise<boolean> {
    try {
        const departures = await fetchFirstBusDepartures(atcoCode, 1);
        return departures.length > 0;
    } catch {
        return false;
    }
}
