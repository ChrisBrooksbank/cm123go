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
import type { BusStop, Coordinates, NearbyBusStop, DepartureBoard } from '@/types';
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
 * Removes redundant stops going the same direction that share bus lines.
 * Keeps the nearest stop when duplicates are found.
 * Logic: if the same bus serves both stops, showing it twice is redundant.
 */
function deduplicateBySharedLines(boards: DepartureBoard[]): DepartureBoard[] {
    const result: DepartureBoard[] = [];

    for (const board of boards) {
        const lines = new Set(board.departures.map(d => d.line));

        // Check if we already have a stop with same bearing that shares any lines
        const isDuplicate = result.some(existing => {
            // Must be same direction
            if (existing.stop.bearing !== board.stop.bearing) return false;

            // Check if any lines overlap
            const existingLines = new Set(existing.departures.map(d => d.line));
            for (const line of lines) {
                if (existingLines.has(line)) return true; // Found shared line
            }
            return false;
        });

        if (!isDuplicate) {
            result.push(board);
        }
    }

    return result;
}

function normalizeSearchTerm(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/\b(bus|route|service|number|no)\b/g, ' ')
        .replace(/[^\da-z]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeServiceTerm(value: string): string {
    return normalizeSearchTerm(value).replace(/\s+/g, '');
}

function isRouteLikeQuery(query: string): boolean {
    return /^[a-z]?\d+[a-z]?$/.test(normalizeServiceTerm(query));
}

function getIndicatorMatchScore(indicator: string | undefined, query: string): number {
    if (!indicator) return 0;

    const normalizedIndicator = normalizeSearchTerm(indicator);
    const indicatorToken = normalizeServiceTerm(indicator);
    const queryToken = normalizeServiceTerm(query);
    const indicatorParts = normalizedIndicator.split(' ');

    if (indicatorToken === queryToken) return 125;
    if (indicatorParts.includes(queryToken)) return 115;
    if (indicatorToken.endsWith(queryToken) && queryToken.length >= 2) return 95;

    return 0;
}

function getStopMatchScore(stop: BusStop, query: string): number {
    const stopNameWithIndicator = [stop.commonName, stop.indicator].filter(Boolean).join(' ');
    const standName =
        stop.indicator && /^\d+[A-Za-z]?$/.test(stop.indicator)
            ? `${stop.commonName} stand ${stop.indicator}`
            : undefined;
    const routeLikeQuery = isRouteLikeQuery(query);

    if (routeLikeQuery) {
        const indicatorScore = getIndicatorMatchScore(stop.indicator, query);
        if (indicatorScore > 0) return indicatorScore;
    }

    const searchableParts = [
        stop.commonName,
        stopNameWithIndicator,
        standName,
        stop.street,
        stop.locality,
        routeLikeQuery ? undefined : stop.atcoCode,
    ];

    return searchableParts.reduce((bestScore, part) => {
        const normalizedPart = normalizeSearchTerm(part ?? '');
        if (!normalizedPart) return bestScore;
        if (normalizedPart === query) return Math.max(bestScore, 120);
        if (normalizedPart.startsWith(query)) return Math.max(bestScore, 100);
        if (routeLikeQuery && query.length === 1) return bestScore;
        if (normalizedPart.includes(query)) return Math.max(bestScore, 80);
        return bestScore;
    }, 0);
}

function getServiceMatchScore(board: DepartureBoard, query: string): number {
    const serviceQuery = normalizeServiceTerm(query);
    return board.departures.reduce((bestScore, departure) => {
        const line = normalizeServiceTerm(departure.line);
        const destination = normalizeSearchTerm(departure.destination);

        if (line === serviceQuery) return Math.max(bestScore, 110);
        if (serviceQuery.length >= 2 && line.startsWith(serviceQuery)) {
            return Math.max(bestScore, 90);
        }
        if (!isRouteLikeQuery(query) && destination.startsWith(query)) {
            return Math.max(bestScore, 70);
        }
        if (!isRouteLikeQuery(query) && destination.includes(query)) {
            return Math.max(bestScore, 60);
        }
        if (serviceQuery.length >= 2 && line.includes(serviceQuery)) {
            return Math.max(bestScore, 50);
        }

        return bestScore;
    }, 0);
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
            Logger.debug('Bus stops loaded from cache', { count: cached.length });
            return;
        }

        try {
            Logger.debug('Fetching bus stops from NAPTAN...');
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
     * @param customRadius - Optional custom search radius in meters (overrides config)
     * @returns Array of nearby bus stops sorted by distance
     */
    async findNearest(
        location: Coordinates,
        maxResults = 1,
        customRadius?: number
    ): Promise<NearbyBusStop[]> {
        const stops = await BusStopCache.getStops();

        if (!stops || stops.length === 0) {
            throw new BusStopError(
                'No bus stops available - try refreshing',
                BusStopErrorCode.NO_STOPS_FOUND
            );
        }

        const config = getConfig();
        const maxRadius = customRadius ?? config.busStops.maxSearchRadius;

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
     * Search nearby stops by stop name, street, locality, ATCO code, bus line, or destination.
     * Results remain distance-based from the user's current location.
     */
    async searchNearbyStops(
        location: Coordinates,
        query: string,
        maxResults = 8
    ): Promise<DepartureBoard[]> {
        const normalizedQuery = normalizeSearchTerm(query);
        if (!normalizedQuery) return [];

        const config = getConfig();
        const routeLikeQuery = isRouteLikeQuery(normalizedQuery);
        const nearbyStops = await this.findNearest(
            location,
            500,
            config.busStops.maxExpandedRadius
        );

        const stopMatches = nearbyStops
            .map(stop => ({
                stop,
                score: getStopMatchScore(stop, normalizedQuery),
            }))
            .filter(match => match.score > 0)
            .sort((a, b) => b.score - a.score || a.stop.distanceMeters - b.stop.distanceMeters);
        const stopMatchCodes = new Set(stopMatches.map(match => match.stop.atcoCode));
        const serviceCandidateLimit = routeLikeQuery
            ? normalizedQuery.length === 1
                ? 24
                : 50
            : stopMatches.length >= maxResults
              ? 0
              : 40;

        const serviceCandidates = nearbyStops
            .filter(stop => !stopMatchCodes.has(stop.atcoCode))
            .slice(0, serviceCandidateLimit);

        const [stopMatchBoards, serviceCandidateBoards] = await Promise.all([
            Promise.all(
                stopMatches.slice(0, maxResults).map(match => this.getDeparturesForStop(match.stop))
            ),
            Promise.all(serviceCandidates.map(stop => this.getDeparturesForStop(stop))),
        ]);

        const scoredStopBoards = stopMatchBoards.map(board => ({
            board,
            score:
                stopMatches.find(match => match.stop.atcoCode === board.stop.atcoCode)?.score ?? 0,
        }));
        const scoredServiceBoards = serviceCandidateBoards
            .map(board => ({
                board,
                score: getServiceMatchScore(board, normalizedQuery),
            }))
            .filter(match => match.score > 0);

        const seen = new Set<string>();
        return [...scoredStopBoards, ...scoredServiceBoards]
            .filter(board => {
                if (seen.has(board.board.stop.atcoCode)) return false;
                seen.add(board.board.stop.atcoCode);
                return true;
            })
            .sort(
                (a, b) =>
                    b.score - a.score || a.board.stop.distanceMeters - b.board.stop.distanceMeters
            )
            .map(match => match.board)
            .slice(0, maxResults);
    },

    /**
     * Get stops by their ATCO codes (for favorites)
     * @param atcoCodes - Array of ATCO codes to look up
     * @param location - User's current coordinates (for distance calculation)
     * @returns Array of stops with distances (regardless of search radius)
     */
    async getByAtcoCodes(atcoCodes: string[], location: Coordinates): Promise<NearbyBusStop[]> {
        if (atcoCodes.length === 0) return [];

        const stops = await BusStopCache.getStops();
        if (!stops || stops.length === 0) return [];

        const atcoSet = new Set(atcoCodes);
        return stops
            .filter(stop => atcoSet.has(stop.atcoCode))
            .map(stop => ({
                ...stop,
                distanceMeters: GeolocationService.calculateDistance(location, stop.coordinates),
            }));
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
        Logger.debug('Getting departures for both directions', { location });
        try {
            // Get many nearby stops to find multiple in each direction
            const nearbyStops = await this.findNearest(location, 50);
            Logger.debug('Found nearby stops', { count: nearbyStops.length });

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
                // Filter out stops with no departures, then deduplicate nearby stops with same lines
                const filteredBoards = boards.filter(b => b.departures.length > 0);
                const deduplicatedBoards = deduplicateBySharedLines(filteredBoards);

                if (deduplicatedBoards.length > 0) {
                    return {
                        success: true,
                        boards: deduplicatedBoards,
                        partialFailures: partialFailures.length > 0 ? partialFailures : undefined,
                    };
                }
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
     * Refresh departures for a single stop (bypasses cache, fetches fresh)
     */
    async refreshDeparturesForStop(stop: NearbyBusStop): Promise<DepartureBoard> {
        try {
            const departures = await fetchDeparturesForStop(stop, 3);
            await BusStopCache.setDepartures(stop.atcoCode, departures);
            return {
                stop,
                departures,
                lastUpdated: Date.now(),
                isStale: false,
            };
        } catch (error) {
            Logger.warn('Failed to refresh departures for stop', {
                atcoCode: stop.atcoCode,
                error,
            });
            return {
                stop,
                departures: [],
                lastUpdated: Date.now(),
                isStale: false,
            };
        }
    },

    /**
     * Get expanded list of stops (for "Show more" feature)
     * Returns stops not already displayed, with progressive radius expansion
     * @param location - User's current coordinates
     * @param excludeAtcoCodes - ATCO codes to exclude (already displayed)
     * @param currentRadius - Current search radius (will expand from here)
     * @param maxResults - Maximum number of stops to return (default: 6)
     * @returns Object with stops and the actual radius used
     */
    async getExpandedStops(
        location: Coordinates,
        excludeAtcoCodes: string[],
        currentRadius: number,
        maxResults = 6
    ): Promise<{ stops: NearbyBusStop[]; actualRadius: number }> {
        const config = getConfig();
        const excludeSet = new Set(excludeAtcoCodes);
        let searchRadius = currentRadius + config.busStops.radiusIncrement;

        // Try progressively larger radii until we find stops or hit max
        while (searchRadius <= config.busStops.maxExpandedRadius) {
            const nearbyStops = await this.findNearest(location, 100, searchRadius);
            const newStops = nearbyStops
                .filter(stop => !excludeSet.has(stop.atcoCode))
                .slice(0, maxResults);

            if (newStops.length > 0) {
                return { stops: newStops, actualRadius: searchRadius };
            }

            // No new stops at this radius, try next level
            searchRadius += config.busStops.radiusIncrement;
        }

        // Reached max radius with no new stops
        return { stops: [], actualRadius: config.busStops.maxExpandedRadius };
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
