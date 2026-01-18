/**
 * Core Module
 * Core application logic and business rules
 */

// Geolocation services
export { GeolocationService, GeolocationError, isGeolocationSupported } from './geolocation';
export type { LocationResult } from './geolocation';

// Bus stop services
export { BusStopService, BusStopError, BusStopCache } from './bus-stops';
export type { NearestStopResult } from './bus-stops';
