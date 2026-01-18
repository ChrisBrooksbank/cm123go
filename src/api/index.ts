/**
 * API Module
 * External API clients and data fetching
 */

// Geocoding API (postcodes.io)
export { geocodePostcode, isValidUKPostcode, reverseGeocodeToPostcode } from './geocoding';

// NAPTAN API (bus stops)
export { fetchChelmsfordBusStops } from './naptan';

// TransportAPI (departures)
export { fetchDepartures } from './departures';
