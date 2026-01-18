import { loadConfig } from '@/config';
import { Logger } from '@/utils/logger';
import { GeolocationService, BusStopService } from '@/core';
import { reverseGeocodeToPostcode } from '@/api';
import { debounce } from '@/utils/helpers';
import type { Coordinates, Departure, DepartureBoard } from '@/types';

// Store user location for refresh
let userLocation: Coordinates | null = null;

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
 * Render a single departure row
 */
function renderDeparture(departure: Departure): string {
    const timeClass = departure.status === 'delayed' ? 'time delayed' : 'time';
    const timeDisplay = departure.minutesUntil <= 0 ? 'Due' : `${departure.minutesUntil} min`;

    return `
        <div class="departure-row">
            <span class="line-badge">${departure.line}</span>
            <span class="destination">${departure.destination}</span>
            <span class="${timeClass}">${timeDisplay}</span>
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

    const departuresHtml =
        board.departures.length > 0
            ? board.departures.map(renderDeparture).join('')
            : '<p class="no-departures">No upcoming departures</p>';

    const timestamp = new Date(board.lastUpdated).toLocaleTimeString();
    const staleIndicator = board.isStale ? ' (cached)' : '';

    return `
        <div class="card">
            <div class="stop-header">
                <h2>${board.stop.commonName}${indicator}</h2>
                ${bearingBadge}
            </div>
            <p class="distance">${Math.round(board.stop.distanceMeters)}m away</p>
            <div class="departures-list">${departuresHtml}</div>
            <p class="timestamp">Updated ${timestamp}${staleIndicator}</p>
        </div>
    `;
}

/**
 * Display all departure boards
 */
function displayDepartures(boards: DepartureBoard[]): void {
    const container = document.getElementById('departures-container');
    const errorCard = document.getElementById('error-card');
    const refreshContainer = document.getElementById('refresh-container');

    if (!container || !errorCard || !refreshContainer) {
        return;
    }

    // Hide error, show departures
    errorCard.style.display = 'none';
    refreshContainer.style.display = 'block';

    // Render all boards
    container.innerHTML = boards.map(renderDepartureCard).join('');
}

/**
 * Display error message
 */
function displayError(message: string): void {
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
 * Fetch and display departures for both directions
 */
async function fetchAndDisplayDepartures(location: Coordinates): Promise<void> {
    const result = await BusStopService.getBothDirections(location);

    if (!result.success) {
        displayError(result.error.getUserMessage());
        return;
    }

    displayDepartures(result.boards);
}

/**
 * Handle refresh button click
 */
async function handleRefresh(): Promise<void> {
    if (!userLocation) return;

    const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
    }

    try {
        const result = await BusStopService.refreshBothDirections(userLocation);

        if (result.success) {
            displayDepartures(result.boards);
        } else {
            displayError(result.error.getUserMessage());
        }
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh All';
        }
    }
}

/**
 * Initialize the application
 */
async function init() {
    try {
        const config = await loadConfig();
        Logger.setDebugMode(config.debug);
        Logger.success('Configuration loaded');

        const postcodeDisplay = document.getElementById('postcode-display');
        if (!postcodeDisplay) return;

        // Check if geolocation is supported
        if (!GeolocationService.isSupported()) {
            postcodeDisplay.textContent = 'Geolocation is not supported by your browser';
            return;
        }

        // Initialize bus stop cache (non-blocking)
        BusStopService.init().catch(err => Logger.warn('Bus stop init failed', err));

        // Get browser location
        const result = await GeolocationService.getLocationFromBrowser();

        if (!result.success) {
            postcodeDisplay.textContent = `Could not get location: ${result.error.message}`;
            return;
        }

        // Store location for refresh
        userLocation = result.location.coordinates;

        // Reverse geocode to get postcode
        postcodeDisplay.textContent = 'Looking up postcode...';

        const postcode = await reverseGeocodeToPostcode(result.location.coordinates);
        postcodeDisplay.innerHTML = `<span class="status">${postcode}</span>`;
        Logger.success('Postcode displayed', { postcode });

        // Fetch and display departures for both directions
        await fetchAndDisplayDepartures(result.location.coordinates);

        // Set up refresh button
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', debounce(handleRefresh, 1000));
        }
    } catch (error) {
        Logger.error('Failed to initialize:', String(error));
        const postcodeDisplay = document.getElementById('postcode-display');
        if (postcodeDisplay) {
            postcodeDisplay.textContent = 'Error detecting location';
        }
    }
}

init();
