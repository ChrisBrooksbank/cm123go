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
