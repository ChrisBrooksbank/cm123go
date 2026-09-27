import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setConfig, resetConfig } from '@config/index';
import { BusStopCache } from './cache';
import { fetchDeparturesForStop } from '@api/departures';
import { BusStopService, deduplicateBySharedLines } from './service';
import type { BusStop, Coordinates, Departure, DepartureBoard, NearbyBusStop } from '@/types';

vi.mock('./cache', () => ({
    BusStopCache: {
        getStops: vi.fn(),
        setStops: vi.fn(),
        getDepartures: vi.fn(),
        setDepartures: vi.fn(),
        clear: vi.fn(),
    },
}));

vi.mock('@api/departures', () => ({
    fetchDeparturesForStop: vi.fn(),
}));

const mockedCache = vi.mocked(BusStopCache);
const mockedFetchDepartures = vi.mocked(fetchDeparturesForStop);

/** Chelmsford city centre, used as the user's location in tests */
const BASE_LOCATION: Coordinates = { latitude: 51.7356, longitude: 0.4685 };
const METERS_PER_DEGREE_LAT = 111320;

/** A stop `metersNorth` away from BASE_LOCATION (negative = south) */
function northOf(metersNorth: number): Coordinates {
    return {
        latitude: BASE_LOCATION.latitude + metersNorth / METERS_PER_DEGREE_LAT,
        longitude: BASE_LOCATION.longitude,
    };
}

function makeStop(overrides: Partial<BusStop> = {}): BusStop {
    return {
        atcoCode: '1000000001',
        commonName: 'Test Stop',
        bearing: 'N',
        coordinates: BASE_LOCATION,
        ...overrides,
    };
}

function makeNearbyStop(overrides: Partial<NearbyBusStop> = {}): NearbyBusStop {
    return {
        ...makeStop(),
        distanceMeters: 0,
        ...overrides,
    };
}

function makeDeparture(line: string, overrides: Partial<Departure> = {}): Departure {
    return {
        line,
        destination: 'Town Centre',
        expectedDeparture: new Date().toISOString(),
        minutesUntil: 5,
        status: 'on-time',
        ...overrides,
    };
}

describe('BusStopService', () => {
    beforeEach(() => {
        setConfig({
            debug: false,
            geolocation: {
                timeout: 10000,
                enableHighAccuracy: true,
                maximumAge: 60000,
                geocodingApiUrl: 'https://api.postcodes.io',
            },
            busStops: {
                naptanApiUrl: 'https://naptan.api.dft.gov.uk/v1',
                stopsCacheTtl: 604800000,
                departuresCacheTtl: 60000,
                timetableCacheTtl: 86400000,
                maxSearchRadius: 1000,
                maxExpandedRadius: 3000,
                radiusIncrement: 500,
                vehicleSearchRadius: 2000,
                chelmsfordBounds: {
                    north: 51.82,
                    south: 51.68,
                    east: 0.55,
                    west: 0.4,
                },
                chelmsfordCenter: {
                    latitude: 51.7361,
                    longitude: 0.469,
                },
                maxDistanceFromCenter: 10000,
                nearbyPriorityRadius: 150,
            },
            trainStations: {
                railDataApiUrl:
                    'https://api1.raildata.org.uk/1010-live-arrival-and-departure-boards-arr-and-dep1_1/LDBWS/api/20220120',
                departuresCacheTtl: 60000,
                maxDeparturesPerStation: 5,
            },
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
        resetConfig();
    });

    describe('findNearest', () => {
        it('returns stops sorted by distance, nearest first', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'FAR', coordinates: northOf(500) }),
                makeStop({ atcoCode: 'NEAR', coordinates: northOf(50) }),
            ]);

            const result = await BusStopService.findNearest(BASE_LOCATION, 2);

            expect(result.map(s => s.atcoCode)).toEqual(['NEAR', 'FAR']);
            expect(result[0].distanceMeters).toBeLessThan(result[1].distanceMeters);
        });

        it('excludes stops outside the search radius', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'IN_RANGE', coordinates: northOf(200) }),
                makeStop({ atcoCode: 'OUT_OF_RANGE', coordinates: northOf(5000) }),
            ]);

            const result = await BusStopService.findNearest(BASE_LOCATION, 10);

            expect(result.map(s => s.atcoCode)).toEqual(['IN_RANGE']);
        });

        it('respects a custom radius override', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'A', coordinates: northOf(200) }),
                makeStop({ atcoCode: 'B', coordinates: northOf(800) }),
            ]);

            const result = await BusStopService.findNearest(BASE_LOCATION, 10, 300);

            expect(result.map(s => s.atcoCode)).toEqual(['A']);
        });

        it('throws NO_STOPS_FOUND when the cache is empty', async () => {
            mockedCache.getStops.mockResolvedValue(null);

            await expect(BusStopService.findNearest(BASE_LOCATION)).rejects.toMatchObject({
                code: 1,
            });
        });

        it('throws NO_STOPS_FOUND when nothing is within radius', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'FAR', coordinates: northOf(5000) }),
            ]);

            await expect(BusStopService.findNearest(BASE_LOCATION)).rejects.toMatchObject({
                code: 1,
            });
        });
    });

    describe('getByAtcoCodes', () => {
        it('returns only the requested stops, with distances', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'WANTED', coordinates: northOf(2000) }),
                makeStop({ atcoCode: 'IGNORED' }),
            ]);

            const result = await BusStopService.getByAtcoCodes(['WANTED'], BASE_LOCATION);

            expect(result).toHaveLength(1);
            expect(result[0].atcoCode).toBe('WANTED');
            expect(result[0].distanceMeters).toBeGreaterThan(1000);
        });

        it('returns an empty array for an empty input', async () => {
            const result = await BusStopService.getByAtcoCodes([], BASE_LOCATION);

            expect(result).toEqual([]);
            expect(mockedCache.getStops).not.toHaveBeenCalled();
        });
    });

    describe('deduplicateBySharedLines', () => {
        function boardWith(atcoCode: string, bearing: string, lines: string[]): DepartureBoard {
            return {
                stop: makeNearbyStop({ atcoCode, bearing }),
                departures: lines.map(line => makeDeparture(line)),
                lastUpdated: Date.now(),
                isStale: false,
            };
        }

        it('drops a later stop that shares a line with an earlier same-bearing stop', () => {
            const boards = [
                boardWith('FIRST', 'N', ['1', '2']),
                boardWith('SECOND', 'N', ['2', '3']),
            ];

            const result = deduplicateBySharedLines(boards);

            expect(result.map(b => b.stop.atcoCode)).toEqual(['FIRST']);
        });

        it('keeps stops in different bearings even if they share a line', () => {
            const boards = [boardWith('NORTH', 'N', ['1']), boardWith('SOUTH', 'S', ['1'])];

            const result = deduplicateBySharedLines(boards);

            expect(result.map(b => b.stop.atcoCode)).toEqual(['NORTH', 'SOUTH']);
        });

        it('keeps same-bearing stops that share no lines', () => {
            const boards = [boardWith('FIRST', 'N', ['1']), boardWith('SECOND', 'N', ['9'])];

            const result = deduplicateBySharedLines(boards);

            expect(result.map(b => b.stop.atcoCode)).toEqual(['FIRST', 'SECOND']);
        });
    });

    describe('getBothDirections', () => {
        it('picks up to 2 stops per bearing and fetches their departures', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'N1', bearing: 'N', coordinates: northOf(50) }),
                makeStop({ atcoCode: 'N2', bearing: 'N', coordinates: northOf(100) }),
                makeStop({ atcoCode: 'N3', bearing: 'N', coordinates: northOf(150) }),
                makeStop({ atcoCode: 'S1', bearing: 'S', coordinates: northOf(-50) }),
                makeStop({ atcoCode: 'S2', bearing: 'S', coordinates: northOf(-100) }),
            ]);
            mockedCache.getDepartures.mockResolvedValue(null);
            mockedFetchDepartures.mockImplementation(stop =>
                Promise.resolve([makeDeparture(`line-${stop.atcoCode}`)])
            );

            const result = await BusStopService.getBothDirections(BASE_LOCATION);

            expect(result.success).toBe(true);
            if (result.success) {
                const codes = result.boards.map(b => b.stop.atcoCode).sort();
                expect(codes).toEqual(['N1', 'N2', 'S1', 'S2']);
            }
        });

        it('excludes stops with no departures and still succeeds', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'HAS_BUSES', bearing: 'N', coordinates: northOf(50) }),
                makeStop({ atcoCode: 'NO_BUSES', bearing: 'S', coordinates: northOf(-50) }),
            ]);
            mockedCache.getDepartures.mockResolvedValue(null);
            mockedFetchDepartures.mockImplementation(stop =>
                Promise.resolve(stop.atcoCode === 'HAS_BUSES' ? [makeDeparture('1')] : [])
            );

            const result = await BusStopService.getBothDirections(BASE_LOCATION);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.boards.map(b => b.stop.atcoCode)).toEqual(['HAS_BUSES']);
            }
        });

        it('does not fail the whole batch when one stop errors', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'OK', bearing: 'N', coordinates: northOf(50) }),
                makeStop({ atcoCode: 'BROKEN', bearing: 'S', coordinates: northOf(-50) }),
            ]);
            mockedCache.getDepartures.mockResolvedValue(null);
            mockedFetchDepartures.mockImplementation(stop =>
                stop.atcoCode === 'BROKEN'
                    ? Promise.reject(new Error('BODS unavailable'))
                    : Promise.resolve([makeDeparture('1')])
            );

            const result = await BusStopService.getBothDirections(BASE_LOCATION);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.boards.map(b => b.stop.atcoCode)).toEqual(['OK']);
            }
        });
    });

    describe('getExpandedStops', () => {
        it('does not resurface a stop already within the current radius', async () => {
            // "OFF_DIRECTION" sits well inside the original 1000m radius but was never
            // shown (e.g. wrong bearing for the initial curated list) - expanding the
            // search shouldn't just resurface it, since it isn't genuinely farther out.
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'OFF_DIRECTION', coordinates: northOf(600) }),
                makeStop({ atcoCode: 'GENUINELY_FARTHER', coordinates: northOf(1300) }),
            ]);

            const result = await BusStopService.getExpandedStops(BASE_LOCATION, [], 1000);

            expect(result.stops.map(s => s.atcoCode)).toEqual(['GENUINELY_FARTHER']);
        });

        it('still excludes stops already displayed', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'ALREADY_SHOWN', coordinates: northOf(1300) }),
                makeStop({ atcoCode: 'NEW', coordinates: northOf(1400) }),
            ]);

            const result = await BusStopService.getExpandedStops(
                BASE_LOCATION,
                ['ALREADY_SHOWN'],
                1000
            );

            expect(result.stops.map(s => s.atcoCode)).toEqual(['NEW']);
        });

        it('progressively widens the radius until it finds a new stop', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'FAR', coordinates: northOf(2800) }),
            ]);

            const result = await BusStopService.getExpandedStops(BASE_LOCATION, [], 1000);

            expect(result.stops.map(s => s.atcoCode)).toEqual(['FAR']);
            expect(result.actualRadius).toBeGreaterThanOrEqual(2800);
            expect(result.actualRadius).toBeLessThanOrEqual(3000);
        });

        it('gives up at maxExpandedRadius when nothing new is found', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'TOO_FAR', coordinates: northOf(5000) }),
            ]);

            const result = await BusStopService.getExpandedStops(BASE_LOCATION, [], 1000);

            expect(result.stops).toEqual([]);
            expect(result.actualRadius).toBe(3000);
        });
    });

    describe('refreshBothDirections', () => {
        it('bypasses the departures cache and stores fresh results', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'N1', bearing: 'N', coordinates: northOf(50) }),
                makeStop({ atcoCode: 'S1', bearing: 'S', coordinates: northOf(-50) }),
            ]);
            mockedFetchDepartures.mockResolvedValue([makeDeparture('1')]);

            const result = await BusStopService.refreshBothDirections(BASE_LOCATION);

            expect(result.success).toBe(true);
            expect(mockedCache.getDepartures).not.toHaveBeenCalled();
            expect(mockedCache.setDepartures).toHaveBeenCalledWith('N1', expect.any(Array));
            expect(mockedCache.setDepartures).toHaveBeenCalledWith('S1', expect.any(Array));
        });

        it('reports a partial failure when one stop errors, instead of failing entirely', async () => {
            mockedCache.getStops.mockResolvedValue([
                makeStop({ atcoCode: 'OK', bearing: 'N', coordinates: northOf(50) }),
                makeStop({ atcoCode: 'BROKEN', bearing: 'S', coordinates: northOf(-50) }),
            ]);
            mockedFetchDepartures.mockImplementation(stop =>
                stop.atcoCode === 'BROKEN'
                    ? Promise.reject(new Error('BODS unavailable'))
                    : Promise.resolve([makeDeparture('1')])
            );

            const result = await BusStopService.refreshBothDirections(BASE_LOCATION);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.boards.map(b => b.stop.atcoCode)).toEqual(['OK']);
                expect(result.partialFailures).toHaveLength(1);
                expect(result.partialFailures?.[0].stop.atcoCode).toBe('BROKEN');
            }
        });
    });
});
