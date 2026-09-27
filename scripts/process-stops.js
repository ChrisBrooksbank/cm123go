/* eslint-disable no-console */
/**
 * Build the bundled Chelmsford bus stop list.
 *
 * Downloads current NAPTAN data for Essex and the BODS GTFS timetables that
 * cover Essex, then keeps only stops that are:
 *   - bus/coach stops (BCT) inside the Chelmsford bounding box
 *   - marked active in NAPTAN
 *   - called at by at least one timetabled trip running today or later
 *
 * Run with: npm run update-stops
 *
 * Options:
 *   --cache-dir <dir>  Store downloads in <dir> and reuse them on later runs
 *                      (default: a fresh temp dir, deleted afterwards)
 *
 * Requires the `unzip` command (present on macOS, Linux and GitHub runners).
 */

import { spawn } from 'child_process';
import {
    createReadStream,
    createWriteStream,
    existsSync,
    mkdirSync,
    mkdtempSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Chelmsford bounding box (same as in config)
const BOUNDS = {
    north: 51.82,
    south: 51.68,
    east: 0.55,
    west: 0.4,
};

// NAPTAN ATCO area code for Essex
const NAPTAN_URL = 'https://naptan.api.dft.gov.uk/v1/access-nodes?atcoAreaCodes=150&dataFormat=csv';

// BODS publishes GTFS per region; Essex services appear in both of these
const GTFS_REGIONS = ['south_east', 'east_anglia'];
const gtfsUrl = region =>
    `https://data.bus-data.dft.gov.uk/timetable/download/gtfs-file/${region}/`;

// Abort rather than publish a gutted stop list if a download looks broken
const MIN_SERVED_FRACTION = 0.8;

function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

/** Stream CSV rows as objects keyed by header name */
async function* readCsv(input) {
    const rl = createInterface({ input, crlfDelay: Infinity });
    let header;
    for await (const line of rl) {
        if (!line.trim()) continue;
        const fields = parseCsvLine(line);
        if (!header) {
            header = fields.map(h => h.replace(/^﻿/, ''));
            continue;
        }
        const row = {};
        header.forEach((name, i) => (row[name] = fields[i] ?? ''));
        yield row;
    }
}

/** Stream CSV rows from a single file inside a zip archive */
async function* readZipCsv(zipPath, fileName) {
    const child = spawn('unzip', ['-p', zipPath, fileName]);
    const exited = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', code =>
            code === 0 ? resolve() : reject(new Error(`unzip ${fileName} exited with ${code}`))
        );
    });
    yield* readCsv(child.stdout);
    await exited;
}

async function download(url, dest) {
    if (existsSync(dest)) {
        console.log(`Using cached ${dest}`);
        return;
    }
    console.log(`Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    const partial = `${dest}.partial`;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));
    renameSync(partial, dest);
}

function isInBounds(lat, lng) {
    return lat >= BOUNDS.south && lat <= BOUNDS.north && lng >= BOUNDS.west && lng <= BOUNDS.east;
}

/** Active NAPTAN bus stops inside the Chelmsford bounding box */
async function loadNaptanStops(csvPath) {
    const stops = [];
    for await (const row of readCsv(createReadStream(csvPath, 'utf-8'))) {
        if (row.StopType !== 'BCT') continue;
        if (row.Status !== 'active') continue;

        const lat = parseFloat(row.Latitude);
        const lng = parseFloat(row.Longitude);
        if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) continue;
        if (!isInBounds(lat, lng)) continue;

        stops.push({
            atcoCode: row.ATCOCode,
            commonName: row.CommonName || 'Unknown Stop',
            indicator: row.Indicator || undefined,
            bearing: row.Bearing || undefined,
            coordinates: { latitude: lat, longitude: lng },
            street: row.Street || undefined,
            locality: row.LocalityName || undefined,
        });
    }
    return stops;
}

function yyyymmdd(date) {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Of the given stop IDs, return those with a GTFS trip running today or later */
async function findServedStops(zipPath, candidateIds) {
    const today = yyyymmdd(new Date());

    const liveServices = new Set();
    for await (const row of readZipCsv(zipPath, 'calendar.txt')) {
        if (row.end_date >= today) liveServices.add(row.service_id);
    }
    for await (const row of readZipCsv(zipPath, 'calendar_dates.txt')) {
        if (row.exception_type === '1' && row.date >= today) liveServices.add(row.service_id);
    }

    const liveTrips = new Set();
    for await (const row of readZipCsv(zipPath, 'trips.txt')) {
        if (liveServices.has(row.service_id)) liveTrips.add(row.trip_id);
    }

    const served = new Set();
    for await (const row of readZipCsv(zipPath, 'stop_times.txt')) {
        if (candidateIds.has(row.stop_id) && liveTrips.has(row.trip_id)) served.add(row.stop_id);
    }
    return served;
}

function describe(stop) {
    const indicator = stop.indicator ? `${stop.indicator} ` : '';
    return `${stop.atcoCode}  ${indicator}${stop.commonName} (${stop.street}, ${stop.locality})`;
}

async function main() {
    const cacheArg = process.argv.indexOf('--cache-dir');
    const cacheDir =
        cacheArg !== -1 ? process.argv[cacheArg + 1] : mkdtempSync(join(tmpdir(), 'cm123go-'));
    mkdirSync(cacheDir, { recursive: true });

    try {
        const naptanPath = join(cacheDir, 'essex-stops.csv');
        await download(NAPTAN_URL, naptanPath);
        const naptanStops = await loadNaptanStops(naptanPath);
        console.log(`Found ${naptanStops.length} active NAPTAN bus stops in Chelmsford area`);

        const candidateIds = new Set(naptanStops.map(s => s.atcoCode));
        const served = new Set();
        for (const region of GTFS_REGIONS) {
            const zipPath = join(cacheDir, `gtfs-${region}.zip`);
            await download(gtfsUrl(region), zipPath);
            console.log(`Scanning ${region} timetables...`);
            for (const id of await findServedStops(zipPath, candidateIds)) served.add(id);
        }

        const stops = naptanStops.filter(s => served.has(s.atcoCode));
        const dropped = naptanStops.filter(s => !served.has(s.atcoCode));

        if (stops.length < naptanStops.length * MIN_SERVED_FRACTION) {
            throw new Error(
                `Only ${stops.length} of ${naptanStops.length} stops have a timetabled service - ` +
                    'timetable data looks incomplete, refusing to write'
            );
        }

        console.log(`Dropping ${dropped.length} stops with no current timetabled service:`);
        dropped.forEach(s => console.log(`  ${describe(s)}`));
        console.log(`Keeping ${stops.length} bus stops`);

        const outputPath = join(rootDir, 'public', 'bus-stops.json');
        writeFileSync(outputPath, JSON.stringify(stops, null, 2) + '\n');
        console.log(`Written to ${outputPath}`);

        // Also output a minified version for production
        const minifiedPath = join(rootDir, 'public', 'bus-stops.min.json');
        writeFileSync(minifiedPath, JSON.stringify(stops));
        console.log(
            `Minified version: ${(Buffer.byteLength(JSON.stringify(stops)) / 1024).toFixed(1)} KB`
        );
    } finally {
        if (cacheArg === -1) rmSync(cacheDir, { recursive: true, force: true });
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
