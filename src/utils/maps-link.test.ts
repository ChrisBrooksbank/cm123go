import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isIOS, getDirectionsUrl } from './maps-link';

describe('maps-link', () => {
    const originalNavigator = global.navigator;

    beforeEach(() => {
        vi.stubGlobal('navigator', {
            userAgent: '',
            platform: '',
            maxTouchPoints: 0,
        });
    });

    afterEach(() => {
        vi.stubGlobal('navigator', originalNavigator);
    });

    describe('isIOS', () => {
        it('should return true for iPhone user agent', () => {
            vi.stubGlobal('navigator', {
                userAgent:
                    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
                platform: 'iPhone',
                maxTouchPoints: 5,
            });

            expect(isIOS()).toBe(true);
        });

        it('should return true for iPad user agent', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
                platform: 'iPad',
                maxTouchPoints: 5,
            });

            expect(isIOS()).toBe(true);
        });

        it('should return true for iPadOS 13+ (reports as MacIntel with touch)', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15',
                platform: 'MacIntel',
                maxTouchPoints: 5,
            });

            expect(isIOS()).toBe(true);
        });

        it('should return false for Mac desktop (MacIntel without touch)', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15',
                platform: 'MacIntel',
                maxTouchPoints: 0,
            });

            expect(isIOS()).toBe(false);
        });

        it('should return false for Android user agent', () => {
            vi.stubGlobal('navigator', {
                userAgent:
                    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/114.0.0.0 Mobile',
                platform: 'Linux armv8l',
                maxTouchPoints: 5,
            });

            expect(isIOS()).toBe(false);
        });

        it('should return false for Windows user agent', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/114.0.0.0',
                platform: 'Win32',
                maxTouchPoints: 0,
            });

            expect(isIOS()).toBe(false);
        });
    });

    describe('getDirectionsUrl', () => {
        const testCoordinates = { latitude: 51.7356, longitude: 0.4685 };

        it('should return Apple Maps URL on iOS', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
                platform: 'iPhone',
                maxTouchPoints: 5,
            });

            const url = getDirectionsUrl(testCoordinates);

            expect(url).toBe('https://maps.apple.com/?daddr=51.7356,0.4685&dirflg=w');
        });

        it('should return Google Maps URL on Android', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (Linux; Android 13) Chrome/114.0.0.0 Mobile',
                platform: 'Linux armv8l',
                maxTouchPoints: 5,
            });

            const url = getDirectionsUrl(testCoordinates);

            expect(url).toBe(
                'https://www.google.com/maps/dir/?api=1&destination=51.7356,0.4685&travelmode=walking'
            );
        });

        it('should return Google Maps URL on desktop', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/114.0.0.0',
                platform: 'Win32',
                maxTouchPoints: 0,
            });

            const url = getDirectionsUrl(testCoordinates);

            expect(url).toBe(
                'https://www.google.com/maps/dir/?api=1&destination=51.7356,0.4685&travelmode=walking'
            );
        });

        it('should handle negative coordinates', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                platform: 'Win32',
                maxTouchPoints: 0,
            });

            const url = getDirectionsUrl({ latitude: -33.8688, longitude: -151.2093 });

            expect(url).toContain('destination=-33.8688,-151.2093');
        });
    });
});
