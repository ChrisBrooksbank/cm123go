import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    withCircuitBreaker,
    CircuitOpenError,
    getCircuitBreakerStatus,
    resetCircuitBreaker,
    resetAllCircuitBreakers,
} from './circuit-breaker';

describe('circuit-breaker', () => {
    beforeEach(() => {
        resetAllCircuitBreakers();
        vi.useRealTimers();
    });

    describe('withCircuitBreaker', () => {
        it('should allow calls when circuit is closed', async () => {
            const fn = vi.fn().mockResolvedValue('success');

            const result = await withCircuitBreaker('test-api', fn);

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should open circuit after consecutive failures', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('API down'));

            // Fail 3 times (default threshold)
            for (let i = 0; i < 3; i++) {
                await expect(withCircuitBreaker('test-api', fn)).rejects.toThrow('API down');
            }

            // Next call should fail with CircuitOpenError
            await expect(withCircuitBreaker('test-api', fn)).rejects.toThrow(CircuitOpenError);
            expect(fn).toHaveBeenCalledTimes(3); // Not called again after circuit opened
        });

        it('should transition to half-open after reset timeout', async () => {
            vi.useFakeTimers();
            const fn = vi
                .fn()
                .mockRejectedValueOnce(new Error('fail'))
                .mockRejectedValueOnce(new Error('fail'))
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValueOnce('recovered');

            // Trip the circuit
            for (let i = 0; i < 3; i++) {
                try {
                    await withCircuitBreaker('test-api', fn);
                } catch {
                    // expected
                }
            }

            expect(getCircuitBreakerStatus('test-api').state).toBe('OPEN');

            // Advance past reset timeout (30 seconds default)
            vi.advanceTimersByTime(31000);

            // Should now be in half-open and allow the call
            const result = await withCircuitBreaker('test-api', fn);
            expect(result).toBe('recovered');
        });

        it('should close circuit after success in half-open state', async () => {
            vi.useFakeTimers();
            const fn = vi
                .fn()
                .mockRejectedValueOnce(new Error('fail'))
                .mockRejectedValueOnce(new Error('fail'))
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValue('success');

            // Trip the circuit
            for (let i = 0; i < 3; i++) {
                try {
                    await withCircuitBreaker('test-api', fn);
                } catch {
                    // expected
                }
            }

            vi.advanceTimersByTime(31000);
            await withCircuitBreaker('test-api', fn);

            const status = getCircuitBreakerStatus('test-api');
            expect(status.state).toBe('CLOSED');
        });

        it('should re-open circuit on failure in half-open state', async () => {
            vi.useFakeTimers();
            const fn = vi.fn().mockRejectedValue(new Error('still failing'));

            // Trip the circuit
            for (let i = 0; i < 3; i++) {
                try {
                    await withCircuitBreaker('test-api', fn);
                } catch {
                    // expected
                }
            }

            vi.advanceTimersByTime(31000); // Enter half-open

            // Fail again in half-open
            try {
                await withCircuitBreaker('test-api', fn);
            } catch {
                // expected
            }

            expect(getCircuitBreakerStatus('test-api').state).toBe('OPEN');
        });

        it('should respect custom config', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('fail'));

            // Use threshold of 2
            for (let i = 0; i < 2; i++) {
                try {
                    await withCircuitBreaker('test-api', fn, { failureThreshold: 2 });
                } catch {
                    // expected
                }
            }

            await expect(
                withCircuitBreaker('test-api', fn, { failureThreshold: 2 })
            ).rejects.toThrow(CircuitOpenError);
        });

        it('should reset failure count on success', async () => {
            const fn = vi
                .fn()
                .mockRejectedValueOnce(new Error('fail'))
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValueOnce('success')
                .mockRejectedValueOnce(new Error('fail'))
                .mockRejectedValueOnce(new Error('fail'));

            // 2 failures
            for (let i = 0; i < 2; i++) {
                try {
                    await withCircuitBreaker('test-api', fn);
                } catch {
                    // expected
                }
            }

            // 1 success - should reset count
            await withCircuitBreaker('test-api', fn);

            // 2 more failures - should not trip (count was reset)
            for (let i = 0; i < 2; i++) {
                try {
                    await withCircuitBreaker('test-api', fn);
                } catch {
                    // expected
                }
            }

            // Circuit should still be closed (only 2 failures since reset)
            expect(getCircuitBreakerStatus('test-api').state).toBe('CLOSED');
        });
    });

    describe('resetCircuitBreaker', () => {
        it('should reset specific circuit', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('fail'));

            // Trip the circuit
            for (let i = 0; i < 3; i++) {
                try {
                    await withCircuitBreaker('test-api', fn);
                } catch {
                    // expected
                }
            }

            expect(getCircuitBreakerStatus('test-api').state).toBe('OPEN');

            resetCircuitBreaker('test-api');

            expect(getCircuitBreakerStatus('test-api').state).toBe('CLOSED');
        });
    });

    describe('getCircuitBreakerStatus', () => {
        it('should return exists: false for unknown circuits', () => {
            const status = getCircuitBreakerStatus('unknown');
            expect(status.exists).toBe(false);
            expect(status.state).toBe('CLOSED');
        });

        it('should return exists: true for known circuits', async () => {
            const fn = vi.fn().mockResolvedValue('success');
            await withCircuitBreaker('test-api', fn);

            const status = getCircuitBreakerStatus('test-api');
            expect(status.exists).toBe(true);
        });
    });

    describe('CircuitOpenError', () => {
        it('should include circuit key and retry after', async () => {
            vi.useFakeTimers();
            const fn = vi.fn().mockRejectedValue(new Error('fail'));

            for (let i = 0; i < 3; i++) {
                try {
                    await withCircuitBreaker('test-api', fn);
                } catch {
                    // expected
                }
            }

            try {
                await withCircuitBreaker('test-api', fn);
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(CircuitOpenError);
                const circuitError = error as CircuitOpenError;
                expect(circuitError.circuitKey).toBe('test-api');
                expect(circuitError.retryAfter).toBeGreaterThan(0);
            }
        });
    });
});
