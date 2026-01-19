/**
 * Circuit Breaker Implementation
 * Prevents repeated calls to failing APIs
 */

import { Logger } from './logger';

/** Circuit breaker states */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** Configuration for a circuit breaker */
export interface CircuitBreakerConfig {
    /** Number of consecutive failures before opening circuit */
    failureThreshold: number;
    /** Time in ms before attempting recovery (half-open state) */
    resetTimeout: number;
    /** Number of successful calls in half-open to close circuit */
    successThreshold: number;
    /** Optional name for logging */
    name?: string;
}

/** Circuit breaker state tracking */
interface CircuitBreakerState {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number;
    nextAttemptTime: number;
}

/** Default configuration values */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 3,
    resetTimeout: 30000,
    successThreshold: 1,
};

/** Registry of circuit breakers by endpoint key */
const circuitBreakers = new Map<string, CircuitBreakerState>();

/**
 * Get or create circuit breaker state for an endpoint
 */
function getCircuitState(key: string): CircuitBreakerState {
    if (!circuitBreakers.has(key)) {
        circuitBreakers.set(key, {
            state: 'CLOSED',
            failures: 0,
            successes: 0,
            lastFailureTime: 0,
            nextAttemptTime: 0,
        });
    }
    return circuitBreakers.get(key)!;
}

/**
 * Check if circuit allows the request
 */
function canExecute(key: string, config: CircuitBreakerConfig): boolean {
    const circuit = getCircuitState(key);
    const now = Date.now();

    switch (circuit.state) {
        case 'CLOSED':
            return true;

        case 'OPEN':
            if (now >= circuit.nextAttemptTime) {
                circuit.state = 'HALF_OPEN';
                circuit.successes = 0;
                Logger.info(`Circuit ${config.name || key} entering half-open state`);
                return true;
            }
            return false;

        case 'HALF_OPEN':
            return true;
    }
}

/**
 * Record a successful call
 */
function recordSuccess(key: string, config: CircuitBreakerConfig): void {
    const circuit = getCircuitState(key);

    if (circuit.state === 'HALF_OPEN') {
        circuit.successes++;
        if (circuit.successes >= config.successThreshold) {
            circuit.state = 'CLOSED';
            circuit.failures = 0;
            circuit.successes = 0;
            Logger.success(`Circuit ${config.name || key} closed (recovered)`);
        }
    } else if (circuit.state === 'CLOSED') {
        circuit.failures = 0;
    }
}

/**
 * Record a failed call
 */
function recordFailure(key: string, config: CircuitBreakerConfig): void {
    const circuit = getCircuitState(key);
    const now = Date.now();

    circuit.failures++;
    circuit.lastFailureTime = now;

    if (circuit.state === 'HALF_OPEN') {
        circuit.state = 'OPEN';
        circuit.nextAttemptTime = now + config.resetTimeout;
        Logger.warn(`Circuit ${config.name || key} re-opened after half-open failure`);
    } else if (circuit.failures >= config.failureThreshold) {
        circuit.state = 'OPEN';
        circuit.nextAttemptTime = now + config.resetTimeout;
        Logger.warn(`Circuit ${config.name || key} opened after ${circuit.failures} failures`);
    }
}

/** Error thrown when circuit is open */
export class CircuitOpenError extends Error {
    constructor(
        public readonly circuitKey: string,
        public readonly retryAfter: number
    ) {
        super(`Circuit breaker open for ${circuitKey}. Retry after ${retryAfter}ms`);
        this.name = 'CircuitOpenError';
    }
}

/**
 * Execute a function with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
    key: string,
    fn: () => Promise<T>,
    config: Partial<CircuitBreakerConfig> = {}
): Promise<T> {
    const fullConfig = { ...DEFAULT_CONFIG, ...config, name: config.name || key };
    const circuit = getCircuitState(key);

    if (!canExecute(key, fullConfig)) {
        const retryAfter = circuit.nextAttemptTime - Date.now();
        throw new CircuitOpenError(key, retryAfter);
    }

    try {
        const result = await fn();
        recordSuccess(key, fullConfig);
        return result;
    } catch (error) {
        recordFailure(key, fullConfig);
        throw error;
    }
}

/**
 * Get current state of a circuit breaker (for debugging/monitoring)
 */
export function getCircuitBreakerStatus(key: string): CircuitBreakerState & { exists: boolean } {
    const state = circuitBreakers.get(key);
    if (!state) {
        return {
            exists: false,
            state: 'CLOSED',
            failures: 0,
            successes: 0,
            lastFailureTime: 0,
            nextAttemptTime: 0,
        };
    }
    return { exists: true, ...state };
}

/**
 * Reset a circuit breaker (for testing or manual recovery)
 */
export function resetCircuitBreaker(key: string): void {
    circuitBreakers.delete(key);
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers(): void {
    circuitBreakers.clear();
}
