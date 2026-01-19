/**
 * Bus Stop Service
 * Find nearest stops and get departures
 */

import { Logger } from '@utils/logger';
import { getConfig } from '@config/index';
import { GeolocationService } from '@core/geolocation';
import { BusStopCache } from './cache';
import { BusStopError } from './errors';
import { fetchChelmsfordBusStops } from '@api/naptan';
import { fetchDeparturesForStop } from '@api/departures';
import type { Coordinates, NearbyBusStop, DepartureBoard } from '@/types';
import { BusStopErrorCode } from '@/types';

/**
 * Result type for nearest stop with departures
 */
type NearestStopResult =
    | { success: true; board: DepartureBoard }
    | { success: false; error: BusStopError };

/**
 * Partial failure info for a single stop
 */
interface StopFetchError {
    stop: NearbyBusStop;
    error: string;
}

/**
 * Result type for both directions (supports partial success)
 */
type BothDirectionsResult =
    | { success: true; boards: DepartureBoard[]; partialFailures?: StopFetchError[] }
    | { success: false; error: BusStopError };

/**
 * Get opposite bearing direction
 */
function getOppositeBearing(bearing: string | undefined): string | undefined {
    if (!bearing) return undefined;
    const opposites: Record<string, string> = {
        N: 'S',
        S: 'N',
        E: 'W',
        W: 'E',
        NE: 'SW',
        SW: 'NE',
        NW: 'SE',
        SE: 'NW',
    };
    return opposites[bearing.toUpperCase()];
}

/**
 * BusStopService - Find nearest stops and departures
 */
export const BusStopService = {
    /**
     * Initialize cache with NAPTAN data
     * Call once at app startup (non-blocking)
     */
    async init(): Promise<void> {
        const cached = await BusStopCache.getStops();
        if (cached && cached.length > 0) {
            Logger.info('Bus stops loaded from cache', { count: cached.length });
            return;
        }

        try {
            Logger.info('Fetching bus stops from NAPTAN...');
            const stops = await fetchChelmsfordBusStops();
            await BusStopCache.setStops(stops);
            Logger.success('Bus stops cached', { count: stops.length });
        } catch (error) {
            Logger.warn('Failed to fetch bus stops, will retry later', error);
            // Non-fatal - user can still use app with cached data or retry
        }
    },

    /**
     * Find nearest bus stops to given coordinates
     * @param location - User's current coordinates
     * @param maxResults - Maximum number of stops to return (default: 1)
     * @returns Array of nearby bus stops sorted by distance
     */
    async findNearest(location: Coordinates, maxResults = 1): Promise<NearbyBusStop[]> {
        const stops = await BusStopCache.getStops();

        if (!stops || stops.length === 0) {
            throw new BusStopError(
                'No bus stops available - try refreshing',
                BusStopErrorCode.NO_STOPS_FOUND
            );
        }

        const config = getConfig();
        const maxRadius = config.busStops.maxSearchRadius;

        // Calculate distances and filter by radius
        const nearby: NearbyBusStop[] = stops
            .map(stop => ({
                ...stop,
                distanceMeters: GeolocationService.calculateDistance(location, stop.coordinates),
            }))
            .filter(stop => stop.distanceMeters <= maxRadius)
            .sort((a, b) => a.distanceMeters - b.distanceMeters)
            .slice(0, maxResults);

        if (nearby.length === 0) {
            throw new BusStopError(
                `No bus stops within ${maxRadius}m - try a different location`,
                BusStopErrorCode.NO_STOPS_FOUND
            );
        }

        Logger.debug('Found nearby stops', {
            count: nearby.length,
            nearest: nearby[0]?.commonName,
            distance: nearby[0]?.distanceMeters,
        });

        return nearby;
    },

    /**
     * Get nearest stop with departures
     * Main entry point for the feature
     *
     * @param location - User's current coordinates
     * @returns DepartureBoard with stop info and next departures
     */
    async getNearestWithDepartures(location: Coordinates): Promise<NearestStopResult> {
        try {
            // Find nearest stop
            const [nearest] = await this.findNearest(location, 1);

            // Try cache first for departures
            const cachedDepartures = await BusStopCache.getDepartures(nearest.atcoCode);

            if (cachedDepartures && cachedDepartures.length > 0) {
                Logger.debug('Using cached departures', {
                    atcoCode: nearest.atcoCode,
                });
                return {
                    success: true,
                    board: {
                        stop: nearest,
                        departures: cachedDepartures,
                        lastUpdated: Date.now(),
                        isStale: true,
                    },
                };
            }

            // Fetch fresh departures using BODS
            const departures = await fetchDeparturesForStop(nearest, 3);
            await BusStopCache.setDepartures(nearest.atcoCode, departures);

            return {
                success: true,
                board: {
                    stop: nearest,
                    departures,
                    lastUpdated: Date.now(),
                    isStale: false,
                },
            };
        } catch (error) {
            const busError =
                error instanceof BusStopError
                    ? error
                    : new BusStopError(String(error), BusStopErrorCode.DEPARTURES_UNAVAILABLE);

            Logger.warn('Failed to get departures', {
                code: busError.code,
                message: busError.message,
            });

            return { success: false, error: busError };
        }
    },

    /**
     * Force refresh departures (bypass cache)
     * @param location - User's current coordinates
     */
    async refreshDepartures(location: Coordinates): Promise<NearestStopResult> {
        try {
            const [nearest] = await this.findNearest(location, 1);

            // Skip cache, fetch fresh from BODS
            const departures = await fetchDeparturesForStop(nearest, 3);
            await BusStopCache.setDepartures(nearest.atcoCode, departures);

            return {
                success: true,
                board: {
                    stop: nearest,
                    departures,
                    lastUpdated: Date.now(),
                    isStale: false,
                },
            };
        } catch (error) {
            const busError =
                error instanceof BusStopError
                    ? error
                    : new BusStopError(String(error), BusStopErrorCode.DEPARTURES_UNAVAILABLE);

            return { success: false, error: busError };
        }
    },

    /**
     * Get nearest stops in both directions
     * Returns 2 stops per direction (4 total) - nearest and next nearest for each
     */
    async getBothDirections(location: Coordinates): Promise<BothDirectionsResult> {
        Logger.info('Getting departures for both directions', { location });
        try {
            // Get many nearby stops to find multiple in each direction
            const nearbyStops = await this.findNearest(location, 50);
            Logger.info('Found nearby stops', { count: nearbyStops.length });

            if (nearbyStops.length === 0) {
                throw new BusStopError(
                    'No bus stops found nearby',
                    BusStopErrorCode.NO_STOPS_FOUND
                );
            }

            const nearest = nearbyStops[0];
            const primaryBearing = nearest.bearing?.toUpperCase();
            const oppositeBearing = getOppositeBearing(nearest.bearing);

            // Find stops in primary direction (same bearing as nearest)
            const primaryStops = nearbyStops.filter(
                stop => stop.bearing?.toUpperCase() === primaryBearing
            );

            // Find stops in opposite direction
            const oppositeStops = oppositeBearing
                ? nearbyStops.filter(stop => stop.bearing?.toUpperCase() === oppositeBearing)
                : nearbyStops.filter(
                      stop => stop.bearing && stop.bearing?.toUpperCase() !== primaryBearing
                  );

            // Take up to 2 from each direction
            const stopsToShow: NearbyBusStop[] = [];

            // Add primary direction stops (up to 2)
            stopsToShow.push(...primaryStops.slice(0, 2));

            // Add opposite direction stops (up to 2)
            stopsToShow.push(...oppositeStops.slice(0, 2));

            // Fetch departures for all stops in parallel with partial success handling
            const results = await Promise.allSettled(
                stopsToShow.map(stop => this.getDeparturesForStop(stop))
            );

            const boards: DepartureBoard[] = [];
            const partialFailures: StopFetchError[] = [];

            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    boards.push(result.value);
                } else {
                    const stop = stopsToShow[index];
                    const errorMessage =
                        result.reason instanceof Error
                            ? result.reason.message
                            : String(result.reason);
                    partialFailures.push({ stop, error: errorMessage });
                    Logger.warn('Failed to fetch departures for stop', {
                        atcoCode: stop.atcoCode,
                        error: errorMessage,
                    });
                }
            });

            // Return success if at least one stop succeeded
            if (boards.length > 0) {
                return {
                    success: true,
                    boards,
                    partialFailures: partialFailures.length > 0 ? partialFailures : undefined,
                };
            }

            // All failed
            throw new BusStopError(
                'Failed to fetch departures for all stops',
                BusStopErrorCode.DEPARTURES_UNAVAILABLE
            );
        } catch (error) {
            const busError =
                error instanceof BusStopError
                    ? error
                    : new BusStopError(String(error), BusStopErrorCode.DEPARTURES_UNAVAILABLE);

            return { success: false, error: busError };
        }
    },

    /**
     * Helper to get departures for a single stop
     */
    async getDeparturesForStop(stop: NearbyBusStop): Promise<DepartureBoard> {
        Logger.debug('Getting departures for stop', {
            atcoCode: stop.atcoCode,
            name: stop.commonName,
        });

        // Try cache first
        const cached = await BusStopCache.getDepartures(stop.atcoCode);
        if (cached && cached.length > 0) {
            Logger.debug('Using cached departures', {
                atcoCode: stop.atcoCode,
                count: cached.length,
            });
            return {
                stop,
                departures: cached,
                lastUpdated: Date.now(),
                isStale: true,
            };
        }

        // Fetch fresh from BODS
        try {
            Logger.debug('Fetching fresh departures from BODS', { atcoCode: stop.atcoCode });
            const departures = await fetchDeparturesForStop(stop, 3);
            Logger.debug('Fetched departures', {
                atcoCode: stop.atcoCode,
                count: departures.length,
            });
            await BusStopCache.setDepartures(stop.atcoCode, departures);

            return {
                stop,
                departures,
                lastUpdated: Date.now(),
                isStale: false,
            };
        } catch (error) {
            Logger.warn('Failed to fetch departures for stop', { atcoCode: stop.atcoCode, error });
            return {
                stop,
                departures: [],
                lastUpdated: Date.now(),
                isStale: false,
            };
        }
    },

    /**
     * Refresh departures for both directions (4 stops total)
     */
    async refreshBothDirections(location: Coordinates): Promise<BothDirectionsResult> {
        try {
            const nearbyStops = await this.findNearest(location, 50);
            if (nearbyStops.length === 0) {
                throw new BusStopError(
                    'No bus stops found nearby',
                    BusStopErrorCode.NO_STOPS_FOUND
                );
            }

            const nearest = nearbyStops[0];
            const primaryBearing = nearest.bearing?.toUpperCase();
            const oppositeBearing = getOppositeBearing(nearest.bearing);

            // Find stops in each direction
            const primaryStops = nearbyStops.filter(
                stop => stop.bearing?.toUpperCase() === primaryBearing
            );
            const oppositeStops = oppositeBearing
                ? nearbyStops.filter(stop => stop.bearing?.toUpperCase() === oppositeBearing)
                : nearbyStops.filter(
                      stop => stop.bearing && stop.bearing?.toUpperCase() !== primaryBearing
                  );

            // Take up to 2 from each direction
            const stopsToShow = [...primaryStops.slice(0, 2), ...oppositeStops.slice(0, 2)];

            // Fetch fresh departures for all stops in parallel with partial success handling
            const results = await Promise.allSettled(
                stopsToShow.map(async stop => {
                    const departures = await fetchDeparturesForStop(stop, 3);
                    await BusStopCache.setDepartures(stop.atcoCode, departures);
                    return {
                        stop,
                        departures,
                        lastUpdated: Date.now(),
                        isStale: false,
                    };
                })
            );

            const boards: DepartureBoard[] = [];
            const partialFailures: StopFetchError[] = [];

            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    boards.push(result.value);
                } else {
                    const stop = stopsToShow[index];
                    const errorMessage =
                        result.reason instanceof Error
                            ? result.reason.message
                            : String(result.reason);
                    partialFailures.push({ stop, error: errorMessage });
                    Logger.warn('Failed to refresh departures for stop', {
                        atcoCode: stop.atcoCode,
                        error: errorMessage,
                    });
                }
            });

            if (boards.length > 0) {
                return {
                    success: true,
                    boards,
                    partialFailures: partialFailures.length > 0 ? partialFailures : undefined,
                };
            }

            throw new BusStopError(
                'Failed to refresh departures for all stops',
                BusStopErrorCode.DEPARTURES_UNAVAILABLE
            );
        } catch (error) {
            const busError =
                error instanceof BusStopError
                    ? error
                    : new BusStopError(String(error), BusStopErrorCode.DEPARTURES_UNAVAILABLE);

            return { success: false, error: busError };
        }
    },
};
