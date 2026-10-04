/**
 * Time Utilities
 * Centralized time parsing and formatting functions
 */

/**
 * How far in the past a clock time can be before it's treated as tomorrow's.
 * Departure feeds often still list a bus for a minute or two after its time
 * has passed - those are late/due buses, not ones 24 hours away.
 */
const PAST_TIME_GRACE_MS = 15 * 60 * 1000;

/**
 * Resolve a clock time to the nearest sensible Date: today, or tomorrow if the
 * time passed more than PAST_TIME_GRACE_MS ago (e.g. 00:10 seen at 23:50)
 */
function resolveClockTime(hours: number, minutes: number, seconds = 0): Date {
    const now = new Date();
    const date = new Date(now);
    date.setHours(hours, minutes, seconds, 0);

    if (now.getTime() - date.getTime() > PAST_TIME_GRACE_MS) {
        date.setDate(date.getDate() + 1);
    }

    return date;
}

/**
 * Parse time string to minutes until arrival
 * Handles multiple formats: "HH:MM", "X mins", "Due"
 * @param timeStr - Time string in various formats
 * @returns Minutes until departure (0 if due or invalid)
 */
export function calculateMinutesUntil(timeStr: string): number {
    if (!timeStr || timeStr.toLowerCase() === 'due') {
        return 0;
    }

    // Handle "X mins" format
    const minsMatch = timeStr.match(/(\d+)\s*min/i);
    if (minsMatch) {
        return parseInt(minsMatch[1], 10);
    }

    // Handle "HH:MM" or "HH:MM:SS" format
    const parts = timeStr.split(':');
    if (parts.length >= 2 && parts.length <= 3) {
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        if (
            isNaN(hours) ||
            isNaN(minutes) ||
            hours < 0 ||
            hours > 23 ||
            minutes < 0 ||
            minutes > 59
        ) {
            return 0;
        }
        const departureDate = resolveClockTime(hours, minutes);
        const diffMs = departureDate.getTime() - Date.now();
        return Math.max(0, Math.round(diffMs / 60000));
    }

    return 0;
}

/**
 * Parse HH:MM:SS or HH:MM time string to Date (today, or tomorrow if well past)
 * @param timeStr - Time string in "HH:MM:SS" or "HH:MM" format
 * @returns Date object for today (or tomorrow if the time passed a while ago)
 */
export function parseTimeToDate(timeStr: string): Date {
    const parts = timeStr.split(':').map(Number);
    const hours = parts[0] || 0;
    const minutes = parts[1] || 0;
    const seconds = parts[2] || 0;

    return resolveClockTime(hours, minutes, seconds);
}

/**
 * Format Date as HH:MM string
 * @param date - Date object to format
 * @returns Time string in "HH:MM" format
 */
export function formatTimeHHMM(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Format Date as HH:MM:SS string
 * @param date - Date object to format
 * @returns Time string in "HH:MM:SS" format
 */
export function formatTimeHHMMSS(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}
