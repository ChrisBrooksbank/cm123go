import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateMinutesUntil, parseTimeToDate } from './time';

describe('time utils', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 0, 15, 10, 30, 30));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('calculateMinutesUntil', () => {
        it('returns minutes until a future clock time', () => {
            expect(calculateMinutesUntil('10:45')).toBe(15);
        });

        it('treats a time that has only just passed as due, not tomorrow', () => {
            expect(calculateMinutesUntil('10:30')).toBe(0);
            expect(calculateMinutesUntil('10:28')).toBe(0);
        });

        it('rolls a time well in the past over to tomorrow', () => {
            vi.setSystemTime(new Date(2026, 0, 15, 23, 50, 0));
            expect(calculateMinutesUntil('00:10')).toBe(20);
        });

        it('handles "X mins" and "Due" formats', () => {
            expect(calculateMinutesUntil('7 mins')).toBe(7);
            expect(calculateMinutesUntil('Due')).toBe(0);
        });
    });

    describe('parseTimeToDate', () => {
        it('keeps a just-passed time on today', () => {
            const date = parseTimeToDate('10:29:00');
            expect(date.getDate()).toBe(15);
            expect(date.getHours()).toBe(10);
            expect(date.getMinutes()).toBe(29);
        });

        it('rolls a time well in the past over to tomorrow', () => {
            expect(parseTimeToDate('08:00:00').getDate()).toBe(16);
        });
    });
});
