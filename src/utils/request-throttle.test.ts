import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    throttledRequest,
    configureThrottle,
    getThrottleStatus,
    resetThrottle,
} from './request-throttle';

describe('request-throttle', () => {
    beforeEach(() => {
        resetThrottle();
    });

    describe('throttledRequest', () => {
        it('should execute requests immediately when under limit', async () => {
            configureThrottle({ maxConcurrent: 3 });
            const fn = vi.fn().mockResolvedValue('result');

            const result = await throttledRequest('key1', fn);

            expect(result).toBe('result');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should queue requests when at limit', async () => {
            configureThrottle({ maxConcurrent: 2, enableDeduplication: false });

            let resolve1!: (value: string) => void;
            let resolve2!: (value: string) => void;
            const slow1 = new Promise<string>(r => {
                resolve1 = r;
            });
            const slow2 = new Promise<string>(r => {
                resolve2 = r;
            });
            const fast = vi.fn().mockResolvedValue('fast');

            // Start slow requests that block the slots
            const p1 = throttledRequest('key1', () => slow1);
            const p2 = throttledRequest('key2', () => slow2);

            // This should be queued
            const p3 = throttledRequest('key3', fast);

            // Fast should be queued, not executed yet
            expect(getThrottleStatus().queueLength).toBe(1);
            expect(fast).not.toHaveBeenCalled();

            // Complete one slow request
            resolve1('slow1');
            await p1;

            // Wait a tick for queue processing
            await new Promise(r => setTimeout(r, 0));

            // Now fast should have been called
            expect(fast).toHaveBeenCalledTimes(1);

            const result = await p3;
            expect(result).toBe('fast');

            resolve2('slow2');
            await p2;
        });

        it('should deduplicate concurrent requests for same key', async () => {
            configureThrottle({ enableDeduplication: true, maxConcurrent: 10 });

            let resolveCount = 0;
            const fn = vi.fn().mockImplementation(() => {
                resolveCount++;
                return Promise.resolve(`result-${resolveCount}`);
            });

            // Start two requests with same key
            const p1 = throttledRequest('same-key', fn);
            const p2 = throttledRequest('same-key', fn);

            const [r1, r2] = await Promise.all([p1, p2]);

            // Should only execute once
            expect(fn).toHaveBeenCalledTimes(1);
            // Both should get same result
            expect(r1).toBe(r2);
        });

        it('should not deduplicate when disabled', async () => {
            configureThrottle({ enableDeduplication: false, maxConcurrent: 10 });
            const fn = vi.fn().mockResolvedValue('result');

            await Promise.all([throttledRequest('same-key', fn), throttledRequest('same-key', fn)]);

            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('should handle errors without breaking queue', async () => {
            configureThrottle({ maxConcurrent: 1, enableDeduplication: false });

            const failing = vi.fn().mockRejectedValue(new Error('failed'));
            const succeeding = vi.fn().mockResolvedValue('success');

            const p1 = throttledRequest('key1', failing);
            const p2 = throttledRequest('key2', succeeding);

            await expect(p1).rejects.toThrow('failed');

            // Wait a tick for queue processing
            await new Promise(r => setTimeout(r, 0));

            const result = await p2;
            expect(result).toBe('success');
        });

        it('should allow new requests for same key after completion', async () => {
            configureThrottle({ enableDeduplication: true, maxConcurrent: 10 });

            let callCount = 0;
            const fn = vi.fn().mockImplementation(() => {
                callCount++;
                return Promise.resolve(`result-${callCount}`);
            });

            // First request
            const r1 = await throttledRequest('key1', fn);
            expect(r1).toBe('result-1');

            // Second request (same key, but first completed)
            const r2 = await throttledRequest('key1', fn);
            expect(r2).toBe('result-2');

            expect(fn).toHaveBeenCalledTimes(2);
        });
    });

    describe('getThrottleStatus', () => {
        it('should report correct status', async () => {
            configureThrottle({ maxConcurrent: 2, enableDeduplication: true });

            let resolve1!: () => void;
            const slow = new Promise<void>(r => {
                resolve1 = r;
            });

            throttledRequest('key1', () => slow);

            const status = getThrottleStatus();
            expect(status.activeCount).toBe(1);
            expect(status.queueLength).toBe(0);
            expect(status.inFlightKeys).toContain('key1');

            resolve1();
        });
    });

    describe('configureThrottle', () => {
        it('should update configuration', async () => {
            configureThrottle({ maxConcurrent: 1 });

            let resolve1!: () => void;
            let resolve2!: () => void;
            const slow1 = new Promise<void>(r => {
                resolve1 = r;
            });
            const slow2 = new Promise<void>(r => {
                resolve2 = r;
            });

            throttledRequest('key1', () => slow1);
            throttledRequest('key2', () => slow2);

            // With maxConcurrent: 1, second request should be queued
            expect(getThrottleStatus().queueLength).toBe(1);

            resolve1();
            resolve2();
        });
    });
});
