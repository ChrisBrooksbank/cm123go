import { loadConfig } from '@/config';
import { Logger } from '@/utils/logger';
import { GeolocationService } from '@/core';
import { reverseGeocodeToPostcode } from '@/api';

async function init() {
    try {
        const config = await loadConfig();
        Logger.setDebugMode(config.debug);
        Logger.success('Configuration loaded');

        const postcodeDisplay = document.getElementById('postcode-display');
        if (!postcodeDisplay) return;

        // Check if geolocation is supported
        if (!GeolocationService.isSupported()) {
            postcodeDisplay.textContent = 'Geolocation is not supported by your browser';
            return;
        }

        // Get browser location
        const result = await GeolocationService.getLocationFromBrowser();

        if (!result.success) {
            postcodeDisplay.textContent = `Could not get location: ${result.error.message}`;
            return;
        }

        // Reverse geocode to get postcode
        postcodeDisplay.textContent = 'Looking up postcode...';

        const postcode = await reverseGeocodeToPostcode(result.location.coordinates);
        postcodeDisplay.innerHTML = `<span class="status">${postcode}</span>`;
        Logger.success('Postcode displayed', { postcode });
    } catch (error) {
        Logger.error('Failed to initialize:', String(error));
        const postcodeDisplay = document.getElementById('postcode-display');
        if (postcodeDisplay) {
            postcodeDisplay.textContent = 'Error detecting location';
        }
    }
}

init();
