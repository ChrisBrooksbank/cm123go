/**
 * BODS SIRI-VM Client
 * Fetches real-time vehicle positions from Bus Open Data Service
 */

import { Logger } from '@utils/logger';
import { retryWithBackoff } from '@utils/helpers';
import { getConfig } from '@config/index';
import { BusStopError } from '@core/bus-stops/errors';
import { BusStopErrorCode } from '@/types';
import type { VehicleActivity, BoundingBox, Coordinates } from '@/types';

/**
 * Create a bounding box around a point with a given radius
 * @param center - Center coordinates
 * @param radiusMeters - Radius in meters
 */
export function createBoundingBox(center: Coordinates, radiusMeters: number): BoundingBox {
    // Approximate degrees per meter at UK latitudes
    // 1 degree latitude ≈ 111,320 meters
    // 1 degree longitude ≈ 111,320 * cos(latitude) meters
    const latDelta = radiusMeters / 111320;
    const lonDelta = radiusMeters / (111320 * Math.cos((center.latitude * Math.PI) / 180));

    return {
        minLatitude: center.latitude - latDelta,
        maxLatitude: center.latitude + latDelta,
        minLongitude: center.longitude - lonDelta,
        maxLongitude: center.longitude + lonDelta,
    };
}

/**
 * Parse SIRI-VM XML response to extract vehicle activities
 */
function parseSiriVmResponse(xmlText: string): VehicleActivity[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new BusStopError('Failed to parse SIRI-VM XML', BusStopErrorCode.XML_PARSE_ERROR);
    }

    const vehicles: VehicleActivity[] = [];
    const vehicleActivities = doc.querySelectorAll('VehicleActivity');

    for (const activity of vehicleActivities) {
        const journey = activity.querySelector('MonitoredVehicleJourney');
        if (!journey) continue;

        const vehicleLocation = journey.querySelector('VehicleLocation');
        if (!vehicleLocation) continue;

        const latitude = parseFloat(vehicleLocation.querySelector('Latitude')?.textContent || '');
        const longitude = parseFloat(vehicleLocation.querySelector('Longitude')?.textContent || '');

        if (isNaN(latitude) || isNaN(longitude)) continue;

        const recordedAtTime = activity.querySelector('RecordedAtTime')?.textContent;
        const validUntilTime = activity.querySelector('ValidUntilTime')?.textContent;

        const vehicle: VehicleActivity = {
            recordedAtTime: recordedAtTime ? new Date(recordedAtTime) : new Date(),
            validUntilTime: validUntilTime ? new Date(validUntilTime) : new Date(),
            vehicleRef: journey.querySelector('VehicleRef')?.textContent || '',
            lineRef: journey.querySelector('LineRef')?.textContent || '',
            directionRef: journey.querySelector('DirectionRef')?.textContent || '',
            operatorRef: journey.querySelector('OperatorRef')?.textContent || '',
            latitude,
            longitude,
        };

        // Optional fields
        const bearing = journey.querySelector('Bearing')?.textContent;
        if (bearing) vehicle.bearing = parseFloat(bearing);

        const blockRef = journey.querySelector('BlockRef')?.textContent;
        if (blockRef) vehicle.blockRef = blockRef;

        const vehicleJourneyRef = journey.querySelector('VehicleJourneyRef')?.textContent;
        if (vehicleJourneyRef) vehicle.vehicleJourneyRef = vehicleJourneyRef;

        const destinationRef = journey.querySelector('DestinationRef')?.textContent;
        if (destinationRef) vehicle.destinationRef = destinationRef;

        const destinationName = journey.querySelector('DestinationName')?.textContent;
        if (destinationName) vehicle.destinationName = destinationName;

        const originRef = journey.querySelector('OriginRef')?.textContent;
        if (originRef) vehicle.originRef = originRef;

        const originName = journey.querySelector('OriginName')?.textContent;
        if (originName) vehicle.originName = originName;

        vehicles.push(vehicle);
    }

    return vehicles;
}

/**
 * Fetch vehicle positions within a bounding box from BODS SIRI-VM
 * @param boundingBox - Geographic area to search
 */
export async function fetchVehiclePositions(boundingBox: BoundingBox): Promise<VehicleActivity[]> {
    const config = getConfig();
    const { bodsApiKey } = config.busStops;

    if (!bodsApiKey) {
        throw new BusStopError('BODS API key not configured', BusStopErrorCode.API_KEY_MISSING);
    }

    // BODS SIRI-VM endpoint format: boundingBox=minLat,minLon,maxLat,maxLon
    // Uses /api/bods proxy to avoid CORS errors (proxied via Netlify/Vite)
    const bbox = `${boundingBox.minLatitude},${boundingBox.minLongitude},${boundingBox.maxLatitude},${boundingBox.maxLongitude}`;
    const url = `/api/bods/datafeed/?boundingBox=${bbox}&api_key=${bodsApiKey}`;

    Logger.debug('Fetching SIRI-VM vehicle positions', { boundingBox });

    const response = await retryWithBackoff(
        async () => {
            const res = await fetch(url);

            if (res.status === 429) {
                throw new BusStopError('Rate limited by BODS API', BusStopErrorCode.RATE_LIMITED);
            }

            if (!res.ok) {
                throw new BusStopError(
                    `BODS API error: ${res.status}`,
                    BusStopErrorCode.SIRI_VM_UNAVAILABLE
                );
            }

            return res.text();
        },
        2,
        1000
    );

    try {
        const vehicles = parseSiriVmResponse(response);
        Logger.debug(`Found ${vehicles.length} vehicles in bounding box`);
        return vehicles;
    } catch (error) {
        if (error instanceof BusStopError) throw error;
        Logger.warn('Failed to parse SIRI-VM response', error);
        return [];
    }
}

/**
 * Fetch vehicles near a specific location
 * @param center - Center coordinates
 * @param radiusMeters - Search radius (default from config)
 */
export async function fetchVehiclesNear(
    center: Coordinates,
    radiusMeters?: number
): Promise<VehicleActivity[]> {
    const config = getConfig();
    const radius = radiusMeters ?? config.busStops.vehicleSearchRadius;
    const boundingBox = createBoundingBox(center, radius);
    return fetchVehiclePositions(boundingBox);
}

/**
 * Calculate distance between two coordinates in meters (Haversine formula)
 */
export function calculateDistance(coord1: Coordinates, coord2: Coordinates): number {
    const R = 6371000; // Earth radius in meters
    const lat1Rad = (coord1.latitude * Math.PI) / 180;
    const lat2Rad = (coord2.latitude * Math.PI) / 180;
    const deltaLat = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
    const deltaLon = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;

    const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
