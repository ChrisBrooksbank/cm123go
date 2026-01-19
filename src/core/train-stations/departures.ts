/**
 * Train Departure Service
 * Orchestrates fetching train departures with caching
 */

import { Logger } from '@utils/logger';
import { fetchTrainDepartures } from '@api/huxley';
import { TrainStationCache } from './cache';
import { TrainStationError } from './errors';
import type { NearbyTrainStation, TrainDepartureBoard, TrainStationErrorCode } from '@/types';

/** Result type for single station departure fetch */
type TrainDepartureResult =
    | { success: true; board: TrainDepartureBoard }
    | { success: false; error: TrainStationError };

/**
 * Train Departure Service - fetches and caches train departures
 */
export const TrainDepartureService = {
    /**
     * Get departures for a single station (cache-first)
     */
    async getDeparturesForStation(station: NearbyTrainStation): Promise<TrainDepartureResult> {
        const { crsCode } = station;

        try {
            // Try cache first
            const cached = await TrainStationCache.getDepartures(crsCode);
            if (cached !== null) {
                Logger.debug('Using cached train departures', { crsCode });
                return {
                    success: true,
                    board: {
                        station,
                        departures: cached,
                        lastUpdated: Date.now(),
                        isStale: true,
                    },
                };
            }

            // Fetch fresh departures
            const departures = await fetchTrainDepartures(crsCode);

            // Cache the result (even if empty)
            await TrainStationCache.setDepartures(crsCode, departures);

            return {
                success: true,
                board: {
                    station,
                    departures,
                    lastUpdated: Date.now(),
                    isStale: false,
                },
            };
        } catch (error) {
            Logger.error('Failed to get train departures', { crsCode, error });
            return {
                success: false,
                error: new TrainStationError(
                    `Failed to fetch departures for ${station.name}`,
                    1 as typeof TrainStationErrorCode.DEPARTURES_UNAVAILABLE,
                    error instanceof Error ? error : undefined
                ),
            };
        }
    },

    /**
     * Refresh departures for a single station (bypass cache)
     */
    async refreshDeparturesForStation(station: NearbyTrainStation): Promise<TrainDepartureResult> {
        const { crsCode } = station;

        try {
            const departures = await fetchTrainDepartures(crsCode);

            // Update cache
            await TrainStationCache.setDepartures(crsCode, departures);

            return {
                success: true,
                board: {
                    station,
                    departures,
                    lastUpdated: Date.now(),
                    isStale: false,
                },
            };
        } catch (error) {
            Logger.error('Failed to refresh train departures', { crsCode, error });
            return {
                success: false,
                error: new TrainStationError(
                    `Failed to refresh departures for ${station.name}`,
                    1 as typeof TrainStationErrorCode.DEPARTURES_UNAVAILABLE,
                    error instanceof Error ? error : undefined
                ),
            };
        }
    },

    /**
     * Get departures for multiple stations in parallel
     * Supports partial success - returns results for stations that succeeded
     */
    async getDeparturesForAllStations(
        stations: NearbyTrainStation[]
    ): Promise<TrainDepartureResult[]> {
        if (stations.length === 0) {
            return [];
        }

        Logger.info('Fetching train departures for stations', {
            count: stations.length,
            stations: stations.map(s => s.crsCode),
        });

        const results = await Promise.allSettled(
            stations.map(station => this.getDeparturesForStation(station))
        );

        return results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            }

            // Promise rejected - wrap in error
            return {
                success: false as const,
                error: new TrainStationError(
                    `Failed to fetch departures for ${stations[index].name}`,
                    1 as typeof TrainStationErrorCode.DEPARTURES_UNAVAILABLE,
                    result.reason instanceof Error ? result.reason : undefined
                ),
            };
        });
    },

    /**
     * Refresh departures for multiple stations in parallel
     */
    async refreshDeparturesForAllStations(
        stations: NearbyTrainStation[]
    ): Promise<TrainDepartureResult[]> {
        if (stations.length === 0) {
            return [];
        }

        Logger.info('Refreshing train departures for stations', {
            count: stations.length,
            stations: stations.map(s => s.crsCode),
        });

        const results = await Promise.allSettled(
            stations.map(station => this.refreshDeparturesForStation(station))
        );

        return results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            }

            return {
                success: false as const,
                error: new TrainStationError(
                    `Failed to refresh departures for ${stations[index].name}`,
                    1 as typeof TrainStationErrorCode.DEPARTURES_UNAVAILABLE,
                    result.reason instanceof Error ? result.reason : undefined
                ),
            };
        });
    },
};
