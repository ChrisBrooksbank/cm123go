import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY_FILTERS, getDisplayFilters, setDisplayFilters } from './display-filters';

describe('display filters', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults to showing all transport types', () => {
        expect(getDisplayFilters()).toEqual(DEFAULT_DISPLAY_FILTERS);
    });

    it('persists selected filters', () => {
        setDisplayFilters({ bus: false, train: true });

        expect(getDisplayFilters()).toEqual({ bus: false, train: true });
    });

    it('ignores malformed saved filters', () => {
        localStorage.setItem('cm123go-display-filters', '{"bus":"yes","train":true}');

        expect(getDisplayFilters()).toEqual(DEFAULT_DISPLAY_FILTERS);
    });
});
