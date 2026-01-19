/**
 * Train Station Service
 * Simple service for Chelmsford area train stations
 */

import { GeolocationService } from '@core/geolocation';
import type { Coordinates, TrainStation, NearbyTrainStation } from '@/types';

/**
 * Chelmsford train stations (hardcoded - only 2 stations)
 */
const CHELMSFORD_STATIONS: TrainStation[] = [
    {
        crsCode: 'CHM',
        name: 'Chelmsford',
        coordinates: {
            latitude: 51.7361,
            longitude: 0.469,
        },
    },
    {
        crsCode: 'BPA',
        name: 'Beaulieu Park',
        coordinates: {
            latitude: 51.7574,
            longitude: 0.5187,
        },
    },
];

/**
 * TrainStationService - Provides train station data sorted by distance
 */
export const TrainStationService = {
    /**
     * Get all train stations sorted by distance from user location
     */
    getStationsByDistance(userLocation: Coordinates): NearbyTrainStation[] {
        return CHELMSFORD_STATIONS.map(station => ({
            ...station,
            distanceMeters: GeolocationService.calculateDistance(userLocation, station.coordinates),
        })).sort((a, b) => a.distanceMeters - b.distanceMeters);
    },
};
