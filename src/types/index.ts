/**
 * Centralized Type Definitions
 */

import { z } from 'zod';

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

// --- Geolocation Types ---

/** Geographic coordinates (WGS84) */
export const CoordinatesSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
});
export type Coordinates = z.infer<typeof CoordinatesSchema>;

/** Location with coordinates and optional metadata */
export const LocationSchema = z.object({
    coordinates: CoordinatesSchema,
    accuracy: z.number().positive().optional(),
    source: z.enum(['gps', 'network', 'postcode', 'manual']),
    timestamp: z.number(),
    postcode: z.string().optional(),
});
export type Location = z.infer<typeof LocationSchema>;

/** Geolocation error codes matching browser API + custom codes */
export const GeolocationErrorCode = {
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
    NOT_SUPPORTED: 4,
    POSTCODE_NOT_FOUND: 5,
    NETWORK_ERROR: 6,
} as const;
export type GeolocationErrorCodeType =
    (typeof GeolocationErrorCode)[keyof typeof GeolocationErrorCode];

/** UK Postcode validation (basic pattern) */
export const UKPostcodeSchema = z
    .string()
    .regex(/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i, 'Invalid UK postcode format');
export type UKPostcode = z.infer<typeof UKPostcodeSchema>;

/** Geolocation options for the service */
export interface GeolocationOptions {
    /** Enable high accuracy mode (GPS on mobile) */
    enableHighAccuracy?: boolean;
    /** Timeout in milliseconds */
    timeout?: number;
    /** Maximum age of cached position in milliseconds */
    maximumAge?: number;
}

// --- Bus Stop Types ---

/** NAPTAN bus stop data */
export const BusStopSchema = z.object({
    atcoCode: z.string(),
    commonName: z.string(),
    indicator: z.string().optional(),
    bearing: z.string().optional(),
    coordinates: CoordinatesSchema,
    street: z.string().optional(),
    locality: z.string().optional(),
});
export type BusStop = z.infer<typeof BusStopSchema>;

/** Bus stop with calculated distance */
export const NearbyBusStopSchema = BusStopSchema.extend({
    distanceMeters: z.number(),
});
export type NearbyBusStop = z.infer<typeof NearbyBusStopSchema>;

/** Departure information */
export const DepartureSchema = z.object({
    line: z.string(),
    destination: z.string(),
    expectedDeparture: z.string(),
    minutesUntil: z.number(),
    status: z.enum(['on-time', 'delayed', 'cancelled', 'unknown']),
    operatorName: z.string().optional(),
});
export type Departure = z.infer<typeof DepartureSchema>;

/** Departure board response */
export const DepartureBoardSchema = z.object({
    stop: NearbyBusStopSchema,
    departures: z.array(DepartureSchema),
    lastUpdated: z.number(),
    isStale: z.boolean(),
});
export type DepartureBoard = z.infer<typeof DepartureBoardSchema>;

/** Bus stop error codes */
export const BusStopErrorCode = {
    NO_STOPS_FOUND: 1,
    DEPARTURES_UNAVAILABLE: 2,
    RATE_LIMITED: 3,
    API_KEY_MISSING: 4,
} as const;
export type BusStopErrorCodeType = (typeof BusStopErrorCode)[keyof typeof BusStopErrorCode];
