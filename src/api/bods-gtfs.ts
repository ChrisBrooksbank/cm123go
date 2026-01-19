/**
 * BODS GTFS Client
 * Loads and queries pre-processed GTFS timetable data
 *
 * GTFS data is pre-processed at build time into a JSON file
 * containing only Chelmsford-area stops and services.
 */

import { Logger } from '@utils/logger';
import { retryWithBackoff } from '@utils/helpers';
import { getConfig } from '@config/index';
import type { GTFSStopTime, GTFSTrip, GTFSRoute } from '@/types';

/** Pre-processed GTFS data structure */
interface GTFSData {
    stopTimes: Record<string, GTFSStopTime[]>; // Indexed by stopId
    trips: Record<string, GTFSTrip>; // Indexed by tripId
    routes: Record<string, GTFSRoute>; // Indexed by routeId
    lastUpdated: string;
}

let cachedGTFSData: GTFSData | null = null;
let cacheTimestamp = 0;

/**
 * Load GTFS data from the pre-processed JSON file
 */
async function loadGTFSData(): Promise<GTFSData> {
    const config = getConfig();
    const cacheTtl = config.busStops.timetableCacheTtl;

    // Return cached data if still valid
    if (cachedGTFSData && Date.now() - cacheTimestamp < cacheTtl) {
        return cachedGTFSData;
    }

    Logger.debug('Loading GTFS timetable data');

    const response = await retryWithBackoff(
        async () => {
            const res = await fetch('/gtfs-chelmsford.json');
            if (!res.ok) {
                throw new Error(`Failed to load GTFS data: ${res.status}`);
            }
            return res.json() as Promise<GTFSData>;
        },
        2,
        1000
    );

    cachedGTFSData = response;
    cacheTimestamp = Date.now();

    Logger.debug('GTFS data loaded', {
        stops: Object.keys(response.stopTimes).length,
        trips: Object.keys(response.trips).length,
        routes: Object.keys(response.routes).length,
        lastUpdated: response.lastUpdated,
    });

    return response;
}

/**
 * Get scheduled departures for a specific stop
 * @param stopId - NAPTAN ATCO code for the stop
 * @param limit - Maximum number of departures to return
 * @returns Scheduled departures sorted by time
 */
export async function getScheduledDepartures(
    stopId: string,
    limit = 10
): Promise<ScheduledDeparture[]> {
    const gtfs = await loadGTFSData();
    const stopTimes = gtfs.stopTimes[stopId] || [];

    if (stopTimes.length === 0) {
        Logger.debug(`No GTFS data for stop ${stopId}`);
        return [];
    }

    const now = new Date();
    const currentTime = formatTime(now);
    // Note: currentDay would be used with calendar.txt for full GTFS accuracy
    // const currentDay = getDayOfWeek(now);

    // Filter to upcoming departures and enrich with route info
    const departures: ScheduledDeparture[] = [];

    for (const stopTime of stopTimes) {
        // Skip if departure time has passed
        if (stopTime.departureTime < currentTime) continue;

        const trip = gtfs.trips[stopTime.tripId];
        if (!trip) continue;

        // Check if service runs today (simplified - would need calendar.txt for full accuracy)
        const route = gtfs.routes[trip.routeId];
        if (!route) continue;

        departures.push({
            tripId: stopTime.tripId,
            departureTime: stopTime.departureTime,
            line: route.routeShortName,
            destination: trip.tripHeadsign || route.routeLongName || 'Unknown',
            operatorName: route.operatorName,
            stopSequence: stopTime.stopSequence,
            serviceId: trip.serviceId,
        });

        if (departures.length >= limit * 2) break; // Get extra for filtering
    }

    // Sort by departure time and limit
    return departures
        .sort((a, b) => a.departureTime.localeCompare(b.departureTime))
        .slice(0, limit);
}

/** Scheduled departure from GTFS timetable */
export interface ScheduledDeparture {
    tripId: string;
    departureTime: string; // HH:MM:SS format
    line: string;
    destination: string;
    operatorName?: string;
    stopSequence: number;
    serviceId: string;
}

/**
 * Format current time as HH:MM:SS
 */
function formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// getDayOfWeek would be used with calendar.txt for full GTFS service day accuracy
// function getDayOfWeek(date: Date): number {
//     return date.getDay();
// }

/**
 * Check if GTFS data is available
 */
export async function isGTFSDataAvailable(): Promise<boolean> {
    try {
        const res = await fetch('/gtfs-chelmsford.json', { method: 'HEAD' });
        return res.ok;
    } catch {
        return false;
    }
}
