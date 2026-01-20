/**
 * IndexedDB Cache for Bus Stops and Departures
 * Provides offline-first data access
 */

import { Logger } from '@utils/logger';
import { getConfig } from '@config/index';
import type { BusStop, Departure } from '@/types';

const DB_NAME = 'cm123go-cache';
const DB_VERSION = 2;
const STOPS_STORE = 'bus-stops';
const DEPARTURES_STORE = 'departures';
const TRAIN_DEPARTURES_STORE = 'train-departures';

interface CachedStops {
    id: 'chelmsford-stops';
    stops: BusStop[];
    timestamp: number;
}

interface CachedDepartures {
    atcoCode: string;
    departures: Departure[];
    timestamp: number;
}

/**
 * Open or create the IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            Logger.error('Failed to open IndexedDB', request.error);
            reject(new Error(request.error?.message ?? 'Failed to open IndexedDB'));
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = event => {
            const db = (event.target as IDBOpenDBRequest).result;

            // Create stores if they don't exist
            if (!db.objectStoreNames.contains(STOPS_STORE)) {
                db.createObjectStore(STOPS_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(DEPARTURES_STORE)) {
                db.createObjectStore(DEPARTURES_STORE, { keyPath: 'atcoCode' });
            }
            if (!db.objectStoreNames.contains(TRAIN_DEPARTURES_STORE)) {
                db.createObjectStore(TRAIN_DEPARTURES_STORE, { keyPath: 'crsCode' });
            }
        };
    });
}

/**
 * Bus stop and departure cache manager
 */
export const BusStopCache = {
    /**
     * Get cached bus stops
     * @returns Stops array or null if cache is empty/expired
     */
    async getStops(): Promise<BusStop[] | null> {
        try {
            const db = await openDatabase();
            const config = getConfig();
            const ttl = config.busStops.stopsCacheTtl;

            return await new Promise(resolve => {
                const transaction = db.transaction(STOPS_STORE, 'readonly');
                const store = transaction.objectStore(STOPS_STORE);
                const request = store.get('chelmsford-stops');

                request.onsuccess = () => {
                    const cached = request.result as CachedStops | undefined;
                    if (!cached) {
                        resolve(null);
                        return;
                    }

                    // Check if cache is expired
                    if (Date.now() - cached.timestamp > ttl) {
                        Logger.debug('Bus stops cache expired');
                        resolve(null);
                        return;
                    }

                    Logger.debug('Loaded bus stops from cache', {
                        count: cached.stops.length,
                    });
                    resolve(cached.stops);
                };

                request.onerror = () => {
                    Logger.warn('Failed to read stops cache', request.error);
                    resolve(null);
                };
            });
        } catch {
            Logger.warn('IndexedDB not available for stops cache');
            return null;
        }
    },

    /**
     * Store bus stops in cache
     */
    async setStops(stops: BusStop[]): Promise<void> {
        try {
            const db = await openDatabase();

            return await new Promise((resolve, reject) => {
                const transaction = db.transaction(STOPS_STORE, 'readwrite');
                const store = transaction.objectStore(STOPS_STORE);

                const data: CachedStops = {
                    id: 'chelmsford-stops',
                    stops,
                    timestamp: Date.now(),
                };

                const request = store.put(data);

                request.onsuccess = () => {
                    Logger.debug('Bus stops cached', { count: stops.length });
                    resolve();
                };

                request.onerror = () => {
                    Logger.warn('Failed to cache stops', request.error);
                    reject(new Error(request.error?.message ?? 'Failed to cache stops'));
                };
            });
        } catch (error) {
            Logger.warn('IndexedDB not available for caching stops', error);
        }
    },

    /**
     * Get cached departures for a stop
     * @returns Departures array or null if cache is empty/expired
     */
    async getDepartures(atcoCode: string): Promise<Departure[] | null> {
        try {
            const db = await openDatabase();
            const config = getConfig();
            const ttl = config.busStops.departuresCacheTtl;

            return await new Promise(resolve => {
                const transaction = db.transaction(DEPARTURES_STORE, 'readonly');
                const store = transaction.objectStore(DEPARTURES_STORE);
                const request = store.get(atcoCode);

                request.onsuccess = () => {
                    const cached = request.result as CachedDepartures | undefined;
                    if (!cached) {
                        resolve(null);
                        return;
                    }

                    // Check if cache is expired (short TTL for departures)
                    if (Date.now() - cached.timestamp > ttl) {
                        Logger.debug('Departures cache expired', { atcoCode });
                        resolve(null);
                        return;
                    }

                    Logger.debug('Loaded departures from cache', {
                        atcoCode,
                        count: cached.departures.length,
                    });
                    resolve(cached.departures);
                };

                request.onerror = () => {
                    Logger.warn('Failed to read departures cache', request.error);
                    resolve(null);
                };
            });
        } catch {
            Logger.warn('IndexedDB not available for departures cache');
            return null;
        }
    },

    /**
     * Store departures in cache
     */
    async setDepartures(atcoCode: string, departures: Departure[]): Promise<void> {
        try {
            const db = await openDatabase();

            return await new Promise((resolve, reject) => {
                const transaction = db.transaction(DEPARTURES_STORE, 'readwrite');
                const store = transaction.objectStore(DEPARTURES_STORE);

                const data: CachedDepartures = {
                    atcoCode,
                    departures,
                    timestamp: Date.now(),
                };

                const request = store.put(data);

                request.onsuccess = () => {
                    Logger.debug('Departures cached', { atcoCode });
                    resolve();
                };

                request.onerror = () => {
                    Logger.warn('Failed to cache departures', request.error);
                    reject(new Error(request.error?.message ?? 'Failed to cache departures'));
                };
            });
        } catch (error) {
            Logger.warn('IndexedDB not available for caching departures', error);
        }
    },

    /**
     * Clear all cached data
     */
    async clear(): Promise<void> {
        try {
            const db = await openDatabase();

            return await new Promise(resolve => {
                const transaction = db.transaction([STOPS_STORE, DEPARTURES_STORE], 'readwrite');

                transaction.objectStore(STOPS_STORE).clear();
                transaction.objectStore(DEPARTURES_STORE).clear();

                transaction.oncomplete = () => {
                    Logger.info('Cache cleared');
                    resolve();
                };

                transaction.onerror = () => {
                    Logger.warn('Failed to clear cache');
                    resolve();
                };
            });
        } catch {
            Logger.warn('IndexedDB not available for clearing cache');
        }
    },
};
