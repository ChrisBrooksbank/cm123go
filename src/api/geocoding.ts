/**
 * UK Postcode Geocoding API Client
 * Uses postcodes.io (free, no API key required)
 */

import { z } from 'zod';
import { Logger } from '@utils/logger';
import { retryWithBackoff } from '@utils/helpers';
import { getConfig } from '@config/index';
import { GeolocationError } from '@core/geolocation/errors';
import type { Coordinates } from '@/types';
import { GeolocationErrorCode, UKPostcodeSchema } from '@/types';

/**
 * postcodes.io API response schema
 */
const PostcodeApiResponseSchema = z.object({
    status: z.number(),
    result: z
        .object({
            postcode: z.string(),
            latitude: z.number(),
            longitude: z.number(),
            region: z.string().optional(),
            admin_district: z.string().optional(),
        })
        .nullable(),
});

type PostcodeApiResponse = z.infer<typeof PostcodeApiResponseSchema>;

/**
 * Geocode a UK postcode to coordinates using postcodes.io API
 *
 * @param postcode - UK postcode (e.g., "CM1 1AB" or "CM11AB")
 * @returns Promise resolving to coordinates
 * @throws GeolocationError if postcode not found or network error
 */
export async function geocodePostcode(postcode: string): Promise<{
    coordinates: Coordinates;
    normalizedPostcode: string;
}> {
    // Validate postcode format
    const parseResult = UKPostcodeSchema.safeParse(postcode);
    if (!parseResult.success) {
        Logger.warn('Invalid postcode format', { postcode });
        throw new GeolocationError(
            `Invalid UK postcode format: ${postcode}`,
            GeolocationErrorCode.POSTCODE_NOT_FOUND
        );
    }

    const config = getConfig();
    const baseUrl = config.geolocation.geocodingApiUrl;

    // Normalize postcode (remove spaces, uppercase)
    const normalizedPostcode = postcode.replace(/\s+/g, '').toUpperCase();
    const url = `${baseUrl}/postcodes/${encodeURIComponent(normalizedPostcode)}`;

    Logger.debug('Geocoding postcode', { postcode: normalizedPostcode, url });

    try {
        const response = await retryWithBackoff(
            async () => {
                const res = await fetch(url);
                if (!res.ok) {
                    if (res.status === 404) {
                        throw new GeolocationError(
                            `Postcode not found: ${normalizedPostcode}`,
                            GeolocationErrorCode.POSTCODE_NOT_FOUND
                        );
                    }
                    throw new Error(`API error: ${res.status}`);
                }
                return res.json() as Promise<unknown>;
            },
            3,
            500
        );

        const validated = PostcodeApiResponseSchema.safeParse(response);
        if (!validated.success) {
            Logger.error('Invalid API response', validated.error);
            throw new GeolocationError(
                'Invalid response from geocoding API',
                GeolocationErrorCode.NETWORK_ERROR
            );
        }

        const data: PostcodeApiResponse = validated.data;
        if (data.status !== 200 || !data.result) {
            throw new GeolocationError(
                `Postcode not found: ${normalizedPostcode}`,
                GeolocationErrorCode.POSTCODE_NOT_FOUND
            );
        }

        Logger.success('Postcode geocoded successfully', {
            postcode: data.result.postcode,
            lat: data.result.latitude,
            lng: data.result.longitude,
        });

        return {
            coordinates: {
                latitude: data.result.latitude,
                longitude: data.result.longitude,
            },
            normalizedPostcode: data.result.postcode,
        };
    } catch (error) {
        if (error instanceof GeolocationError) {
            throw error;
        }
        Logger.error('Geocoding request failed', String(error));
        throw new GeolocationError(
            'Network error during geocoding',
            GeolocationErrorCode.NETWORK_ERROR,
            error instanceof Error ? error : undefined
        );
    }
}

/**
 * Validate a UK postcode format without making an API call
 */
export function isValidUKPostcode(postcode: string): boolean {
    return UKPostcodeSchema.safeParse(postcode).success;
}

/**
 * Reverse geocode schema for postcodes.io nearest postcode response
 */
const ReverseGeocodeResponseSchema = z.object({
    status: z.number(),
    result: z
        .array(
            z.object({
                postcode: z.string(),
                distance: z.number(),
            })
        )
        .nullable(),
});

/**
 * Reverse geocode coordinates to get the nearest UK postcode
 *
 * @param coordinates - Latitude and longitude
 * @returns Promise resolving to the nearest postcode
 * @throws GeolocationError if no postcode found or network error
 */
export async function reverseGeocodeToPostcode(coordinates: Coordinates): Promise<string> {
    const config = getConfig();
    const baseUrl = config.geolocation.geocodingApiUrl;

    const url = `${baseUrl}/postcodes?lon=${coordinates.longitude}&lat=${coordinates.latitude}&limit=1`;

    Logger.debug('Reverse geocoding coordinates', {
        lat: coordinates.latitude,
        lng: coordinates.longitude,
        url,
    });

    try {
        const response = await retryWithBackoff(
            async () => {
                const res = await fetch(url);
                if (!res.ok) {
                    throw new Error(`API error: ${res.status}`);
                }
                return res.json() as Promise<unknown>;
            },
            3,
            500
        );

        const validated = ReverseGeocodeResponseSchema.safeParse(response);
        if (!validated.success) {
            Logger.error('Invalid reverse geocode response', validated.error);
            throw new GeolocationError(
                'Invalid response from geocoding API',
                GeolocationErrorCode.NETWORK_ERROR
            );
        }

        if (
            validated.data.status !== 200 ||
            !validated.data.result ||
            validated.data.result.length === 0
        ) {
            throw new GeolocationError(
                'No postcode found for these coordinates',
                GeolocationErrorCode.POSTCODE_NOT_FOUND
            );
        }

        const postcode = validated.data.result[0].postcode;
        Logger.success('Reverse geocode successful', { postcode });
        return postcode;
    } catch (error) {
        if (error instanceof GeolocationError) {
            throw error;
        }
        Logger.error('Reverse geocoding failed', String(error));
        throw new GeolocationError(
            'Network error during reverse geocoding',
            GeolocationErrorCode.NETWORK_ERROR,
            error instanceof Error ? error : undefined
        );
    }
}
