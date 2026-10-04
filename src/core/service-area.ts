/**
 * Service Area
 * The app only covers buses and trains around Chelmsford
 */

import { getConfig } from '@config/index';
import { Logger } from '@utils/logger';
import { GeolocationService } from './geolocation';
import type { Coordinates } from '@/types';

/** Message shown when the user's location is outside the area the app covers */
export const OUTSIDE_AREA_MESSAGE =
    "You're outside Chelmsford. This app only shows buses and trains around Chelmsford.";

/**
 * Check if coordinates are within the Chelmsford service area
 * Returns false if user appears far from Chelmsford (e.g., VPN user)
 */
export function isWithinChelmsfordArea(coordinates: Coordinates): boolean {
    const config = getConfig();
    const { chelmsfordCenter, maxDistanceFromCenter } = config.busStops;
    const distance = GeolocationService.calculateDistance(coordinates, chelmsfordCenter);
    Logger.debug('Distance from Chelmsford', { distance: Math.round(distance) });
    return distance <= maxDistanceFromCenter;
}
