/**
 * UI Rendering Functions
 * Handles all HTML rendering for departure boards and display items
 */

import { getConfig } from '@/config';
import { getDirectionsUrl } from '@/utils/maps-link';
import { FavoritesManager } from '@/utils/favorites';
import type { Departure, DepartureBoard, TrainDeparture, TrainDepartureBoard } from '@/types';
import {
    type DisplayItem,
    getCurrentSearchRadius,
    hasReachedMaxRadius,
    setDisplayedAtcoCodes,
    setAllDisplayItems,
} from '@/core/app-state';

/**
 * Get bearing direction label
 */
function getBearingLabel(bearing: string | undefined): string {
    if (!bearing) return '';
    const labels: Record<string, string> = {
        N: 'Northbound',
        S: 'Southbound',
        E: 'Eastbound',
        W: 'Westbound',
        NE: 'North-East',
        NW: 'North-West',
        SE: 'South-East',
        SW: 'South-West',
    };
    return labels[bearing.toUpperCase()] || bearing;
}

/**
 * Format distance for display
 */
function formatDistance(meters: number): string {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)}km away`;
    }
    return `${Math.round(meters)}m away`;
}

/**
 * Render a single departure row
 */
function renderDeparture(departure: Departure): string {
    const timeClass = departure.status === 'delayed' ? 'time delayed' : 'time';
    const timeDisplay = departure.minutesUntil <= 0 ? 'Due' : `${departure.minutesUntil} min`;
    const sourceIndicator = departure.isRealTime
        ? '<span class="source-badge realtime">Live</span>'
        : '<span class="source-badge scheduled">Scheduled</span>';

    return `
        <div class="departure-row">
            <span class="line-badge">${departure.line}</span>
            <span class="destination">${departure.destination}</span>
            <span class="time-container">
                ${sourceIndicator}
                <span class="${timeClass}">${timeDisplay}</span>
            </span>
        </div>
    `;
}

/**
 * Render a single departure board card
 */
function renderDepartureCard(board: DepartureBoard): string {
    const indicator = board.stop.indicator ? ` (${board.stop.indicator})` : '';
    const bearingBadge = board.stop.bearing
        ? `<span class="bearing-badge">${getBearingLabel(board.stop.bearing)}</span>`
        : '';

    const isFavorite = FavoritesManager.isFavorite(board.stop.atcoCode);
    const favoriteClass = isFavorite ? 'favorite-btn active' : 'favorite-btn';
    const favoriteText = isFavorite ? 'Favorited' : 'Favorite';
    const favoriteAriaPressed = isFavorite ? 'true' : 'false';
    const favoriteAriaLabel = isFavorite
        ? `Remove ${board.stop.commonName} from favorites`
        : `Add ${board.stop.commonName} to favorites`;

    const departuresHtml =
        board.departures.length > 0
            ? board.departures.map(renderDeparture).join('')
            : '<p class="no-departures">No buses expected soon</p>';

    const directionsUrl = getDirectionsUrl(board.stop.coordinates);

    return `
        <div class="card" data-atco-code="${board.stop.atcoCode}">
            <div class="stop-header">
                <h2>${board.stop.commonName}${indicator}</h2>
                ${bearingBadge}
            </div>
            <div class="card-meta">
                <span class="distance">${formatDistance(board.stop.distanceMeters)}</span>
                <a href="${directionsUrl}" class="directions-link" target="_blank" rel="noopener" aria-label="Get walking directions to this stop">Directions</a>
                <button class="${favoriteClass}" data-atco-code="${board.stop.atcoCode}" aria-pressed="${favoriteAriaPressed}" aria-label="${favoriteAriaLabel}">${favoriteText}</button>
            </div>
            <div class="departures-list">${departuresHtml}</div>
        </div>
    `;
}

/**
 * Render a single train departure row
 */
function renderTrainDeparture(departure: TrainDeparture): string {
    const timeDisplay = departure.minutesUntil <= 0 ? 'Due' : `${departure.minutesUntil} min`;
    const sourceIndicator = departure.isRealTime
        ? '<span class="source-badge realtime">Live</span>'
        : '<span class="source-badge scheduled">Scheduled</span>';

    let timeClass = 'time';
    let statusBadge = '';

    if (departure.status === 'cancelled') {
        timeClass = 'time cancelled';
        statusBadge = '<span class="status-badge cancelled">Cancelled</span>';
    } else if (departure.status === 'delayed') {
        timeClass = 'time delayed';
    }

    const platformBadge = departure.platform
        ? `<span class="platform-badge">Plat ${departure.platform}</span>`
        : '';

    return `
        <div class="departure-row train-departure-row">
            ${platformBadge}
            <span class="destination">${departure.destination}</span>
            <span class="time-container">
                ${statusBadge}
                ${sourceIndicator}
                <span class="${timeClass}">${timeDisplay}</span>
            </span>
        </div>
    `;
}

/**
 * Render a single train station card with departures
 */
function renderTrainStationCard(board: TrainDepartureBoard, errorMessage?: string): string {
    const { station, departures } = board;

    let departuresHtml: string;
    if (errorMessage) {
        departuresHtml = `<p class="no-departures error-message">${errorMessage}</p>`;
    } else if (departures.length > 0) {
        departuresHtml = departures.map(renderTrainDeparture).join('');
    } else {
        departuresHtml = '<p class="no-departures">No trains expected soon</p>';
    }

    const directionsUrl = getDirectionsUrl(station.coordinates);

    const isFavorite = FavoritesManager.isStationFavorite(station.crsCode);
    const favoriteClass = isFavorite ? 'favorite-btn active' : 'favorite-btn';
    const favoriteText = isFavorite ? 'Favorited' : 'Favorite';
    const favoriteAriaPressed = isFavorite ? 'true' : 'false';
    const favoriteAriaLabel = isFavorite
        ? `Remove ${station.name} from favorites`
        : `Add ${station.name} to favorites`;

    return `
        <div class="card train-station-card" data-crs-code="${station.crsCode}">
            <div class="stop-header">
                <h2>${station.name}</h2>
                <span class="station-badge">${station.crsCode}</span>
            </div>
            <div class="card-meta">
                <span class="distance">${formatDistance(station.distanceMeters)}</span>
                <a href="${directionsUrl}" class="directions-link" target="_blank" rel="noopener" aria-label="Get walking directions to this station">Directions</a>
                <button class="${favoriteClass}" data-crs-code="${station.crsCode}" aria-pressed="${favoriteAriaPressed}" aria-label="${favoriteAriaLabel}">${favoriteText}</button>
            </div>
            <div class="departures-list">${departuresHtml}</div>
        </div>
    `;
}

/**
 * Render a display item (bus or train)
 */
function renderDisplayItem(item: DisplayItem): string {
    if (item.type === 'train') {
        return renderTrainStationCard(item.data, item.errorMessage);
    }
    return renderDepartureCard(item.data);
}

/**
 * Get distance from a display item
 */
function getItemDistance(item: DisplayItem): number {
    if (item.type === 'train') {
        return item.data.station.distanceMeters;
    }
    return item.data.stop.distanceMeters;
}

/**
 * Display all items (bus departures and train stations) sorted by distance
 * Favorites are pinned to the top
 * @param items - The display items to render
 * @param hasMoreStops - Whether there are potentially more stops to load
 * @param onSetupHandlers - Callback to set up event handlers after rendering
 */
export function displayItems(
    items: DisplayItem[],
    hasMoreStops: boolean,
    onSetupHandlers: () => void
): void {
    const container = document.getElementById('departures-container');
    const errorCard = document.getElementById('error-card');
    const refreshContainer = document.getElementById('refresh-container');

    if (!container || !errorCard || !refreshContainer) {
        return;
    }

    // Hide error, show departures
    errorCard.style.display = 'none';
    refreshContainer.style.display = 'block';

    // Get favorites and config for sorting
    const favoriteAtcoCodes = FavoritesManager.getAtcoCodes();
    const favoriteCrsCodes = FavoritesManager.getCrsCodes();
    const config = getConfig();
    const nearbyThreshold = config.busStops.nearbyPriorityRadius;

    // Sort: nearby stops first, then favorites, then by distance
    // A nearby non-favorite beats a distant favorite
    const sorted = [...items].sort((a, b) => {
        const aIsFav =
            (a.type === 'bus' && favoriteAtcoCodes.has(a.data.stop.atcoCode)) ||
            (a.type === 'train' && favoriteCrsCodes.has(a.data.station.crsCode));
        const bIsFav =
            (b.type === 'bus' && favoriteAtcoCodes.has(b.data.stop.atcoCode)) ||
            (b.type === 'train' && favoriteCrsCodes.has(b.data.station.crsCode));

        const aDistance = getItemDistance(a);
        const bDistance = getItemDistance(b);
        const aIsNearby = aDistance <= nearbyThreshold;
        const bIsNearby = bDistance <= nearbyThreshold;

        // Both same favorite status: sort by distance
        if (aIsFav === bIsFav) {
            return aDistance - bDistance;
        }

        // One is favorite, one is not
        // Nearby non-favorite beats distant favorite
        if (!aIsFav && aIsNearby && !bIsNearby) return -1;
        if (!bIsFav && bIsNearby && !aIsNearby) return 1;

        // Otherwise favorites first
        if (aIsFav) return -1;
        return 1;
    });

    // Render items
    let html = sorted.map(renderDisplayItem).join('');

    // Add "Show more stops" button if applicable
    const reachedMax = hasReachedMaxRadius();
    if (hasMoreStops && !reachedMax) {
        const config = getConfig();
        const currentRadius = getCurrentSearchRadius();
        const nextRadius = currentRadius + config.busStops.radiusIncrement;
        const displayRadius =
            nextRadius >= 1000 ? `${(nextRadius / 1000).toFixed(1)}km` : `${nextRadius}m`;

        html += `
            <div id="show-more-container" class="show-more-container">
                <button id="show-more-btn" class="show-more-btn" aria-label="Load more bus stops within ${displayRadius}">Show more stops (within ${displayRadius})</button>
            </div>
        `;
    }

    container.innerHTML = html;

    // Track displayed ATCOcodes for "show more" feature
    const atcoCodes = items
        .filter((item): item is DisplayItem & { type: 'bus' } => item.type === 'bus')
        .map(item => item.data.stop.atcoCode);
    setDisplayedAtcoCodes(atcoCodes);

    // Store items for re-rendering after favorite toggle
    setAllDisplayItems(items);

    // Set up event handlers
    onSetupHandlers();
}

/**
 * Show loading state in departures container
 */
export function showLoadingDepartures(): void {
    const container = document.getElementById('departures-container');
    if (container) {
        container.innerHTML =
            '<div class="card"><p><span class="spinner" aria-hidden="true"></span>Loading departure times...</p></div>';
    }
}

/**
 * Display error message
 */
export function displayError(message: string): void {
    const container = document.getElementById('departures-container');
    const errorCard = document.getElementById('error-card');
    const errorMessage = document.getElementById('error-message');
    const refreshContainer = document.getElementById('refresh-container');

    if (!container || !errorCard || !errorMessage || !refreshContainer) {
        return;
    }

    container.innerHTML = '';
    refreshContainer.style.display = 'none';
    errorCard.style.display = 'block';
    errorMessage.textContent = message;
}

/**
 * Show manual postcode entry form with a message
 */
export function showPostcodeEntryForm(message: string, defaultPostcode?: string): void {
    const postcodeDisplay = document.getElementById('postcode-display');
    const postcodeForm = document.getElementById('postcode-form');
    const postcodeInput = document.getElementById('postcode-input') as HTMLInputElement | null;

    if (postcodeDisplay) {
        postcodeDisplay.textContent = message;
    }
    if (postcodeForm) {
        postcodeForm.style.display = 'block';
    }
    if (postcodeInput && defaultPostcode) {
        postcodeInput.value = defaultPostcode;
    }
    // Focus the input for keyboard users
    postcodeInput?.focus();
}

/**
 * Update postcode display
 */
export function updatePostcodeDisplay(text: string, isHtml = false): void {
    const postcodeDisplay = document.getElementById('postcode-display');
    if (postcodeDisplay) {
        if (isHtml) {
            postcodeDisplay.innerHTML = text;
        } else {
            postcodeDisplay.textContent = text;
        }
    }
}

/**
 * Hide postcode form
 */
export function hidePostcodeForm(): void {
    const postcodeForm = document.getElementById('postcode-form');
    if (postcodeForm) {
        postcodeForm.style.display = 'none';
    }
}

/**
 * Show postcode error message
 */
export function showPostcodeError(message: string): void {
    const errorElement = document.getElementById('postcode-error');
    const input = document.getElementById('postcode-input');

    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }
    if (input) {
        input.setAttribute('aria-invalid', 'true');
    }
}

/**
 * Clear postcode error message
 */
export function clearPostcodeError(): void {
    const errorElement = document.getElementById('postcode-error');
    const input = document.getElementById('postcode-input');

    if (errorElement) {
        errorElement.textContent = '';
        errorElement.style.display = 'none';
    }
    if (input) {
        input.setAttribute('aria-invalid', 'false');
    }
}

/**
 * Set postcode form busy state
 */
export function setPostcodeFormBusy(busy: boolean): void {
    const form = document.getElementById('postcode-form');
    if (form) {
        form.setAttribute('aria-busy', String(busy));
    }
}

/**
 * Show refresh container
 */
export function showRefreshContainer(): void {
    const refreshContainer = document.getElementById('refresh-container');
    if (refreshContainer) {
        refreshContainer.style.display = 'block';
    }
}
