/**
 * UI Event Handlers
 * Handles user interactions for favorites, show more, refresh, etc.
 */

import { getConfig } from '@/config';
import { Logger } from '@/utils/logger';
import {
    BusStopService,
    TrainStationService,
    TrainDepartureService,
    GeolocationService,
    setUserLocation,
} from '@/core';
import { FavoritesManager } from '@/utils/favorites';
import { reverseGeocodeToPostcode } from '@/api';
import { saveLocation, getSavedLocation } from '@/utils/location-storage';
import type { DepartureBoard } from '@/types';
import type { DisplayItem } from '@/core/app-state';
import {
    getUserLocation,
    getCurrentSearchRadius,
    setCurrentSearchRadius,
    hasReachedMaxRadius,
    setHasReachedMaxRadius,
    getDisplayedAtcoCodes,
    addDisplayedAtcoCodes,
    getAllDisplayItems,
    addDisplayItems,
    resetProgressiveExpansion,
} from '@/core/app-state';
import {
    displayItems,
    displayError,
    showPostcodeEntryForm,
    updatePostcodeDisplay,
    showLoadingDepartures,
} from './render';
import { triggerHapticFeedback } from '@/utils/settings';

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

/** Callback type for setting up handlers */
type SetupHandlersCallback = () => void;

/** Stored callback for re-rendering */
let setupHandlersCallback: SetupHandlersCallback = () => {};

/**
 * Set the callback for setting up handlers after rendering
 */
export function setSetupHandlersCallback(callback: SetupHandlersCallback): void {
    setupHandlersCallback = callback;
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
 * Handle favorite button clicks (bus stops and train stations)
 */
function handleFavoriteClick(e: Event): void {
    const target = e.target as HTMLElement;
    const closest = target.closest('.favorite-btn');
    if (!(closest instanceof HTMLButtonElement)) return;

    const btn = closest;
    const atcoCode = btn.getAttribute('data-atco-code');
    const crsCode = btn.getAttribute('data-crs-code');

    if (!atcoCode && !crsCode) return;

    let isNowFavorite: boolean;
    if (atcoCode) {
        isNowFavorite = FavoritesManager.toggle(atcoCode);
    } else {
        isNowFavorite = FavoritesManager.toggleStation(crsCode!);
    }

    // Provide haptic feedback
    triggerHapticFeedback();

    // Get stop/station name from the card for aria-label
    const card = btn.closest('.card');
    const name = card?.querySelector('h2')?.textContent?.split('(')[0]?.trim() || 'this location';

    // Update button appearance and ARIA attributes immediately
    btn.classList.toggle('active', isNowFavorite);
    btn.textContent = isNowFavorite ? 'Favorited' : 'Favorite';
    btn.setAttribute('aria-pressed', isNowFavorite ? 'true' : 'false');
    btn.setAttribute(
        'aria-label',
        isNowFavorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`
    );

    // Announce state change to screen readers
    announceStatus(isNowFavorite ? `${name} added to favorites` : `${name} removed from favorites`);

    // Re-render to reorder (favorites at top)
    displayItems(getAllDisplayItems(), !hasReachedMaxRadius(), setupHandlersCallback);
}

/**
 * Set up click handler for "Show more stops" button
 */
function setupShowMoreHandler(): void {
    const btn = document.getElementById('show-more-btn');
    if (!btn) return;

    btn.addEventListener('click', () => void handleShowMore());
}

/**
 * Handle "Show more stops" button click - progressive radius expansion
 */
async function handleShowMore(): Promise<void> {
    const userLocation = getUserLocation();
    if (!userLocation || hasReachedMaxRadius()) return;

    const btn = document.getElementById('show-more-btn');
    const container = document.getElementById('departures-container');

    if (btn instanceof HTMLButtonElement) {
        btn.textContent = 'Searching...';
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
    }
    if (container) {
        container.setAttribute('aria-busy', 'true');
    }
    announceStatus('Searching for more stops');

    const config = getConfig();
    const currentRadius = getCurrentSearchRadius();
    const displayedAtcoCodes = getDisplayedAtcoCodes();

    try {
        // Get additional stops at expanded radius
        const result = await BusStopService.getExpandedStops(
            userLocation,
            displayedAtcoCodes,
            currentRadius
        );

        // Update current radius
        setCurrentSearchRadius(result.actualRadius);

        // Check if we've reached max radius
        if (result.actualRadius >= config.busStops.maxExpandedRadius) {
            setHasReachedMaxRadius(true);
        }

        // Clear aria-busy
        if (container) {
            container.setAttribute('aria-busy', 'false');
        }

        if (result.stops.length === 0) {
            // No new stops found
            announceStatus('No additional stops found');
            if (hasReachedMaxRadius()) {
                // Remove button - no more stops possible
                const showMoreContainer = document.getElementById('show-more-container');
                if (showMoreContainer) showMoreContainer.remove();
            } else {
                // Update button for next expansion
                displayItems(getAllDisplayItems(), true, setupHandlersCallback);
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
        addDisplayedAtcoCodes(result.stops.map(s => s.atcoCode));

        addDisplayItems(newItems);

        // Re-render (button shows if not at max radius)
        displayItems(getAllDisplayItems(), !hasReachedMaxRadius(), setupHandlersCallback);

        // Announce results to screen readers
        announceStatus(
            `Found ${newItems.length} additional stop${newItems.length === 1 ? '' : 's'}`
        );

        Logger.debug('Expanded stops loaded', {
            count: newItems.length,
            radius: getCurrentSearchRadius(),
        });
    } catch (error) {
        Logger.error('Failed to load more stops', String(error));

        // Clear aria-busy on error
        if (container) {
            container.setAttribute('aria-busy', 'false');
        }

        if (btn instanceof HTMLButtonElement) {
            const nextRadius = currentRadius + config.busStops.radiusIncrement;
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
 * Handle refresh button click
 */
export async function handleRefresh(): Promise<void> {
    const userLocation = getUserLocation();
    if (!userLocation) return;

    // Reset progressive expansion state on refresh
    const config = getConfig();
    resetProgressiveExpansion(config.busStops.maxSearchRadius);

    const refreshBtn = document.getElementById('refresh-btn');
    const container = document.getElementById('departures-container');

    if (refreshBtn instanceof HTMLButtonElement) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Updating...';
        refreshBtn.setAttribute('aria-busy', 'true');
    }
    if (container) {
        container.setAttribute('aria-busy', 'true');
    }
    announceStatus('Updating departure times');

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
            displayItems(
                [...favBusItems, ...nearbyBusItems, ...trainItems],
                true,
                setupHandlersCallback
            );
        } else {
            // Still show favorites and train departures even if nearby bus data fails
            const favItems: DisplayItem[] = favoriteBoards.map(b => ({ type: 'bus', data: b }));
            if (favItems.length > 0 || trainItems.length > 0) {
                displayItems([...favItems, ...trainItems], false, setupHandlersCallback);
            } else {
                displayError(busResult.error.getUserMessage());
            }
        }
    } finally {
        if (refreshBtn instanceof HTMLButtonElement) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Update times';
            refreshBtn.removeAttribute('aria-busy');
        }
        if (container) {
            container.setAttribute('aria-busy', 'false');
        }
        announceStatus('Times updated');
    }
}

/**
 * Set up all event handlers
 */
export function setupAllHandlers(): void {
    setupFavoriteHandlers();
    setupShowMoreHandler();
}

/**
 * Set up click handler on change location button to allow manual location change
 */
export function setupPostcodeDisplayClickHandler(): void {
    const changeLocationBtn = document.getElementById('change-location-btn');

    if (changeLocationBtn) {
        changeLocationBtn.addEventListener('click', () => {
            const savedLocation = getSavedLocation();
            showPostcodeEntryForm('Enter a new postcode:', savedLocation?.postcode);
        });
    }
}

/**
 * Set up click handler on update location button to re-detect GPS location
 */
export function setupLocationUpdateHandler(): void {
    const updateLocationBtn = document.getElementById('update-location-btn');
    if (!updateLocationBtn) return;

    updateLocationBtn.addEventListener('click', () => void handleLocationUpdate());
}

/**
 * Handle location update button click - re-detect GPS and refresh departures
 */
async function handleLocationUpdate(): Promise<void> {
    const btn = document.getElementById('update-location-btn');

    // Show loading state
    if (btn instanceof HTMLButtonElement) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
        btn.setAttribute('aria-busy', 'true');
    }
    announceStatus('Detecting your location');

    try {
        const result = await GeolocationService.getLocationFromBrowser();

        if (!result.success) {
            Logger.warn('Location update failed', result.error);
            announceStatus('Could not detect location');
            // Show error in postcode display briefly
            updatePostcodeDisplay(
                '<span class="status" style="background: var(--color-error-bg); color: var(--color-error);">Location unavailable</span>',
                true
            );
            // Restore previous display after 3 seconds
            setTimeout(() => {
                const savedLocation = getSavedLocation();
                if (savedLocation?.postcode) {
                    updatePostcodeDisplay(
                        `<span class="status">${savedLocation.postcode}</span>`,
                        true
                    );
                }
            }, 3000);
            return;
        }

        // Update app state with new location
        setUserLocation(result.location.coordinates);

        // Show "finding area" while reverse geocoding
        updatePostcodeDisplay(
            '<span class="spinner" aria-hidden="true"></span>Finding your area...',
            true
        );

        // Reverse geocode to get postcode
        try {
            const postcode = await reverseGeocodeToPostcode(result.location.coordinates);
            saveLocation(result.location.coordinates, postcode);
            updatePostcodeDisplay(`<span class="status">${postcode}</span>`, true);
            Logger.success('Location updated', { postcode });
        } catch {
            Logger.warn('Postcode lookup failed, continuing with coordinates');
            saveLocation(result.location.coordinates);
            updatePostcodeDisplay('<span class="status">Location found</span>', true);
        }

        // Refresh departures for new location
        showLoadingDepartures();
        await handleRefresh();
        announceStatus('Location updated');
    } catch (error) {
        Logger.error('Location update error', String(error));
        announceStatus('Failed to update location');
    } finally {
        // Restore button
        if (btn instanceof HTMLButtonElement) {
            btn.disabled = false;
            btn.innerHTML = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
            </svg>`;
            btn.removeAttribute('aria-busy');
        }
    }
}
