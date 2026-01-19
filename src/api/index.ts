/**
 * API Module
 * External API clients and data fetching
 */

// Geocoding API (postcodes.io)
export { geocodePostcode, isValidUKPostcode, reverseGeocodeToPostcode } from './geocoding';

// NAPTAN API (bus stops)
export { fetchChelmsfordBusStops } from './naptan';

// BODS API (departures via Bus Open Data Service)
export { fetchDepartures, fetchDeparturesForStop, calculateMinutesUntil } from './departures';

// BODS SIRI-VM (real-time vehicle positions)
export {
    fetchVehiclePositions,
    fetchVehiclesNear,
    createBoundingBox,
    calculateDistance,
} from './bods-siri-vm';

// BODS GTFS (timetable data)
export {
    getScheduledDepartures,
    getTripDetails,
    getRouteDetails,
    isGTFSDataAvailable,
    clearGTFSCache,
} from './bods-gtfs';
