/**
 * Utility Helper Functions
 */

import { Logger } from './logger';

// Re-export resilience utilities
export {
    withCircuitBreaker,
    CircuitOpenError,
    getCircuitBreakerStatus,
    resetCircuitBreaker,
    resetAllCircuitBreakers,
    type CircuitBreakerConfig,
    type CircuitState,
} from './circuit-breaker';

export {
    throttledRequest,
    configureThrottle,
    getThrottleStatus,
    resetThrottle,
    type ThrottleConfig,
} from './request-throttle';

export { resilientFetch, API_CIRCUIT_CONFIGS, type ResilientFetchConfig } from './resilient-fetch';

/**
 * Retry an async function with exponential backoff
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxAttempts = 3,
    initialDelay = 1000
): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));

            if (attempt === maxAttempts) {
                Logger.error(`Failed after ${maxAttempts} attempts:`, lastError.message);
                throw lastError;
            }

            const backoffDelay = Math.min(initialDelay * Math.pow(2, attempt - 1), 10000);
            Logger.warn(`Attempt ${attempt} failed, retrying in ${backoffDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
    }

    throw lastError;
}

/**
 * Debounce function to limit execution rate
 */
export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    return function (this: ThisParameterType<T>, ...args: Parameters<T>): void {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}
