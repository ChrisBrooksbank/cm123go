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
    // Add more config sections as needed
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
