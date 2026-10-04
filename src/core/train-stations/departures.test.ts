import { describe, it, expect, vi } from 'vitest';
import { fetchTrainDepartures } from '@api/huxley';
import { TrainStationCache } from './cache';
import { TrainDepartureService } from './departures';
import type { NearbyTrainStation } from '@/types';

vi.mock('@api/huxley', () => ({ fetchTrainDepartures: vi.fn() }));
vi.mock('./cache', () => ({
    TrainStationCache: {
        getDepartures: vi.fn().mockResolvedValue(null),
        setDepartures: vi.fn(),
    },
}));

const STATION: NearbyTrainStation = {
    crsCode: 'CHM',
    name: 'Chelmsford',
    coordinates: { latitude: 51.7361, longitude: 0.469 },
    distanceMeters: 100,
};

describe('TrainDepartureService', () => {
    it('reports a failed rail API call as unavailable, without caching an empty board', async () => {
        vi.mocked(fetchTrainDepartures).mockRejectedValue(new Error('Rail Data API error: 503'));

        const result = await TrainDepartureService.getDeparturesForStation(STATION);

        expect(result.success).toBe(false);
        expect(TrainStationCache.setDepartures).not.toHaveBeenCalled();
    });
});
