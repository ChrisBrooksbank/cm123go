import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchFirstBusDepartures } from '@api/first-bus';
import { fetchVehiclesNear } from '@api/bods-siri-vm';
import { calculateDepartures } from './eta-calculator';
import type { BusStop, Departure, VehicleActivity } from '@/types';

vi.mock('@api/first-bus', () => ({ fetchFirstBusDepartures: vi.fn() }));
vi.mock('@api/bods-siri-vm', () => ({ fetchVehiclesNear: vi.fn() }));
vi.mock('@api/bods-gtfs', () => ({
    getScheduledDepartures: vi.fn().mockResolvedValue([]),
    isGTFSDataAvailable: vi.fn().mockResolvedValue(false),
}));

const STOP: BusStop = {
    atcoCode: '1500TEST',
    commonName: 'Test Stop',
    coordinates: { latitude: 51.7356, longitude: 0.4685 },
};

function departure(line: string, destination: string): Departure {
    return {
        line,
        destination,
        expectedDeparture: '10:30',
        minutesUntil: 5,
        status: 'on-time',
        isRealTime: true,
    };
}

function vehicle(lineRef: string, destinationName: string, occupancy?: 'full'): VehicleActivity {
    return {
        recordedAtTime: new Date(),
        validUntilTime: new Date(),
        vehicleRef: 'V1',
        lineRef,
        directionRef: '',
        operatorRef: 'FECS',
        latitude: 51.736,
        longitude: 0.469,
        destinationName,
        occupancy,
    };
}

describe('calculateDepartures with First Bus data', () => {
    beforeEach(() => {
        vi.mocked(fetchFirstBusDepartures).mockReset();
        vi.mocked(fetchVehiclesNear).mockReset();
    });

    it('fills in a truncated destination from the live vehicle going the same way', async () => {
        vi.mocked(fetchFirstBusDepartures).mockResolvedValue([departure('C8', 'Broomfield Hosp')]);
        vi.mocked(fetchVehiclesNear).mockResolvedValue([
            vehicle('C8', 'Broomfield Hospital', 'full'),
        ]);

        const [result] = await calculateDepartures(STOP);

        expect(result.destination).toBe('Broomfield Hospital');
        expect(result.occupancy).toBe('full');
    });

    it('ignores a vehicle on the same route heading the other way', async () => {
        vi.mocked(fetchFirstBusDepartures).mockResolvedValue([
            departure('C8', 'Broomfield Hospital'),
        ]);
        vi.mocked(fetchVehiclesNear).mockResolvedValue([
            vehicle('C8', 'Chelmsford City Centre Bus Station', 'full'),
        ]);

        const [result] = await calculateDepartures(STOP);

        expect(result.destination).toBe('Broomfield Hospital');
        expect(result.occupancy).toBeUndefined();
    });
});
