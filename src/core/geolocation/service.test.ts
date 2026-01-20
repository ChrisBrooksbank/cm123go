import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeolocationService } from './service';
import { setConfig, resetConfig } from '@config/index';
import { GeolocationErrorCode } from '@/types';

describe('GeolocationService', () => {
    beforeEach(() => {
        // Set up default config
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
        vi.restoreAllMocks();
        resetConfig();
    });

    describe('isSupported', () => {
        it('should return true when geolocation API is available', () => {
            vi.stubGlobal('navigator', { geolocation: {} });
            expect(GeolocationService.isSupported()).toBe(true);
        });

        it('should return false when geolocation API is not available', () => {
            vi.stubGlobal('navigator', {});
            expect(GeolocationService.isSupported()).toBe(false);
        });
    });

    describe('getLocationFromBrowser', () => {
        it('should return location on success', async () => {
            const mockPosition = {
                coords: {
                    latitude: 51.7356,
                    longitude: 0.4685,
                    accuracy: 50,
                },
            };

            vi.stubGlobal('navigator', {
                geolocation: {
                    getCurrentPosition: (
                        success: PositionCallback,
                        _error: PositionErrorCallback,
                        _options: PositionOptions
                    ) => {
                        success(mockPosition as GeolocationPosition);
                    },
                },
            });

            const result = await GeolocationService.getLocationFromBrowser();

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.location.coordinates.latitude).toBe(51.7356);
                expect(result.location.coordinates.longitude).toBe(0.4685);
                expect(result.location.source).toBe('gps');
            }
        });

        it('should classify low accuracy as network source', async () => {
            const mockPosition = {
                coords: {
                    latitude: 51.7356,
                    longitude: 0.4685,
                    accuracy: 500, // Low accuracy
                },
            };

            vi.stubGlobal('navigator', {
                geolocation: {
                    getCurrentPosition: (
                        success: PositionCallback,
                        _error: PositionErrorCallback,
                        _options: PositionOptions
                    ) => {
                        success(mockPosition as GeolocationPosition);
                    },
                },
            });

            const result = await GeolocationService.getLocationFromBrowser();

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.location.source).toBe('network');
            }
        });

        it('should return error when permission denied', async () => {
            vi.stubGlobal('navigator', {
                geolocation: {
                    getCurrentPosition: (
                        _success: PositionCallback,
                        error: PositionErrorCallback
                    ) => {
                        error({
                            code: 1,
                            message: 'User denied',
                            PERMISSION_DENIED: 1,
                            POSITION_UNAVAILABLE: 2,
                            TIMEOUT: 3,
                        });
                    },
                },
            });

            const result = await GeolocationService.getLocationFromBrowser();

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.code).toBe(GeolocationErrorCode.PERMISSION_DENIED);
                expect(result.requiresManualEntry).toBe(true);
            }
        });

        it('should return error when geolocation not supported', async () => {
            vi.stubGlobal('navigator', {});

            const result = await GeolocationService.getLocationFromBrowser();

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.code).toBe(GeolocationErrorCode.NOT_SUPPORTED);
                expect(result.requiresManualEntry).toBe(true);
            }
        });
    });

    describe('getLocationFromPostcode', () => {
        it('should return location for valid postcode', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        status: 200,
                        result: {
                            postcode: 'CM1 1AB',
                            latitude: 51.7356,
                            longitude: 0.4685,
                        },
                    }),
            });

            const result = await GeolocationService.getLocationFromPostcode('CM1 1AB');

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.location.coordinates.latitude).toBe(51.7356);
                expect(result.location.source).toBe('postcode');
                expect(result.location.postcode).toBe('CM1 1AB');
            }
        });

        it('should return error for invalid postcode format', async () => {
            const result = await GeolocationService.getLocationFromPostcode('INVALID');

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.code).toBe(GeolocationErrorCode.POSTCODE_NOT_FOUND);
            }
        });

        it('should return error when postcode not found', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
            });

            const result = await GeolocationService.getLocationFromPostcode('ZZ99 9ZZ');

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.code).toBe(GeolocationErrorCode.POSTCODE_NOT_FOUND);
            }
        });
    });

    describe('calculateDistance', () => {
        it('should calculate distance between two points', () => {
            const chelmsford = { latitude: 51.7356, longitude: 0.4685 };
            const london = { latitude: 51.5074, longitude: -0.1278 };

            const distance = GeolocationService.calculateDistance(chelmsford, london);

            // Should be approximately 50km
            expect(distance).toBeGreaterThan(45000);
            expect(distance).toBeLessThan(55000);
        });

        it('should return 0 for same location', () => {
            const point = { latitude: 51.7356, longitude: 0.4685 };

            const distance = GeolocationService.calculateDistance(point, point);

            expect(distance).toBe(0);
        });

        it('should handle international distances', () => {
            const london = { latitude: 51.5074, longitude: -0.1278 };
            const newYork = { latitude: 40.7128, longitude: -74.006 };

            const distance = GeolocationService.calculateDistance(london, newYork);

            // London to NYC is approximately 5570km
            expect(distance).toBeGreaterThan(5500000);
            expect(distance).toBeLessThan(5700000);
        });
    });
});
