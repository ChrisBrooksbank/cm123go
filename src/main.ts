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
import { getDirectionsUrl } from '@/utils/maps-link';
import { FavoritesManager } from '@/utils/favorites';
import type {
    Coordinates,
    Departure,
    DepartureBoard,
    TrainDeparture,
    TrainDepartureBoard,
} from '@/types';

// Store user location for refresh
let userLocation: Coordinates | null = null;

// State for show more stops feature
let expandedStopsShown = false;
let displayedAtcoCodes: string[] = [];
let allDisplayItems: DisplayItem[] = [];

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

    const isFavorite = FavoritesManager.isFavorite(board.stop.atcoCode);
    const favoriteClass = isFavorite ? 'favorite-btn active' : 'favorite-btn';
    const favoriteText = isFavorite ? 'Favorited' : 'Favorite';

    const departuresHtml =
        board.departures.length > 0
            ? board.departures.map(renderDeparture).join('')
            : '<p class="no-departures">No upcoming departures</p>';

    const timestamp = new Date(board.lastUpdated).toLocaleTimeString();
    const staleIndicator = board.isStale ? ' (cached)' : '';
    const directionsUrl = getDirectionsUrl(board.stop.coordinates);

    return `
        <div class="card" data-atco-code="${board.stop.atcoCode}">
            <div class="stop-header">
                <h2>${board.stop.commonName}${indicator}</h2>
                ${bearingBadge}
                <button class="${favoriteClass}" data-atco-code="${board.stop.atcoCode}">${favoriteText}</button>
            </div>
            <p class="distance">${Math.round(board.stop.distanceMeters)}m away <a href="${directionsUrl}" class="directions-link" target="_blank" rel="noopener" aria-label="Walking directions to this stop">🚶 Walk</a></p>
            <div class="departures-list">${departuresHtml}</div>
            <p class="timestamp">Updated ${timestamp}${staleIndicator}</p>
        </div>
    `;
}

/**
 * Display all items (bus departures and train stations) sorted by distance
 * Favorites are pinned to the top
 */
function displayItems(items: DisplayItem[], hasMoreStops = false): void {
    const container = document.getElementById('departures-container');
    const errorCard = document.getElementById('error-card');
    const refreshContainer = document.getElementById('refresh-container');

    if (!container || !errorCard || !refreshContainer) {
        return;
    }

    // Hide error, show departures
    errorCard.style.display = 'none';
    refreshContainer.style.display = 'block';

    // Get favorites for sorting
    const favoriteAtcoCodes = FavoritesManager.getAtcoCodes();

    // Sort: favorites first, then by distance
    const sorted = [...items].sort((a, b) => {
        const aIsFav = a.type === 'bus' && favoriteAtcoCodes.has(a.data.stop.atcoCode);
        const bIsFav = b.type === 'bus' && favoriteAtcoCodes.has(b.data.stop.atcoCode);

        // Favorites first
        if (aIsFav && !bIsFav) return -1;
        if (!aIsFav && bIsFav) return 1;

        // Then by distance
        return getItemDistance(a) - getItemDistance(b);
    });

    // Render items
    let html = sorted.map(renderDisplayItem).join('');

    // Add "Show more stops" button if applicable
    if (hasMoreStops && !expandedStopsShown) {
        html += `
            <div id="show-more-container" class="show-more-container">
                <button id="show-more-btn" class="show-more-btn">Show more stops nearby</button>
            </div>
        `;
    }

    container.innerHTML = html;

    // Track displayed ATCOcodes for "show more" feature
    displayedAtcoCodes = items
        .filter((item): item is DisplayItem & { type: 'bus' } => item.type === 'bus')
        .map(item => item.data.stop.atcoCode);

    // Store items for re-rendering after favorite toggle
    allDisplayItems = items;

    // Set up event handlers
    setupFavoriteHandlers();
    setupShowMoreHandler();
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
 * Set up click handlers for favorite buttons using event delegation
 */
function setupFavoriteHandlers(): void {
    const container = document.getElementById('departures-container');
    if (!container) return;

    // Remove old listener if any (avoid duplicates)
    container.removeEventListener('click', handleFavoriteClick);
    container.addEventListener('click', handleFavoriteClick);
}

/**
 * Handle favorite button clicks
 */
function handleFavoriteClick(e: Event): void {
    const target = e.target as HTMLElement;
    const btn = target.closest('.favorite-btn') as HTMLButtonElement | null;
    if (!btn) return;

    const atcoCode = btn.getAttribute('data-atco-code');
    if (!atcoCode) return;

    const isNowFavorite = FavoritesManager.toggle(atcoCode);

    // Update button appearance immediately
    btn.classList.toggle('active', isNowFavorite);
    btn.textContent = isNowFavorite ? 'Favorited' : 'Favorite';

    // Re-render to reorder (favorites at top)
    displayItems(allDisplayItems, !expandedStopsShown);
}

/**
 * Set up click handler for "Show more stops" button
 */
function setupShowMoreHandler(): void {
    const btn = document.getElementById('show-more-btn');
    if (!btn) return;

    btn.addEventListener('click', handleShowMore);
}

/**
 * Handle "Show more stops" button click
 */
async function handleShowMore(): Promise<void> {
    if (!userLocation || expandedStopsShown) return;

    const btn = document.getElementById('show-more-btn') as HTMLButtonElement;
    if (btn) {
        btn.textContent = 'Loading...';
        btn.disabled = true;
    }

    try {
        // Get additional stops (excluding already displayed)
        const additionalStops = await BusStopService.getExpandedStops(
            userLocation,
            displayedAtcoCodes
        );

        if (additionalStops.length === 0) {
            // No more stops to show
            const container = document.getElementById('show-more-container');
            if (container) container.remove();
            return;
        }

        // Fetch departures for additional stops
        const additionalBoards = await Promise.all(
            additionalStops.map(stop => BusStopService.getDeparturesForStop(stop))
        );

        // Add to display items
        const newItems: DisplayItem[] = additionalBoards
            .filter(b => b.departures.length > 0)
            .map(b => ({ type: 'bus' as const, data: b }));

        allDisplayItems = [...allDisplayItems, ...newItems];
        expandedStopsShown = true;

        // Re-render all items
        displayItems(allDisplayItems, false);

        Logger.debug('Expanded stops loaded', { count: newItems.length });
    } catch (error) {
        Logger.error('Failed to load more stops', String(error));
        if (btn) {
            btn.textContent = 'Show more stops nearby';
            btn.disabled = false;
        }
    }
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
    const directionsUrl = getDirectionsUrl(station.coordinates);

    return `
        <div class="card train-station-card">
            <div class="stop-header">
                <h2>${station.name}</h2>
                <span class="station-badge">${station.crsCode}</span>
            </div>
            <p class="distance">${formatDistance(station.distanceMeters)} <a href="${directionsUrl}" class="directions-link" target="_blank" rel="noopener" aria-label="Walking directions to this stop">🚶 Walk</a></p>
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
            displayItems(trainItems, false);
        } else {
            displayError(busResult.error.getUserMessage());
        }
        return;
    }

    // Combine bus and train items
    const busItems: DisplayItem[] = busResult.boards.map(b => ({ type: 'bus', data: b }));
    // Show "show more" button since there are likely more stops nearby
    displayItems([...busItems, ...trainItems], true);
}

/**
 * Handle refresh button click
 */
async function handleRefresh(): Promise<void> {
    if (!userLocation) return;

    // Reset expanded state on refresh
    expandedStopsShown = false;

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
            displayItems([...busItems, ...trainItems], true);
        } else if (trainItems.length > 0) {
            displayItems(trainItems, false);
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

        // Auto-refresh every 60 seconds (only when tab is visible)
        setInterval(() => {
            if (userLocation && document.visibilityState === 'visible') {
                handleRefresh();
            }
        }, 60000);

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
