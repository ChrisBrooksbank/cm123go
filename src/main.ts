import { loadConfig, getConfig } from '@/config';
import { Logger } from '@/utils/logger';
import {
    GeolocationService,
    BusStopService,
    TrainStationService,
    TrainDepartureService,
} from '@/core';
import { reverseGeocodeToPostcode, geocodePostcode } from '@/api';
import { debounce } from '@/utils/helpers';
import { getDirectionsUrl } from '@/utils/maps-link';
import { FavoritesManager } from '@/utils/favorites';
import { saveLocation, getSavedLocation } from '@/utils/location-storage';
import type {
    Coordinates,
    Departure,
    DepartureBoard,
    TrainDeparture,
    TrainDepartureBoard,
} from '@/types';

// Store user location for refresh
let userLocation: Coordinates | null = null;

// State for progressive radius expansion feature
let currentSearchRadius = 1000; // Initial radius, will be set from config on load
let hasReachedMaxRadius = false;
let displayedAtcoCodes: string[] = [];
let allDisplayItems: DisplayItem[] = [];

/**
 * Check if coordinates are within the Chelmsford service area
 * Returns false if user appears far from Chelmsford (e.g., VPN user)
 */
function isWithinChelmsfordArea(coordinates: Coordinates): boolean {
    const config = getConfig();
    const { chelmsfordCenter, maxDistanceFromCenter } = config.busStops;
    const distance = GeolocationService.calculateDistance(coordinates, chelmsfordCenter);
    Logger.debug('Distance from Chelmsford', { distance: Math.round(distance) });
    return distance <= maxDistanceFromCenter;
}

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
 * Announce a status message to screen readers via live region
 */
function announceStatus(message: string): void {
    const announcer = document.getElementById('status-announcer');
    if (announcer) {
        announcer.textContent = message;
        // Clear after a short delay to allow re-announcement of same message
        setTimeout(() => {
            announcer.textContent = '';
        }, 1000);
    }
}

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
    const favoriteAriaPressed = isFavorite ? 'true' : 'false';
    const favoriteAriaLabel = isFavorite
        ? `Remove ${board.stop.commonName} from favorites`
        : `Add ${board.stop.commonName} to favorites`;

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
                <button class="${favoriteClass}" data-atco-code="${board.stop.atcoCode}" aria-pressed="${favoriteAriaPressed}" aria-label="${favoriteAriaLabel}">${favoriteText}</button>
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
    if (hasMoreStops && !hasReachedMaxRadius) {
        const config = getConfig();
        const nextRadius = currentSearchRadius + config.busStops.radiusIncrement;
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
 * Show manual postcode entry form with a message
 */
function showPostcodeEntryForm(message: string): void {
    const postcodeDisplay = document.getElementById('postcode-display');
    const postcodeForm = document.getElementById('postcode-form');
    const postcodeInput = document.getElementById('postcode-input') as HTMLInputElement | null;

    if (postcodeDisplay) {
        postcodeDisplay.textContent = message;
    }
    if (postcodeForm) {
        postcodeForm.style.display = 'block';
    }
    // Focus the input for better UX
    if (postcodeInput) {
        setTimeout(() => postcodeInput.focus(), 100);
    }
}

/**
 * Set up click handler on postcode display to allow manual location change
 */
function setupPostcodeDisplayClickHandler(): void {
    const postcodeDisplay = document.getElementById('postcode-display');

    if (postcodeDisplay) {
        postcodeDisplay.style.cursor = 'pointer';

        const handleActivate = () => {
            showPostcodeEntryForm('Enter a new postcode:');
        };

        // Click handler
        postcodeDisplay.addEventListener('click', handleActivate);

        // Keyboard handler for accessibility
        postcodeDisplay.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleActivate();
            }
        });
    }
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

    // Get stop name from the card for aria-label
    const card = btn.closest('.card');
    const stopName = card?.querySelector('h2')?.textContent?.split('(')[0]?.trim() || 'this stop';

    // Update button appearance and ARIA attributes immediately
    btn.classList.toggle('active', isNowFavorite);
    btn.textContent = isNowFavorite ? 'Favorited' : 'Favorite';
    btn.setAttribute('aria-pressed', isNowFavorite ? 'true' : 'false');
    btn.setAttribute(
        'aria-label',
        isNowFavorite ? `Remove ${stopName} from favorites` : `Add ${stopName} to favorites`
    );

    // Announce state change to screen readers
    announceStatus(
        isNowFavorite ? `${stopName} added to favorites` : `${stopName} removed from favorites`
    );

    // Re-render to reorder (favorites at top)
    displayItems(allDisplayItems, !hasReachedMaxRadius);
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
 * Handle "Show more stops" button click - progressive radius expansion
 */
async function handleShowMore(): Promise<void> {
    if (!userLocation || hasReachedMaxRadius) return;

    const btn = document.getElementById('show-more-btn') as HTMLButtonElement;
    const container = document.getElementById('departures-container');

    if (btn) {
        btn.textContent = 'Searching...';
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
    }
    if (container) {
        container.setAttribute('aria-busy', 'true');
    }
    announceStatus('Searching for more stops');

    const config = getConfig();

    try {
        // Get additional stops at expanded radius
        const result = await BusStopService.getExpandedStops(
            userLocation,
            displayedAtcoCodes,
            currentSearchRadius
        );

        // Update current radius
        currentSearchRadius = result.actualRadius;

        // Check if we've reached max radius
        if (currentSearchRadius >= config.busStops.maxExpandedRadius) {
            hasReachedMaxRadius = true;
        }

        // Clear aria-busy
        if (container) {
            container.setAttribute('aria-busy', 'false');
        }

        if (result.stops.length === 0) {
            // No new stops found
            announceStatus('No additional stops found');
            if (hasReachedMaxRadius) {
                // Remove button - no more stops possible
                const showMoreContainer = document.getElementById('show-more-container');
                if (showMoreContainer) showMoreContainer.remove();
            } else {
                // Update button for next expansion
                displayItems(allDisplayItems, true);
            }
            return;
        }

        // Fetch departures for additional stops
        const additionalBoards = await Promise.all(
            result.stops.map(stop => BusStopService.getDeparturesForStop(stop))
        );

        // Add to display items
        const newItems: DisplayItem[] = additionalBoards
            .filter(b => b.departures.length > 0)
            .map(b => ({ type: 'bus' as const, data: b }));

        // Update displayed ATCO codes
        displayedAtcoCodes = [...displayedAtcoCodes, ...result.stops.map(s => s.atcoCode)];

        allDisplayItems = [...allDisplayItems, ...newItems];

        // Re-render (button shows if not at max radius)
        displayItems(allDisplayItems, !hasReachedMaxRadius);

        // Announce results to screen readers
        announceStatus(
            `Found ${newItems.length} additional stop${newItems.length === 1 ? '' : 's'}`
        );

        Logger.debug('Expanded stops loaded', {
            count: newItems.length,
            radius: currentSearchRadius,
        });
    } catch (error) {
        Logger.error('Failed to load more stops', String(error));

        // Clear aria-busy on error
        if (container) {
            container.setAttribute('aria-busy', 'false');
        }

        if (btn) {
            const nextRadius = currentSearchRadius + config.busStops.radiusIncrement;
            const displayRadius =
                nextRadius >= 1000 ? `${(nextRadius / 1000).toFixed(1)}km` : `${nextRadius}m`;
            btn.textContent = `Show more stops (within ${displayRadius})`;
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
        }
        announceStatus('Failed to load more stops');
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

    // Get favorite ATCO codes to fetch them regardless of distance
    const favoriteAtcoCodes = Array.from(FavoritesManager.getAtcoCodes());

    // Fetch favorite stops, nearby bus stops, and train data in parallel
    const [favoriteStops, busResult, trainResults] = await Promise.all([
        BusStopService.getByAtcoCodes(favoriteAtcoCodes, location),
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

    // Fetch departures for favorite stops that aren't already in nearby results
    const nearbyAtcoCodes = new Set(
        busResult.success ? busResult.boards.map(b => b.stop.atcoCode) : []
    );
    const favoritesNotNearby = favoriteStops.filter(stop => !nearbyAtcoCodes.has(stop.atcoCode));

    // Fetch departures for distant favorites
    const favoriteBoards: DepartureBoard[] = [];
    if (favoritesNotNearby.length > 0) {
        const favResults = await Promise.allSettled(
            favoritesNotNearby.map(stop => BusStopService.getDeparturesForStop(stop))
        );
        for (const result of favResults) {
            if (result.status === 'fulfilled') {
                favoriteBoards.push(result.value);
            }
        }
    }

    if (!busResult.success) {
        // Still show favorites and train departures even if nearby bus data fails
        const favItems: DisplayItem[] = favoriteBoards.map(b => ({ type: 'bus', data: b }));
        if (favItems.length > 0 || trainItems.length > 0) {
            displayItems([...favItems, ...trainItems], false);
        } else {
            displayError(busResult.error.getUserMessage());
        }
        return;
    }

    // Combine favorite bus items (distant ones) with nearby bus items
    const favBusItems: DisplayItem[] = favoriteBoards.map(b => ({ type: 'bus', data: b }));
    const nearbyBusItems: DisplayItem[] = busResult.boards.map(b => ({ type: 'bus', data: b }));

    // Show "show more" button since there are likely more stops nearby
    displayItems([...favBusItems, ...nearbyBusItems, ...trainItems], true);
}

/**
 * Handle refresh button click
 */
async function handleRefresh(): Promise<void> {
    if (!userLocation) return;

    // Reset progressive expansion state on refresh
    const config = getConfig();
    currentSearchRadius = config.busStops.maxSearchRadius;
    hasReachedMaxRadius = false;

    const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;
    const container = document.getElementById('departures-container');

    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
        refreshBtn.setAttribute('aria-busy', 'true');
    }
    if (container) {
        container.setAttribute('aria-busy', 'true');
    }
    announceStatus('Refreshing departure times');

    try {
        // Get train stations first so we can reference them for error cases
        const trainStations = TrainStationService.getStationsByDistance(userLocation);

        // Get favorite ATCO codes to refresh them regardless of distance
        const favoriteAtcoCodes = Array.from(FavoritesManager.getAtcoCodes());

        // Fetch favorite stops, refresh nearby bus stops, and train data in parallel
        const [favoriteStops, busResult, trainResults] = await Promise.all([
            BusStopService.getByAtcoCodes(favoriteAtcoCodes, userLocation),
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

        // Refresh departures for favorite stops that aren't already in nearby results
        const nearbyAtcoCodes = new Set(
            busResult.success ? busResult.boards.map(b => b.stop.atcoCode) : []
        );
        const favoritesNotNearby = favoriteStops.filter(
            stop => !nearbyAtcoCodes.has(stop.atcoCode)
        );

        // Refresh departures for distant favorites
        const favoriteBoards: DepartureBoard[] = [];
        if (favoritesNotNearby.length > 0) {
            const favResults = await Promise.allSettled(
                favoritesNotNearby.map(stop => BusStopService.refreshDeparturesForStop(stop))
            );
            for (const result of favResults) {
                if (result.status === 'fulfilled') {
                    favoriteBoards.push(result.value);
                }
            }
        }

        if (busResult.success) {
            const favBusItems: DisplayItem[] = favoriteBoards.map(b => ({ type: 'bus', data: b }));
            const nearbyBusItems: DisplayItem[] = busResult.boards.map(b => ({
                type: 'bus',
                data: b,
            }));
            displayItems([...favBusItems, ...nearbyBusItems, ...trainItems], true);
        } else {
            // Still show favorites and train departures even if nearby bus data fails
            const favItems: DisplayItem[] = favoriteBoards.map(b => ({ type: 'bus', data: b }));
            if (favItems.length > 0 || trainItems.length > 0) {
                displayItems([...favItems, ...trainItems], false);
            } else {
                displayError(busResult.error.getUserMessage());
            }
        }
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh All';
            refreshBtn.removeAttribute('aria-busy');
        }
        if (container) {
            container.setAttribute('aria-busy', 'false');
        }
        announceStatus('Departure times updated');
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

        // Initialize progressive expansion state from config
        currentSearchRadius = config.busStops.maxSearchRadius;

        const postcodeDisplay = document.getElementById('postcode-display');
        if (!postcodeDisplay) return;

        // Set up click handler on postcode display (so users can change location)
        setupPostcodeDisplayClickHandler();

        // Set up manual postcode entry form (early, so it works if geolocation fails)
        const postcodeForm = document.getElementById('postcode-form') as HTMLFormElement | null;
        const postcodeInput = document.getElementById('postcode-input') as HTMLInputElement | null;

        if (postcodeForm && postcodeInput) {
            postcodeForm.addEventListener('submit', async e => {
                e.preventDefault();
                const enteredPostcode = postcodeInput.value.trim();
                if (!enteredPostcode) return;

                postcodeDisplay.textContent = 'Looking up postcode...';
                postcodeForm.style.display = 'none';

                try {
                    const { coordinates, normalizedPostcode } =
                        await geocodePostcode(enteredPostcode);
                    userLocation = coordinates;
                    saveLocation(coordinates, normalizedPostcode);
                    postcodeDisplay.innerHTML = `<span class="status">${normalizedPostcode}</span>`;
                    await fetchAndDisplayDepartures(coordinates);
                    // Show refresh button
                    const refreshContainer = document.getElementById('refresh-container');
                    if (refreshContainer) refreshContainer.style.display = 'block';
                } catch (error) {
                    Logger.error('Manual postcode lookup failed', String(error));
                    showPostcodeEntryForm('Postcode not found. Try again:');
                }
            });
        }

        // Check if geolocation is supported
        if (!GeolocationService.isSupported()) {
            showPostcodeEntryForm('Geolocation not supported. Enter postcode:');
            return;
        }

        // Initialize bus stop cache (non-blocking)
        BusStopService.init().catch(err => Logger.warn('Bus stop init failed', err));

        // Get browser location
        const result = await GeolocationService.getLocationFromBrowser();

        if (!result.success) {
            // Try to use saved location as fallback
            const savedLocation = getSavedLocation();
            if (savedLocation) {
                Logger.info('Using saved location as fallback');
                userLocation = savedLocation.coordinates;
                const displayPostcode = savedLocation.postcode || 'Saved location';
                postcodeDisplay.innerHTML = `<span class="status">${displayPostcode}</span>`;
                await fetchAndDisplayDepartures(savedLocation.coordinates);
                // Show refresh button
                const refreshContainer = document.getElementById('refresh-container');
                if (refreshContainer) refreshContainer.style.display = 'block';
                return;
            }

            showPostcodeEntryForm('Could not detect location. Enter postcode:');
            return;
        }

        // Check if user appears far from Chelmsford (likely VPN user)
        if (!isWithinChelmsfordArea(result.location.coordinates)) {
            Logger.info('User far from Chelmsford, checking saved location');

            // Try to use saved location if it's within Chelmsford area
            const savedLocation = getSavedLocation();
            if (savedLocation && isWithinChelmsfordArea(savedLocation.coordinates)) {
                Logger.info('Using saved location (within Chelmsford)');
                userLocation = savedLocation.coordinates;
                const displayPostcode = savedLocation.postcode || 'Saved location';
                postcodeDisplay.innerHTML = `<span class="status">${displayPostcode}</span>`;
                await fetchAndDisplayDepartures(savedLocation.coordinates);
                // Show refresh button
                const refreshContainer = document.getElementById('refresh-container');
                if (refreshContainer) refreshContainer.style.display = 'block';
                return;
            }

            showPostcodeEntryForm('Please enter a Chelmsford postcode to find nearby stops:');
            return;
        }

        // Store location for refresh
        userLocation = result.location.coordinates;

        // Reverse geocode to get postcode
        postcodeDisplay.textContent = 'Looking up postcode...';

        try {
            const postcode = await reverseGeocodeToPostcode(result.location.coordinates);
            saveLocation(result.location.coordinates, postcode);
            postcodeDisplay.innerHTML = `<span class="status">${postcode}</span>`;
            Logger.success('Postcode displayed', { postcode });
        } catch (postcodeError) {
            Logger.warn('Postcode lookup failed, continuing with coordinates', postcodeError);
            saveLocation(result.location.coordinates);
            postcodeDisplay.innerHTML = '<span class="status">Location found</span>';
        }

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
        showPostcodeEntryForm('Location error. Enter postcode:');
    }
}

init();
