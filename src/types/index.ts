/**
 * Centralized Type Definitions
 */

import { z } from 'zod';

// --- Geolocation Types ---

/** Geographic coordinates (WGS84) */
const CoordinatesSchema = z.object({
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
const NearbyBusStopSchema = BusStopSchema.extend({
    distanceMeters: z.number(),
});
export type NearbyBusStop = z.infer<typeof NearbyBusStopSchema>;

/** Departure information */
const DepartureSchema = z.object({
    line: z.string(),
    destination: z.string(),
    expectedDeparture: z.string(),
    minutesUntil: z.number(),
    status: z.enum(['on-time', 'delayed', 'cancelled', 'scheduled', 'unknown']),
    operatorName: z.string().optional(),
    /** True if departure time is from real-time SIRI-VM data */
    isRealTime: z.boolean().optional(),
});
export type Departure = z.infer<typeof DepartureSchema>;

/** Departure board response */
const _DepartureBoardSchema = z.object({
    stop: NearbyBusStopSchema,
    departures: z.array(DepartureSchema),
    lastUpdated: z.number(),
    isStale: z.boolean(),
});
export type DepartureBoard = z.infer<typeof _DepartureBoardSchema>;

/** Bus stop error codes */
export const BusStopErrorCode = {
    NO_STOPS_FOUND: 1,
    DEPARTURES_UNAVAILABLE: 2,
    RATE_LIMITED: 3,
    API_KEY_MISSING: 4,
    SIRI_VM_UNAVAILABLE: 5,
    GTFS_DATA_OUTDATED: 6,
    XML_PARSE_ERROR: 7,
} as const;
export type BusStopErrorCodeType = (typeof BusStopErrorCode)[keyof typeof BusStopErrorCode];

// --- BODS (Bus Open Data Service) Types ---

/** Bounding box for geographic queries */
const _BoundingBoxSchema = z.object({
    minLatitude: z.number().min(-90).max(90),
    maxLatitude: z.number().min(-90).max(90),
    minLongitude: z.number().min(-180).max(180),
    maxLongitude: z.number().min(-180).max(180),
});
export type BoundingBox = z.infer<typeof _BoundingBoxSchema>;

/** SIRI-VM vehicle activity from BODS */
export interface VehicleActivity {
    recordedAtTime: Date;
    validUntilTime: Date;
    vehicleRef: string;
    lineRef: string;
    directionRef: string;
    operatorRef: string;
    latitude: number;
    longitude: number;
    bearing?: number;
    blockRef?: string;
    vehicleJourneyRef?: string;
    destinationRef?: string;
    destinationName?: string;
    originRef?: string;
    originName?: string;
}

/** GTFS stop time entry */
export interface GTFSStopTime {
    tripId: string;
    arrivalTime: string;
    departureTime: string;
    stopId: string;
    stopSequence: number;
}

/** GTFS trip entry */
export interface GTFSTrip {
    tripId: string;
    routeId: string;
    serviceId: string;
    tripHeadsign?: string;
    directionId?: number;
    blockId?: string;
}

/** GTFS route entry */
export interface GTFSRoute {
    routeId: string;
    routeShortName: string;
    routeLongName?: string;
    operatorName?: string;
}
