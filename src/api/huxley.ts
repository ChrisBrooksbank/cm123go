/**
 * Huxley2 API Client
 * Fetches real-time train departures from National Rail Darwin via Huxley2 proxy
 *
 * Huxley2 is a JSON proxy for the National Rail Darwin SOAP API.
 * Get a free access token from: https://raildata.org.uk
 */

import { Logger } from '@utils/logger';
import { resilientFetch, CircuitOpenError } from '@utils/helpers';
import { getConfig } from '@config/index';
import type { TrainDeparture } from '@/types';

/** Huxley2 API response types */
interface HuxleyDestination {
    locationName: string;
    crs: string;
    via?: string;
}

interface HuxleyService {
    destination: HuxleyDestination[];
    std: string; // Scheduled Time Departure (e.g., "10:30")
    etd: string; // Estimated Time Departure (e.g., "10:35", "On time", "Cancelled", "Delayed")
    platform?: string;
    operator: string;
    operatorCode: string;
    serviceID: string;
    isCancelled?: boolean;
    cancelReason?: string;
    delayReason?: string;
}

interface HuxleyResponse {
    trainServices: HuxleyService[] | null;
    nrccMessages?: { Value: string }[];
    locationName: string;
    crs: string;
    generatedAt: string;
    isTruncated?: boolean;
}

/**
 * Fetch train departures from Huxley2 API for a specific station
 * @param crsCode - 3-letter CRS code for the station (e.g., "CHM" for Chelmsford)
 * @param limit - Maximum number of departures to return
 */
export async function fetchTrainDepartures(
    crsCode: string,
    limit?: number
): Promise<TrainDeparture[]> {
    const config = getConfig();
    const { huxleyApiUrl, huxleyAccessToken, maxDeparturesPerStation } = config.trainStations;
    const numRows = limit ?? maxDeparturesPerStation;

    if (!huxleyAccessToken) {
        Logger.debug('Huxley access token not configured');
        throw new Error('API_KEY_MISSING');
    }

    const url = `${huxleyApiUrl}/departures/${crsCode}?numRows=${numRows}&accessToken=${huxleyAccessToken}`;

    Logger.info('Fetching train departures', { crsCode });

    try {
        const response = await resilientFetch<HuxleyResponse>(
            'huxley',
            crsCode,
            async () => {
                const res = await fetch(url);

                if (!res.ok) {
                    throw new Error(`Huxley API error: ${res.status}`);
                }

                return res.json() as Promise<HuxleyResponse>;
            },
            { retry: { maxAttempts: 2, initialDelay: 1000 } }
        );

        Logger.debug('Huxley API response', { crsCode, response });

        if (!response.trainServices || response.trainServices.length === 0) {
            Logger.debug('No train services found', { crsCode });
            return [];
        }

        const departures: TrainDeparture[] = response.trainServices.map(service => {
            const { expectedDeparture, status, isRealTime } = parseEtd(service.etd, service.std);
            const destination = service.destination[0]?.locationName || 'Unknown';
            const via = service.destination[0]?.via;
            const fullDestination = via ? `${destination} ${via}` : destination;

            return {
                destination: fullDestination,
                scheduledDeparture: service.std,
                expectedDeparture,
                minutesUntil: calculateMinutesUntil(expectedDeparture),
                platform: service.platform,
                operatorCode: service.operatorCode,
                operatorName: service.operator,
                status,
                isRealTime,
            };
        });

        Logger.info('Fetched train departures', {
            crsCode,
            count: departures.length,
        });

        return departures;
    } catch (error) {
        if (error instanceof CircuitOpenError) {
            Logger.warn('Huxley circuit open, skipping', {
                crsCode,
                retryAfter: error.retryAfter,
            });
            return [];
        }
        Logger.warn('Failed to fetch train departures', { crsCode, error });
        return [];
    }
}

/**
 * Parse the ETD (Estimated Time Departure) field from Huxley
 * Can be: "On time", "Cancelled", "Delayed", or an actual time like "10:35"
 */
function parseEtd(
    etd: string,
    std: string
): { expectedDeparture: string; status: TrainDeparture['status']; isRealTime: boolean } {
    const etdLower = etd.toLowerCase();

    if (etdLower === 'on time') {
        return { expectedDeparture: std, status: 'on-time', isRealTime: true };
    }

    if (etdLower === 'cancelled') {
        return { expectedDeparture: std, status: 'cancelled', isRealTime: true };
    }

    if (etdLower === 'delayed') {
        return { expectedDeparture: std, status: 'delayed', isRealTime: true };
    }

    // It's an actual time (e.g., "10:35")
    const isDelayed = etd !== std;
    return {
        expectedDeparture: etd,
        status: isDelayed ? 'delayed' : 'on-time',
        isRealTime: true,
    };
}

/**
 * Calculate minutes until departure from a time string
 * Format: "HH:MM"
 */
function calculateMinutesUntil(timeStr: string): number {
    if (!timeStr) {
        return 0;
    }

    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
        return 0;
    }

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
