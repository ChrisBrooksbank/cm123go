/**
 * Centralized Type Definitions
 */

// Re-export config types for convenience
export type { AppConfig } from '@config/schema';

// Log levels
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogLevels {
    DEBUG: number;
    INFO: number;
    WARN: number;
    ERROR: number;
}

// Add your shared types here
