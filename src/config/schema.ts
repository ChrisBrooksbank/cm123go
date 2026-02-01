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
            /** Maximum radius for expanded search (meters) */
            maxExpandedRadius: z.number().positive().default(3000),
            /** Radius increment per expansion (meters) */
            radiusIncrement: z.number().positive().default(500),
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
            /** Chelmsford center coordinates for distance checking */
            chelmsfordCenter: z
                .object({
                    latitude: z.number().default(51.7361),
                    longitude: z.number().default(0.469),
                })
                .default({}),
            /** Maximum distance from Chelmsford center before requiring postcode (meters) */
            maxDistanceFromCenter: z.number().positive().default(10000),
            /** Distance threshold (meters) within which nearby stops rank above distant favorites */
            nearbyPriorityRadius: z.number().nonnegative().default(150),
        })
        .default({}),
    trainStations: z
        .object({
            /** Rail Data Marketplace API URL */
            railDataApiUrl: z
                .string()
                .default(
                    'https://api1.raildata.org.uk/1010-live-arrival-and-departure-boards-arr-and-dep1_1/LDBWS/api/20220120'
                ),
            /** Rail Data Marketplace API key (from raildata.org.uk) */
            railDataApiKey: z.string().optional(),
            /** Cache TTL for departures in milliseconds (default: 60s) */
            departuresCacheTtl: z.number().positive().default(60000),
            /** Maximum departures to fetch per station */
            maxDeparturesPerStation: z.number().positive().default(5),
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
