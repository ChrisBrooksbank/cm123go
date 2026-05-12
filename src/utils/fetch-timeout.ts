const DEFAULT_FETCH_TIMEOUT_MS = 10000;

/**
 * Fetch with a real timeout so mobile browsers cannot leave UI flows waiting forever.
 */
export async function fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit = {},
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
    if (typeof AbortController === 'undefined') {
        return fetch(input, init);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(input, {
            ...init,
            signal: init.signal ?? controller.signal,
        });
    } finally {
        clearTimeout(timeoutId);
    }
}
