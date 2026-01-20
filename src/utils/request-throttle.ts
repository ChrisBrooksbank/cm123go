/**
 * Request Throttling and Deduplication
 * Limits concurrent requests and prevents duplicate in-flight requests
 */

import { Logger } from './logger';

/** Configuration for request throttling */
export interface ThrottleConfig {
    /** Maximum concurrent requests */
    maxConcurrent: number;
    /** Enable request deduplication for same key */
    enableDeduplication: boolean;
}

/** Default throttle configuration */
const DEFAULT_THROTTLE_CONFIG: ThrottleConfig = {
    maxConcurrent: 3,
    enableDeduplication: true,
};

/** Queued request awaiting execution */
interface QueuedRequest<T> {
    key: string;
    fn: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
}

/** Throttle state */
interface ThrottleState {
    activeCount: number;
    queue: QueuedRequest<unknown>[];
    inFlight: Map<string, Promise<unknown>>;
}

/** Global throttle state */
const throttleState: ThrottleState = {
    activeCount: 0,
    queue: [],
    inFlight: new Map(),
};

let currentConfig = { ...DEFAULT_THROTTLE_CONFIG };

/**
 * Configure the request throttle
 */
export function configureThrottle(config: Partial<ThrottleConfig>): void {
    currentConfig = { ...currentConfig, ...config };
}

/**
 * Process the next queued request if possible
 */
function processQueue(): void {
    if (throttleState.activeCount >= currentConfig.maxConcurrent) {
        return;
    }

    const next = throttleState.queue.shift();
    if (!next) {
        return;
    }

    void executeRequest(next);
}

/**
 * Execute a request and manage state
 */
async function executeRequest<T>(request: QueuedRequest<T>): Promise<void> {
    throttleState.activeCount++;
    Logger.debug(`Throttle: executing request (active: ${throttleState.activeCount})`);

    try {
        const result = await request.fn();
        request.resolve(result);
    } catch (error) {
        request.reject(error);
    } finally {
        throttleState.activeCount--;

        if (currentConfig.enableDeduplication) {
            throttleState.inFlight.delete(request.key);
        }

        processQueue();
    }
}

/**
 * Execute a request with throttling and optional deduplication
 */
export function throttledRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (currentConfig.enableDeduplication && throttleState.inFlight.has(key)) {
        Logger.debug(`Throttle: deduplicating request for ${key}`);
        return throttleState.inFlight.get(key) as Promise<T>;
    }

    const promise = new Promise<T>((resolve, reject) => {
        const request: QueuedRequest<T> = { key, fn, resolve, reject };

        if (throttleState.activeCount < currentConfig.maxConcurrent) {
            void executeRequest(request);
        } else {
            Logger.debug(
                `Throttle: queueing request (queue size: ${throttleState.queue.length + 1})`
            );
            throttleState.queue.push(request as QueuedRequest<unknown>);
        }
    });

    if (currentConfig.enableDeduplication) {
        throttleState.inFlight.set(key, promise);
    }

    return promise;
}

/**
 * Get current throttle status (for debugging/monitoring)
 */
export function getThrottleStatus(): {
    activeCount: number;
    queueLength: number;
    inFlightKeys: string[];
} {
    return {
        activeCount: throttleState.activeCount,
        queueLength: throttleState.queue.length,
        inFlightKeys: Array.from(throttleState.inFlight.keys()),
    };
}

/**
 * Reset throttle state (for testing)
 */
export function resetThrottle(): void {
    throttleState.activeCount = 0;
    throttleState.queue = [];
    throttleState.inFlight.clear();
    currentConfig = { ...DEFAULT_THROTTLE_CONFIG };
}
