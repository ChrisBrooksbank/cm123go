/**
 * Application Entry Point
 * Orchestrates initialization and coordinates between modules
 */

import { loadConfig, getConfig } from '@/config';
import { Logger } from '@/utils/logger';
import {
    GeolocationService,
    BusStopService,
    TrainStationService,
    TrainDepartureService,
    setUserLocation,
    initializeState,
    type DisplayItem,
} from '@/core';
import { reverseGeocodeToPostcode, geocodePostcode } from '@/api';
import { debounce } from '@/utils/helpers';
import { FavoritesManager } from '@/utils/favorites';
import { saveLocation, getSavedLocation } from '@/utils/location-storage';
import type { Coordinates, DepartureBoard } from '@/types';
import {
    displayItems,
    displayError,
    showPostcodeEntryForm,
    updatePostcodeDisplay,
    hidePostcodeForm,
    showRefreshContainer,
    showPostcodeError,
    clearPostcodeError,
    setPostcodeFormBusy,
    handleRefresh,
    setupAllHandlers,
    setSetupHandlersCallback,
    setupPostcodeDisplayClickHandler,
} from '@/ui';

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
let autoRefreshIntervalId: ReturnType<typeof setInterval> | null = null;
let lastSuccessfulPostcode: string | null = null;

/**
 * Check if install banner was recently dismissed
 */
function isInstallDismissed(): boolean {
    const dismissed = localStorage.getItem(INSTALL_DISMISS_KEY);
    if (!dismissed) return false;
    const dismissedAt = parseInt(dismissed, 10);
    return Date.now() - dismissedAt < DISMISS_DURATION_MS;
}

/**
 * Show install banner if not dismissed
 */
function showInstallBanner(): void {
    const banner = document.getElementById('install-banner');
    if (banner && !isInstallDismissed()) {
        banner.hidden = false;
    }
}

/**
 * Hide install banner
 */
function hideInstallBanner(): void {
    const banner = document.getElementById('install-banner');
    if (banner) {
        banner.hidden = true;
    }
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
            displayItems([...favItems, ...trainItems], false, setupAllHandlers);
        } else {
            displayError(busResult.error.getUserMessage());
        }
        return;
    }

    // Combine favorite bus items (distant ones) with nearby bus items
    const favBusItems: DisplayItem[] = favoriteBoards.map(b => ({ type: 'bus', data: b }));
    const nearbyBusItems: DisplayItem[] = busResult.boards.map(b => ({ type: 'bus', data: b }));

    // Show "show more" button since there are likely more stops nearby
    displayItems([...favBusItems, ...nearbyBusItems, ...trainItems], true, setupAllHandlers);
}

/**
 * Set up postcode form submission handler
 */
function setupPostcodeForm(): void {
    const postcodeForm = document.getElementById('postcode-form');
    const postcodeInput = document.getElementById('postcode-input');

    // Type guard for form elements
    if (
        !(postcodeForm instanceof HTMLFormElement) ||
        !(postcodeInput instanceof HTMLInputElement)
    ) {
        return;
    }

    postcodeForm.addEventListener('submit', e => {
        e.preventDefault();
        const enteredPostcode = postcodeInput.value.trim();
        if (!enteredPostcode) return;

        clearPostcodeError();
        setPostcodeFormBusy(true);
        updatePostcodeDisplay('Looking up postcode...');
        hidePostcodeForm();

        void (async () => {
            try {
                const { coordinates, normalizedPostcode } = await geocodePostcode(enteredPostcode);
                setUserLocation(coordinates);
                lastSuccessfulPostcode = normalizedPostcode;
                updatePostcodeDisplay(`<span class="status">${normalizedPostcode}</span>`, true);
                await fetchAndDisplayDepartures(coordinates);
                showRefreshContainer();
            } catch (error) {
                Logger.error('Manual postcode lookup failed', String(error));
                showPostcodeError('Postcode not found. Please check and try again.');
                showPostcodeEntryForm('Enter your postcode:', lastSuccessfulPostcode ?? undefined);
            } finally {
                setPostcodeFormBusy(false);
            }
        })();
    });
}

/**
 * Set up install banner buttons
 */
function setupInstallBanner(): void {
    const installBtn = document.getElementById('install-btn');
    const dismissBtn = document.getElementById('install-dismiss');

    if (installBtn) {
        installBtn.addEventListener('click', () => {
            if (!deferredPrompt) return;
            void (async () => {
                await deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                Logger.info(`Install prompt outcome: ${outcome}`);
                deferredPrompt = null;
                hideInstallBanner();
            })();
        });
    }

    if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
            localStorage.setItem(INSTALL_DISMISS_KEY, Date.now().toString());
            hideInstallBanner();
            Logger.info('Install banner dismissed');
        });
    }
}

/**
 * Set up refresh button
 */
function setupRefreshButton(): void {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', debounce(handleRefresh, 1000));
    }
}

/**
 * Set up auto-refresh interval
 */
function setupAutoRefresh(): void {
    autoRefreshIntervalId = setInterval(() => {
        if (document.visibilityState === 'visible') {
            void handleRefresh();
        }
    }, 60000);
}

/**
 * Initialize the application
 */
async function init(): Promise<void> {
    try {
        const config = await loadConfig();
        Logger.setDebugMode(config.debug);
        Logger.success('Configuration loaded');

        // Initialize state from config
        initializeState(config.busStops.maxSearchRadius);

        // Set up the callback for re-rendering
        setSetupHandlersCallback(setupAllHandlers);

        const postcodeDisplay = document.getElementById('postcode-display');
        if (!postcodeDisplay) return;

        // Set up click handler on postcode display (so users can change location)
        setupPostcodeDisplayClickHandler();

        // Set up manual postcode entry form (early, so it works if geolocation fails)
        setupPostcodeForm();

        // Check if geolocation is supported
        if (!GeolocationService.isSupported()) {
            showPostcodeEntryForm(
                'Geolocation not supported. Enter postcode:',
                lastSuccessfulPostcode ?? undefined
            );
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
                setUserLocation(savedLocation.coordinates);
                const displayPostcode = savedLocation.postcode || 'Saved location';
                updatePostcodeDisplay(`<span class="status">${displayPostcode}</span>`, true);
                await fetchAndDisplayDepartures(savedLocation.coordinates);
                showRefreshContainer();
                return;
            }

            showPostcodeEntryForm(
                'Could not detect location. Enter postcode:',
                lastSuccessfulPostcode ?? undefined
            );
            return;
        }

        // Check if user appears far from Chelmsford (likely VPN user)
        if (!isWithinChelmsfordArea(result.location.coordinates)) {
            Logger.info('User far from Chelmsford, checking saved location');

            // Try to use saved location if it's within Chelmsford area
            const savedLocation = getSavedLocation();
            if (savedLocation && isWithinChelmsfordArea(savedLocation.coordinates)) {
                Logger.info('Using saved location (within Chelmsford)');
                setUserLocation(savedLocation.coordinates);
                const displayPostcode = savedLocation.postcode || 'Saved location';
                updatePostcodeDisplay(`<span class="status">${displayPostcode}</span>`, true);
                await fetchAndDisplayDepartures(savedLocation.coordinates);
                showRefreshContainer();
                return;
            }

            showPostcodeEntryForm(
                'Please enter a Chelmsford postcode to find nearby stops:',
                lastSuccessfulPostcode ?? undefined
            );
            return;
        }

        // Store location in state
        setUserLocation(result.location.coordinates);

        // Reverse geocode to get postcode
        updatePostcodeDisplay('Looking up postcode...');

        try {
            const postcode = await reverseGeocodeToPostcode(result.location.coordinates);
            saveLocation(result.location.coordinates, postcode);
            updatePostcodeDisplay(`<span class="status">${postcode}</span>`, true);
            Logger.success('Postcode displayed', { postcode });
        } catch (postcodeError) {
            Logger.warn('Postcode lookup failed, continuing with coordinates', postcodeError);
            saveLocation(result.location.coordinates);
            updatePostcodeDisplay('<span class="status">Location found</span>', true);
        }

        // Fetch and display bus departures + train stations (combined, sorted by distance)
        await fetchAndDisplayDepartures(result.location.coordinates);

        // Set up refresh button and auto-refresh
        setupRefreshButton();
        setupAutoRefresh();

        // Set up install banner buttons
        setupInstallBanner();
    } catch (error) {
        Logger.error('Failed to initialize:', String(error));
        showPostcodeEntryForm(
            'Location error. Enter postcode:',
            lastSuccessfulPostcode ?? undefined
        );
    }
}

// PWA install event listeners
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

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (autoRefreshIntervalId) {
        clearInterval(autoRefreshIntervalId);
    }
});

void init();
