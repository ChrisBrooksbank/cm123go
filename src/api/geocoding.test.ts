import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { geocodePostcode, isValidUKPostcode } from './geocoding';
import { setConfig, resetConfig } from '@config/index';
import { GeolocationErrorCode } from '@/types';
import { GeolocationError } from '@core/geolocation/errors';

describe('geocoding', () => {
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

    describe('isValidUKPostcode', () => {
        it('should return true for valid postcodes with space', () => {
            expect(isValidUKPostcode('CM1 1AB')).toBe(true);
            expect(isValidUKPostcode('SW1A 1AA')).toBe(true);
            expect(isValidUKPostcode('EC1A 1BB')).toBe(true);
            expect(isValidUKPostcode('M1 1AA')).toBe(true);
            expect(isValidUKPostcode('B33 8TH')).toBe(true);
        });

        it('should return true for valid postcodes without space', () => {
            expect(isValidUKPostcode('CM11AB')).toBe(true);
            expect(isValidUKPostcode('SW1A1AA')).toBe(true);
            expect(isValidUKPostcode('EC1A1BB')).toBe(true);
        });

        it('should return true for lowercase postcodes', () => {
            expect(isValidUKPostcode('cm1 1ab')).toBe(true);
            expect(isValidUKPostcode('sw1a1aa')).toBe(true);
        });

        it('should return false for invalid postcodes', () => {
            expect(isValidUKPostcode('INVALID')).toBe(false);
            expect(isValidUKPostcode('12345')).toBe(false);
            expect(isValidUKPostcode('')).toBe(false);
            expect(isValidUKPostcode('ABC')).toBe(false);
            expect(isValidUKPostcode('123 ABC')).toBe(false);
        });
    });

    describe('geocodePostcode', () => {
        it('should return coordinates for valid postcode', async () => {
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

            const result = await geocodePostcode('CM1 1AB');

            expect(result.coordinates.latitude).toBe(51.7356);
            expect(result.coordinates.longitude).toBe(0.4685);
            expect(result.normalizedPostcode).toBe('CM1 1AB');
        });

        it('should normalize postcodes to uppercase without spaces', async () => {
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

            await geocodePostcode('cm1 1ab');

            expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('CM11AB'));
        });

        it('should throw GeolocationError for invalid postcode format', async () => {
            await expect(geocodePostcode('INVALID')).rejects.toThrow(GeolocationError);
            await expect(geocodePostcode('INVALID')).rejects.toMatchObject({
                code: GeolocationErrorCode.POSTCODE_NOT_FOUND,
            });
        });

        it('should throw GeolocationError for 404 response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
            });

            await expect(geocodePostcode('ZZ99 9ZZ')).rejects.toThrow(GeolocationError);
            await expect(geocodePostcode('ZZ99 9ZZ')).rejects.toMatchObject({
                code: GeolocationErrorCode.POSTCODE_NOT_FOUND,
            });
        });

        it('should throw GeolocationError for network errors', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

            await expect(geocodePostcode('CM1 1AB')).rejects.toThrow(GeolocationError);
            await expect(geocodePostcode('CM1 1AB')).rejects.toMatchObject({
                code: GeolocationErrorCode.NETWORK_ERROR,
            });
        });

        it('should throw GeolocationError for invalid API response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        unexpected: 'response',
                    }),
            });

            await expect(geocodePostcode('CM1 1AB')).rejects.toThrow(GeolocationError);
            await expect(geocodePostcode('CM1 1AB')).rejects.toMatchObject({
                code: GeolocationErrorCode.NETWORK_ERROR,
            });
        });

        it('should throw GeolocationError when result is null', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        status: 200,
                        result: null,
                    }),
            });

            await expect(geocodePostcode('CM1 1AB')).rejects.toThrow(GeolocationError);
            await expect(geocodePostcode('CM1 1AB')).rejects.toMatchObject({
                code: GeolocationErrorCode.POSTCODE_NOT_FOUND,
            });
        });
    });
});
