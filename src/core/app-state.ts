/**
 * Centralized application state management
 */

import type { Coordinates, DepartureBoard, TrainDepartureBoard } from '@/types';

/** Item that can be displayed in the combined list */
export type DisplayItem =
    | { type: 'bus'; data: DepartureBoard }
    | { type: 'train'; data: TrainDepartureBoard; errorMessage?: string };

/** Application state */
interface AppState {
    /** User's current location */
    userLocation: Coordinates | null;
    /** Current search radius for progressive expansion */
    currentSearchRadius: number;
    /** Whether max search radius has been reached */
    hasReachedMaxRadius: boolean;
    /** ATCO codes currently displayed */
    displayedAtcoCodes: string[];
    /** All display items (bus and train) */
    allDisplayItems: DisplayItem[];
}

const state: AppState = {
    userLocation: null,
    currentSearchRadius: 1000,
    hasReachedMaxRadius: false,
    displayedAtcoCodes: [],
    allDisplayItems: [],
};

/** Get the current user location */
export function getUserLocation(): Coordinates | null {
    return state.userLocation;
}

/** Set the user location */
export function setUserLocation(location: Coordinates | null): void {
    state.userLocation = location;
}

/** Get the current search radius */
export function getCurrentSearchRadius(): number {
    return state.currentSearchRadius;
}

/** Set the current search radius */
export function setCurrentSearchRadius(radius: number): void {
    state.currentSearchRadius = radius;
}

/** Check if max radius has been reached */
export function hasReachedMaxRadius(): boolean {
    return state.hasReachedMaxRadius;
}

/** Set whether max radius has been reached */
export function setHasReachedMaxRadius(reached: boolean): void {
    state.hasReachedMaxRadius = reached;
}

/** Get the displayed ATCO codes */
export function getDisplayedAtcoCodes(): string[] {
    return [...state.displayedAtcoCodes];
}

/** Set the displayed ATCO codes */
export function setDisplayedAtcoCodes(codes: string[]): void {
    state.displayedAtcoCodes = codes;
}

/** Add ATCO codes to the displayed list */
export function addDisplayedAtcoCodes(codes: string[]): void {
    state.displayedAtcoCodes = [...state.displayedAtcoCodes, ...codes];
}

/** Get all display items */
export function getAllDisplayItems(): DisplayItem[] {
    return state.allDisplayItems;
}

/** Set all display items */
export function setAllDisplayItems(items: DisplayItem[]): void {
    state.allDisplayItems = items;
}

/** Add display items to the list */
export function addDisplayItems(items: DisplayItem[]): void {
    state.allDisplayItems = [...state.allDisplayItems, ...items];
}

/** Initialize state from config values */
export function initializeState(initialRadius: number): void {
    state.currentSearchRadius = initialRadius;
    state.hasReachedMaxRadius = false;
    state.displayedAtcoCodes = [];
    state.allDisplayItems = [];
}

/** Reset progressive expansion state (for refresh) */
export function resetProgressiveExpansion(initialRadius: number): void {
    state.currentSearchRadius = initialRadius;
    state.hasReachedMaxRadius = false;
}
