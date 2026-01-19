/**
 * Maps link utilities for opening walking directions in native maps apps
 */

import type { Coordinates } from '@/types';

/**
 * Detect iOS devices (iPhone, iPad, iPod)
 */
export function isIOS(): boolean {
    const ua = navigator.userAgent;
    // Standard iOS detection + iPad with iOS 13+ (reports as MacIntel)
    return (
        /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
}

/**
 * Generate a walking directions URL for native maps app.
 * Opens Apple Maps on iOS, Google Maps elsewhere.
 */
export function getDirectionsUrl(destination: Coordinates): string {
    const { latitude, longitude } = destination;

    if (isIOS()) {
        return `https://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=w`;
    }

    return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=walking`;
}
