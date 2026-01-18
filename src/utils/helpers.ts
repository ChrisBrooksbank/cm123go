/**
 * Utility Helper Functions
 */

import { Logger } from './logger';

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

/**
 * Throttle function to limit execution frequency
 */
export function throttle<T extends (...args: Parameters<T>) => ReturnType<T>>(
    fn: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle = false;

    return function (this: ThisParameterType<T>, ...args: Parameters<T>): void {
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

/**
 * Interval manager to track and cleanup intervals
 */
class IntervalManagerClass {
    private intervals: ReturnType<typeof setInterval>[] = [];

    register(fn: () => void, delay: number): ReturnType<typeof setInterval> {
        const id = setInterval(fn, delay);
        this.intervals.push(id);
        Logger.debug(`Registered interval with ${delay}ms delay`);
        return id;
    }

    clear(id: ReturnType<typeof setInterval>): void {
        clearInterval(id);
        this.intervals = this.intervals.filter(i => i !== id);
    }

    clearAll(): void {
        Logger.info(`Clearing ${this.intervals.length} intervals`);
        this.intervals.forEach(id => clearInterval(id));
        this.intervals = [];
    }
}

export const IntervalManager = new IntervalManagerClass();

// Cleanup on page unload
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        IntervalManager.clearAll();
    });
}
