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
            /** BODS API key (API is accessed via /api/bods proxy) */
            bodsApiKey: z.string().optional(),
            /** Cache TTL for stops in milliseconds (default: 7 days) */
            stopsCacheTtl: z.number().positive().default(604800000),
            /** Cache TTL for departures in milliseconds (default: 60s) */
            departuresCacheTtl: z.number().positive().default(60000),
            /** Cache TTL for GTFS timetable in milliseconds (default: 1 day) */
            timetableCacheTtl: z.number().positive().default(86400000),
            /** Maximum distance to search for stops (meters) */
            maxSearchRadius: z.number().positive().default(1000),
            /** Radius for SIRI-VM vehicle search (meters) */
            vehicleSearchRadius: z.number().positive().default(10000),
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
