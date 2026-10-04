import { describe, it, expect, vi, afterEach } from 'vitest';
import { setConfig, resetConfig } from '@config/index';
import { ConfigSchema } from '@config/schema';
import { fetchTrainDepartures } from './huxley';

describe('fetchTrainDepartures', () => {
    afterEach(() => {
        resetConfig();
        vi.unstubAllGlobals();
    });

    it('throws when the rail API fails, instead of returning an empty board', async () => {
        setConfig(ConfigSchema.parse({ trainStations: { railDataApiKey: 'test-key' } }));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

        await expect(fetchTrainDepartures('CHM')).rejects.toThrow();
    });
});
