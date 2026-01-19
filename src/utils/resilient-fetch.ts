/**
 * Resilient Fetch - Combines circuit breaker, throttling, and retry logic
 */

import { retryWithBackoff } from './helpers';
import { withCircuitBreaker, CircuitOpenError, type CircuitBreakerConfig } from './circuit-breaker';
import { throttledRequest } from './request-throttle';

/** Configuration for resilient fetch */
export interface ResilientFetchConfig {
    /** Circuit breaker settings */
    circuitBreaker?: Partial<CircuitBreakerConfig>;
    /** Retry settings */
    retry?: {
        maxAttempts?: number;
        initialDelay?: number;
    };
    /** Skip circuit breaker (use for non-critical requests) */
    skipCircuitBreaker?: boolean;
    /** Skip throttle (use for high-priority requests) */
    skipThrottle?: boolean;
}

/** Default API-specific circuit breaker configs */
export const API_CIRCUIT_CONFIGS: Record<string, Partial<CircuitBreakerConfig>> = {
    'first-bus': {
        failureThreshold: 3,
        resetTimeout: 30000,
        successThreshold: 1,
        name: 'First Bus API',
    },
    'bods-siri-vm': {
        failureThreshold: 3,
        resetTimeout: 60000,
        successThreshold: 2,
        name: 'BODS SIRI-VM',
    },
    'bods-gtfs': {
        failureThreshold: 2,
        resetTimeout: 120000,
        successThreshold: 1,
        name: 'BODS GTFS',
    },
};

/**
 * Execute an API call with full resilience: throttle -> circuit breaker -> retry
 */
export async function resilientFetch<T>(
    apiKey: string,
    requestKey: string,
    fn: () => Promise<T>,
    config: ResilientFetchConfig = {}
): Promise<T> {
    const circuitConfig = {
        ...API_CIRCUIT_CONFIGS[apiKey],
        ...config.circuitBreaker,
    };

    const executeWithRetry = () =>
        retryWithBackoff(fn, config.retry?.maxAttempts ?? 2, config.retry?.initialDelay ?? 1000);

    const executeWithCircuitBreaker = config.skipCircuitBreaker
        ? executeWithRetry
        : () => withCircuitBreaker(apiKey, executeWithRetry, circuitConfig);

    const fullKey = `${apiKey}:${requestKey}`;

    if (config.skipThrottle) {
        return executeWithCircuitBreaker();
    }

    return throttledRequest(fullKey, executeWithCircuitBreaker);
}

export { CircuitOpenError };
export { getCircuitBreakerStatus, resetCircuitBreaker } from './circuit-breaker';
export { getThrottleStatus } from './request-throttle';
