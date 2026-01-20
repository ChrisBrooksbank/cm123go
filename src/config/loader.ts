/**
 * Configuration Loader
 * Loads and validates configuration from JSON file
 */

import { ConfigSchema, ConfigValidationError } from './schema';
import type { AppConfig } from './schema';

let config: AppConfig | null = null;

/**
 * Load configuration from JSON file
 * Call once at app startup
 */
export async function loadConfig(path = '/app.config.json'): Promise<AppConfig> {
    try {
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`Failed to load config: ${response.status}`);
        }

        const rawConfig: unknown = await response.json();
        const result = ConfigSchema.safeParse(rawConfig);

        if (!result.success) {
            // eslint-disable-next-line no-console -- Logger not available before config loads
            console.error('Config validation errors:', result.error.format());
            throw new ConfigValidationError('Invalid configuration', result.error);
        }

        config = result.data;
        return config;
    } catch (error) {
        if (error instanceof ConfigValidationError) {
            throw error;
        }
        // Return defaults if config file not found
        // eslint-disable-next-line no-console -- Logger not available before config loads
        console.warn('Config file not found, using defaults');
        config = ConfigSchema.parse({});
        return config;
    }
}

/**
 * Get loaded configuration
 * Throws if config not loaded yet
 */
export function getConfig(): AppConfig {
    if (!config) {
        throw new Error('Config not loaded. Call loadConfig() first.');
    }
    return config;
}

/**
 * Reset config (useful for testing)
 */
export function resetConfig(): void {
    config = null;
}

/**
 * Set config directly (useful for testing)
 */
export function setConfig(newConfig: AppConfig): void {
    config = newConfig;
}
