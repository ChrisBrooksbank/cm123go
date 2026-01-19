/**
 * IndexedDB Cache for Train Departures
 * Uses shared database with bus cache
 */

import { Logger } from '@utils/logger';
import { getConfig } from '@config/index';
import type { TrainDeparture } from '@/types';

const DB_NAME = 'cm123go-cache';
const DB_VERSION = 2;
const TRAIN_DEPARTURES_STORE = 'train-departures';

interface CachedTrainDepartures {
    crsCode: string;
    departures: TrainDeparture[];
    timestamp: number;
}

/**
 * Open the IndexedDB database (shared with bus cache)
 */
function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            Logger.error('Failed to open IndexedDB', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = event => {
            const db = (event.target as IDBOpenDBRequest).result;

            // Create train departures store if it doesn't exist
            if (!db.objectStoreNames.contains(TRAIN_DEPARTURES_STORE)) {
                db.createObjectStore(TRAIN_DEPARTURES_STORE, { keyPath: 'crsCode' });
            }
        };
    });
}

/**
 * Train departure cache manager
 */
export const TrainStationCache = {
    /**
     * Get cached train departures for a station
     * @returns Departures array or null if cache is empty/expired
     */
    async getDepartures(crsCode: string): Promise<TrainDeparture[] | null> {
        try {
            const db = await openDatabase();
            const config = getConfig();
            const ttl = config.trainStations.departuresCacheTtl;

            return new Promise(resolve => {
                const transaction = db.transaction(TRAIN_DEPARTURES_STORE, 'readonly');
                const store = transaction.objectStore(TRAIN_DEPARTURES_STORE);
                const request = store.get(crsCode);

                request.onsuccess = () => {
                    const cached = request.result as CachedTrainDepartures | undefined;
                    if (!cached) {
                        resolve(null);
                        return;
                    }

                    // Check if cache is expired (short TTL for departures)
                    if (Date.now() - cached.timestamp > ttl) {
                        Logger.debug('Train departures cache expired', { crsCode });
                        resolve(null);
                        return;
                    }

                    Logger.debug('Loaded train departures from cache', {
                        crsCode,
                        count: cached.departures.length,
                    });
                    resolve(cached.departures);
                };

                request.onerror = () => {
                    Logger.warn('Failed to read train departures cache', request.error);
                    resolve(null);
                };
            });
        } catch {
            Logger.warn('IndexedDB not available for train departures cache');
            return null;
        }
    },

    /**
     * Store train departures in cache
     */
    async setDepartures(crsCode: string, departures: TrainDeparture[]): Promise<void> {
        try {
            const db = await openDatabase();

            return new Promise((resolve, reject) => {
                const transaction = db.transaction(TRAIN_DEPARTURES_STORE, 'readwrite');
                const store = transaction.objectStore(TRAIN_DEPARTURES_STORE);

                const data: CachedTrainDepartures = {
                    crsCode,
                    departures,
                    timestamp: Date.now(),
                };

                const request = store.put(data);

                request.onsuccess = () => {
                    Logger.debug('Train departures cached', { crsCode });
                    resolve();
                };

                request.onerror = () => {
                    Logger.warn('Failed to cache train departures', request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            Logger.warn('IndexedDB not available for caching train departures', error);
        }
    },

    /**
     * Clear all cached train departures
     */
    async clear(): Promise<void> {
        try {
            const db = await openDatabase();

            return new Promise(resolve => {
                const transaction = db.transaction(TRAIN_DEPARTURES_STORE, 'readwrite');
                transaction.objectStore(TRAIN_DEPARTURES_STORE).clear();

                transaction.oncomplete = () => {
                    Logger.info('Train departures cache cleared');
                    resolve();
                };

                transaction.onerror = () => {
                    Logger.warn('Failed to clear train departures cache');
                    resolve();
                };
            });
        } catch {
            Logger.warn('IndexedDB not available for clearing train cache');
        }
    },
};
