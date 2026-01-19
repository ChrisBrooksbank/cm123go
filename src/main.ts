import { loadConfig } from '@/config';
import { Logger } from '@/utils/logger';
import {
    GeolocationService,
    BusStopService,
    TrainStationService,
    TrainDepartureService,
} from '@/core';
import { reverseGeocodeToPostcode } from '@/api';
import { debounce } from '@/utils/helpers';
import type {
    Coordinates,
    Departure,
    DepartureBoard,
    TrainDeparture,
    TrainDepartureBoard,
} from '@/types';

// Store user location for refresh
let userLocation: Coordinates | null = null;

// PWA install prompt
interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const INSTALL_DISMISS_KEY = 'install-dismissed';
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let deferredPrompt: BeforeInstallPromptEvent | null = null;

function isInstallDismissed(): boolean {
    const dismissed = localStorage.getItem(INSTALL_DISMISS_KEY);
    if (!dismissed) return false;
    const dismissedAt = parseInt(dismissed, 10);
    return Date.now() - dismissedAt < DISMISS_DURATION_MS;
}

function showInstallBanner(): void {
    const banner = document.getElementById('install-banner');
    if (banner && !isInstallDismissed()) {
        banner.hidden = false;
    }
}

function hideInstallBanner(): void {
    const banner = document.getElementById('install-banner');
    if (banner) {
        banner.hidden = true;
    }
}

window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    showInstallBanner();
});

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallBanner();
    localStorage.removeItem(INSTALL_DISMISS_KEY);
    Logger.success('App installed');
});

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
    const sourceIndicator = departure.isRealTime
        ? '<span class="source-badge realtime">Live</span>'
        : '<span class="source-badge scheduled">Sched</span>';

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
 * Display all items (bus departures and train stations) sorted by distance
 */
function displayItems(items: DisplayItem[]): void {
    const container = document.getElementById('departures-container');
    const errorCard = document.getElementById('error-card');
    const refreshContainer = document.getElementById('refresh-container');

    if (!container || !errorCard || !refreshContainer) {
        return;
    }

    // Hide error, show departures
    errorCard.style.display = 'none';
    refreshContainer.style.display = 'block';

    // Sort by distance and render
    const sorted = [...items].sort((a, b) => getItemDistance(a) - getItemDistance(b));
    container.innerHTML = sorted.map(renderDisplayItem).join('');
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
 * Format distance for display
 */
function formatDistance(meters: number): string {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)}km away`;
    }
    return `${Math.round(meters)}m away`;
}

/**
 * Render a single train departure row
 */
function renderTrainDeparture(departure: TrainDeparture): string {
    const timeDisplay = departure.minutesUntil <= 0 ? 'Due' : `${departure.minutesUntil} min`;
    const sourceIndicator = departure.isRealTime
        ? '<span class="source-badge realtime">Live</span>'
        : '<span class="source-badge scheduled">Sched</span>';

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
    const { station, departures, lastUpdated, isStale } = board;

    let departuresHtml: string;
    if (errorMessage) {
        departuresHtml = `<p class="no-departures error-message">${errorMessage}</p>`;
    } else if (departures.length > 0) {
        departuresHtml = departures.map(renderTrainDeparture).join('');
    } else {
        departuresHtml = '<p class="no-departures">No upcoming departures</p>';
    }

    const timestamp = new Date(lastUpdated).toLocaleTimeString();
    const staleIndicator = isStale ? ' (cached)' : '';

    return `
        <div class="card train-station-card">
            <div class="stop-header">
                <h2>${station.name}</h2>
                <span class="station-badge">${station.crsCode}</span>
            </div>
            <p class="distance">${formatDistance(station.distanceMeters)}</p>
            <div class="departures-list">${departuresHtml}</div>
            <p class="timestamp">Updated ${timestamp}${staleIndicator}</p>
        </div>
    `;
}

/** Item that can be displayed in the combined list */
type DisplayItem =
    | { type: 'bus'; data: DepartureBoard }
    | { type: 'train'; data: TrainDepartureBoard; errorMessage?: string };

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
 * Fetch and display departures for both directions, combined with train stations
 */
async function fetchAndDisplayDepartures(location: Coordinates): Promise<void> {
    // Get train stations first so we can reference them for error cases
    const trainStations = TrainStationService.getStationsByDistance(location);

    // Fetch bus and train data in parallel
    const [busResult, trainResults] = await Promise.all([
        BusStopService.getBothDirections(location),
        TrainDepartureService.getDeparturesForAllStations(trainStations),
    ]);

    // Convert train results to display items (include both successful and failed)
    const trainItems: DisplayItem[] = trainResults.map((r, index) => {
        if (r.success) {
            return {
                type: 'train' as const,
                data: r.board,
            };
        }
        // Create a placeholder board for failed stations
        return {
            type: 'train' as const,
            data: {
                station: trainStations[index],
                departures: [],
                lastUpdated: Date.now(),
                isStale: false,
            },
            errorMessage: r.error.getUserMessage(),
        };
    });

    if (!busResult.success) {
        // Still show train departures even if bus data fails
        if (trainItems.length > 0) {
            displayItems(trainItems);
        } else {
            displayError(busResult.error.getUserMessage());
        }
        return;
    }

    // Combine bus and train items
    const busItems: DisplayItem[] = busResult.boards.map(b => ({ type: 'bus', data: b }));
    displayItems([...busItems, ...trainItems]);
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
        // Get train stations first so we can reference them for error cases
        const trainStations = TrainStationService.getStationsByDistance(userLocation);

        // Refresh bus and train data in parallel
        const [busResult, trainResults] = await Promise.all([
            BusStopService.refreshBothDirections(userLocation),
            TrainDepartureService.refreshDeparturesForAllStations(trainStations),
        ]);

        // Convert train results to display items (include both successful and failed)
        const trainItems: DisplayItem[] = trainResults.map((r, index) => {
            if (r.success) {
                return {
                    type: 'train' as const,
                    data: r.board,
                };
            }
            // Create a placeholder board for failed stations
            return {
                type: 'train' as const,
                data: {
                    station: trainStations[index],
                    departures: [],
                    lastUpdated: Date.now(),
                    isStale: false,
                },
                errorMessage: r.error.getUserMessage(),
            };
        });

        if (busResult.success) {
            const busItems: DisplayItem[] = busResult.boards.map(b => ({ type: 'bus', data: b }));
            displayItems([...busItems, ...trainItems]);
        } else if (trainItems.length > 0) {
            displayItems(trainItems);
        } else {
            displayError(busResult.error.getUserMessage());
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

        // Fetch and display bus departures + train stations (combined, sorted by distance)
        await fetchAndDisplayDepartures(result.location.coordinates);

        // Set up refresh button
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', debounce(handleRefresh, 1000));
        }

        // Set up install banner buttons
        const installBtn = document.getElementById('install-btn');
        const dismissBtn = document.getElementById('install-dismiss');

        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                if (!deferredPrompt) return;
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                Logger.info(`Install prompt outcome: ${outcome}`);
                deferredPrompt = null;
                hideInstallBanner();
            });
        }

        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                localStorage.setItem(INSTALL_DISMISS_KEY, Date.now().toString());
                hideInstallBanner();
                Logger.info('Install banner dismissed');
            });
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
