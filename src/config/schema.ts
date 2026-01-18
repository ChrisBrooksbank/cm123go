/**
 * Configuration Schema
 * Define and validate your app configuration
 */

import { z } from 'zod';

export const ConfigSchema = z.object({
    debug: z.boolean().default(false),
    api: z
        .object({
            baseUrl: z.string().url(),
            timeout: z.number().positive().default(5000),
        })
        .optional(),
    geolocation: z
        .object({
            /** Default timeout for geolocation requests (ms) */
            timeout: z.number().positive().default(10000),
            /** Use high accuracy mode by default */
            enableHighAccuracy: z.boolean().default(true),
            /** Maximum age of cached position (ms) */
            maximumAge: z.number().nonnegative().default(60000),
            /** postcodes.io API base URL */
            geocodingApiUrl: z.string().url().default('https://api.postcodes.io'),
        })
        .default({}),
    busStops: z
        .object({
            /** NAPTAN API base URL */
            naptanApiUrl: z.string().url().default('https://naptan.api.dft.gov.uk/v1'),
            /** TransportAPI base URL */
            transportApiUrl: z.string().url().default('https://transportapi.com/v3'),
            /** TransportAPI app ID */
            transportApiAppId: z.string().optional(),
            /** TransportAPI app key */
            transportApiAppKey: z.string().optional(),
            /** Cache TTL for stops in milliseconds (default: 7 days) */
            stopsCacheTtl: z.number().positive().default(604800000),
            /** Cache TTL for departures in milliseconds (default: 60s) */
            departuresCacheTtl: z.number().positive().default(60000),
            /** Maximum distance to search for stops (meters) */
            maxSearchRadius: z.number().positive().default(1000),
            /** Chelmsford bounding box for filtering stops */
            chelmsfordBounds: z
                .object({
                    north: z.number().default(51.82),
                    south: z.number().default(51.68),
                    east: z.number().default(0.55),
                    west: z.number().default(0.4),
                })
                .default({}),
        })
        .default({}),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export class ConfigValidationError extends Error {
    constructor(
        message: string,
        public errors: z.ZodError
    ) {
        super(message);
        this.name = 'ConfigValidationError';
    }
}
