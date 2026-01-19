/**
 * ETA Calculator
 * Combines SIRI-VM real-time vehicle positions with GTFS timetable data
 * to calculate estimated departure times.
 */

import { Logger } from '@utils/logger';
import { fetchVehiclesNear, calculateDistance } from '@api/bods-siri-vm';
import { getScheduledDepartures, isGTFSDataAvailable } from '@api/bods-gtfs';
import type { Departure, Coordinates, VehicleActivity, BusStop } from '@/types';

/** Average bus speed for ETA calculations (meters per second) */
const AVERAGE_BUS_SPEED_MPS = 8; // ~29 km/h in urban areas

// MAX_TIME_DIFFERENCE_SECONDS would be used for more precise vehicle-to-trip matching
// const MAX_TIME_DIFFERENCE_SECONDS = 600; // 10 minutes

/**
 * Calculate departures for a bus stop by combining real-time and timetable data
 * @param stop - Bus stop to get departures for
 * @param limit - Maximum number of departures to return
 */
export async function calculateDepartures(stop: BusStop, limit = 3): Promise<Departure[]> {
    const stopCoords = stop.coordinates;

    // Try to get scheduled departures first
    const gtfsAvailable = await isGTFSDataAvailable();
    const scheduledDepartures = gtfsAvailable
        ? await getScheduledDepartures(stop.atcoCode, limit * 2)
        : [];

    // If no scheduled departures, fall back to real-time data only
    if (scheduledDepartures.length === 0) {
        Logger.debug('No scheduled departures found, using real-time only');
        return getRealTimeOnlyDepartures(stopCoords, limit);
    }

    // Fetch real-time vehicle positions
    let vehicles: VehicleActivity[] = [];
    try {
        vehicles = await fetchVehiclesNear(stopCoords);
        Logger.debug(`Found ${vehicles.length} vehicles near stop ${stop.atcoCode}`);
    } catch (error) {
        Logger.warn('Failed to fetch real-time vehicle data', error);
        // Fall back to timetable-only
    }

    // Match vehicles to scheduled departures and calculate ETAs
    const departures: Departure[] = [];
    const matchedSchedules = new Set<string>();

    for (const scheduled of scheduledDepartures) {
        // Find a matching vehicle for this scheduled departure
        const matchingVehicle = findMatchingVehicle(scheduled, vehicles, stopCoords);

        if (matchingVehicle) {
            // Calculate real-time ETA based on vehicle position
            const eta = calculateETAFromVehicle(matchingVehicle, stopCoords);
            matchedSchedules.add(`${scheduled.line}-${scheduled.departureTime}`);

            departures.push({
                line: scheduled.line,
                destination: scheduled.destination,
                expectedDeparture: formatTimeHHMM(eta),
                minutesUntil: Math.round((eta.getTime() - Date.now()) / 60000),
                status: 'on-time',
                operatorName: scheduled.operatorName,
                isRealTime: true,
            });
        } else {
            // Use scheduled time from timetable
            const scheduledTime = parseTimeToDate(scheduled.departureTime);
            const minutesUntil = Math.round((scheduledTime.getTime() - Date.now()) / 60000);

            // Skip if already departed
            if (minutesUntil < -2) continue;

            departures.push({
                line: scheduled.line,
                destination: scheduled.destination,
                expectedDeparture: formatTimeHHMM(scheduledTime),
                minutesUntil: Math.max(0, minutesUntil),
                status: 'scheduled',
                operatorName: scheduled.operatorName,
                isRealTime: false,
            });
        }

        if (departures.length >= limit) break;
    }

    // Sort by minutes until departure
    return departures.sort((a, b) => a.minutesUntil - b.minutesUntil).slice(0, limit);
}

/**
 * Find a vehicle that matches a scheduled departure
 */
function findMatchingVehicle(
    scheduled: { line: string; tripId: string },
    vehicles: VehicleActivity[],
    stopCoords: Coordinates
): VehicleActivity | null {
    for (const vehicle of vehicles) {
        // Match by line reference
        if (normalizeLineRef(vehicle.lineRef) === normalizeLineRef(scheduled.line)) {
            // Check if vehicle is approaching (within reasonable distance)
            const distance = calculateDistance(
                { latitude: vehicle.latitude, longitude: vehicle.longitude },
                stopCoords
            );

            // Only consider vehicles within 3km and heading towards the stop
            if (distance < 3000) {
                return vehicle;
            }
        }
    }
    return null;
}

/**
 * Calculate ETA based on vehicle position and distance to stop
 */
function calculateETAFromVehicle(vehicle: VehicleActivity, stopCoords: Coordinates): Date {
    const distance = calculateDistance(
        { latitude: vehicle.latitude, longitude: vehicle.longitude },
        stopCoords
    );

    // Estimate time based on average speed
    const etaSeconds = distance / AVERAGE_BUS_SPEED_MPS;
    const eta = new Date(Date.now() + etaSeconds * 1000);

    return eta;
}

/**
 * Get departures from real-time data only (no timetable)
 * This is a fallback when GTFS data is not available
 */
async function getRealTimeOnlyDepartures(
    stopCoords: Coordinates,
    limit: number
): Promise<Departure[]> {
    try {
        const vehicles = await fetchVehiclesNear(stopCoords);
        const departures: Departure[] = [];

        // Group vehicles by line and get nearest one for each line
        const vehiclesByLine = new Map<string, VehicleActivity>();

        for (const vehicle of vehicles) {
            const line = normalizeLineRef(vehicle.lineRef);
            const existing = vehiclesByLine.get(line);

            if (!existing) {
                vehiclesByLine.set(line, vehicle);
            } else {
                // Keep the closer vehicle
                const existingDistance = calculateDistance(
                    { latitude: existing.latitude, longitude: existing.longitude },
                    stopCoords
                );
                const newDistance = calculateDistance(
                    { latitude: vehicle.latitude, longitude: vehicle.longitude },
                    stopCoords
                );
                if (newDistance < existingDistance) {
                    vehiclesByLine.set(line, vehicle);
                }
            }
        }

        // Create departures from nearest vehicles
        for (const [line, vehicle] of vehiclesByLine) {
            const eta = calculateETAFromVehicle(vehicle, stopCoords);
            const minutesUntil = Math.round((eta.getTime() - Date.now()) / 60000);

            departures.push({
                line,
                destination: vehicle.destinationName || 'Unknown',
                expectedDeparture: formatTimeHHMM(eta),
                minutesUntil: Math.max(0, minutesUntil),
                status: 'on-time',
                operatorName: undefined,
                isRealTime: true,
            });
        }

        return departures.sort((a, b) => a.minutesUntil - b.minutesUntil).slice(0, limit);
    } catch (error) {
        Logger.warn('Failed to get real-time only departures', error);
        return [];
    }
}

/**
 * Normalize line reference for matching
 * BODS line refs may include operator prefix (e.g., "ARBB:42")
 */
function normalizeLineRef(lineRef: string): string {
    // Remove operator prefix if present
    const parts = lineRef.split(':');
    return parts[parts.length - 1].trim().toUpperCase();
}

/**
 * Parse HH:MM:SS time string to Date (today)
 */
function parseTimeToDate(timeStr: string): Date {
    const [hours, minutes, seconds] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours || 0, minutes || 0, seconds || 0, 0);

    // If time is earlier than now, assume tomorrow
    if (date < new Date()) {
        date.setDate(date.getDate() + 1);
    }

    return date;
}

/**
 * Format Date as HH:MM string
 */
function formatTimeHHMM(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}
