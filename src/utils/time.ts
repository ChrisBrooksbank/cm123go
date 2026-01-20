/**
 * Time Utilities
 * Centralized time parsing and formatting functions
 */

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
        const now = new Date();

        const departureDate = new Date();
        departureDate.setHours(hours, minutes, 0, 0);

        // If the time is earlier than now, assume it's tomorrow
        if (departureDate < now) {
            departureDate.setDate(departureDate.getDate() + 1);
        }

        const diffMs = departureDate.getTime() - now.getTime();
        return Math.max(0, Math.round(diffMs / 60000));
    }

    return 0;
}

/**
 * Parse HH:MM:SS or HH:MM time string to Date (today or tomorrow if past)
 * @param timeStr - Time string in "HH:MM:SS" or "HH:MM" format
 * @returns Date object for today (or tomorrow if time has passed)
 */
export function parseTimeToDate(timeStr: string): Date {
    const parts = timeStr.split(':').map(Number);
    const hours = parts[0] || 0;
    const minutes = parts[1] || 0;
    const seconds = parts[2] || 0;

    const date = new Date();
    date.setHours(hours, minutes, seconds, 0);

    // If time is earlier than now, assume tomorrow
    if (date < new Date()) {
        date.setDate(date.getDate() + 1);
    }

    return date;
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
