#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * GTFS Data Processor for Chelmsford Bus App
 *
 * Downloads GTFS timetable data from BODS and processes it into
 * a compact JSON file for the Chelmsford area.
 *
 * Usage: node scripts/process-gtfs.js
 *
 * Requires: BODS_API_KEY environment variable or reads from app.config.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chelmsford area bounding box (same as in config)
const CHELMSFORD_BOUNDS = {
    north: 51.82,
    south: 51.68,
    east: 0.55,
    west: 0.4,
};

// BODS GTFS download URL - national dataset (very large ~1.2GB)
// For production, consider using operator-specific datasets
const BODS_GTFS_URL = 'https://data.bus-data.dft.gov.uk/timetable/download/gtfs-file/all/';

// Output file
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'gtfs-chelmsford.json');

// Load API key from environment or config
function getApiKey() {
    if (process.env.BODS_API_KEY) {
        return process.env.BODS_API_KEY;
    }

    try {
        const configPath = path.join(__dirname, '..', 'public', 'app.config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config.busStops?.bodsApiKey;
    } catch {
        return null;
    }
}

// Load existing bus stops to get valid ATCO codes for Chelmsford
function loadChelmsfordStops() {
    try {
        const stopsPath = path.join(__dirname, '..', 'public', 'bus-stops.json');
        if (fs.existsSync(stopsPath)) {
            const stops = JSON.parse(fs.readFileSync(stopsPath, 'utf8'));
            return new Set(stops.map(s => s.atcoCode));
        }

        // Try minified version
        const minPath = path.join(__dirname, '..', 'public', 'bus-stops.min.json');
        if (fs.existsSync(minPath)) {
            const stops = JSON.parse(fs.readFileSync(minPath, 'utf8'));
            return new Set(stops.map(s => s.atcoCode));
        }
    } catch (_error) {
        console.warn('Could not load bus stops file, will filter by bounding box only');
    }
    return null;
}

// Check if coordinates are within Chelmsford bounds
function isInChelmsford(lat, lon) {
    return (
        lat >= CHELMSFORD_BOUNDS.south &&
        lat <= CHELMSFORD_BOUNDS.north &&
        lon >= CHELMSFORD_BOUNDS.west &&
        lon <= CHELMSFORD_BOUNDS.east
    );
}

// Parse CSV line handling quoted fields
function parseCSVLine(line) {
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

// Download file with progress
function downloadFile(url, apiKey) {
    return new Promise((resolve, reject) => {
        const fullUrl = `${url}?api_key=${apiKey}`;
        console.log('Downloading GTFS data from BODS...');
        console.log('This may take a few minutes for the full dataset...\n');

        https
            .get(fullUrl, response => {
                if (response.statusCode === 302 || response.statusCode === 301) {
                    // Follow redirect
                    downloadFile(response.headers.location, apiKey).then(resolve).catch(reject);
                    return;
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }

                const chunks = [];
                let downloaded = 0;
                const totalSize = parseInt(response.headers['content-length'] || '0', 10);

                response.on('data', chunk => {
                    chunks.push(chunk);
                    downloaded += chunk.length;
                    if (totalSize > 0) {
                        const pct = ((downloaded / totalSize) * 100).toFixed(1);
                        const mb = (downloaded / 1024 / 1024).toFixed(1);
                        process.stdout.write(`\rDownloading: ${mb}MB (${pct}%)`);
                    } else {
                        const mb = (downloaded / 1024 / 1024).toFixed(1);
                        process.stdout.write(`\rDownloading: ${mb}MB`);
                    }
                });

                response.on('end', () => {
                    console.log('\nDownload complete!');
                    resolve(Buffer.concat(chunks));
                });

                response.on('error', reject);
            })
            .on('error', reject);
    });
}

// Extract file from ZIP using PowerShell (Windows) or unzip command

async function extractWithUnzip(zipBuffer, filename) {
    const tempDir = path.join(__dirname, '..', 'temp-gtfs');
    const tempZip = path.join(tempDir, 'gtfs.zip');

    // Create temp directory
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // Save ZIP to temp file
    fs.writeFileSync(tempZip, zipBuffer);

    // Use PowerShell to extract on Windows
    const { execSync } = await import('child_process');

    try {
        // Extract specific file using PowerShell
        execSync(
            `powershell -Command "Expand-Archive -Path '${tempZip}' -DestinationPath '${tempDir}' -Force"`,
            { stdio: 'pipe' }
        );

        // Read the extracted file
        const extractedFile = path.join(tempDir, filename);
        if (fs.existsSync(extractedFile)) {
            const content = fs.readFileSync(extractedFile, 'utf8');
            return content.split('\n');
        }

        // Check subdirectories
        const files = fs.readdirSync(tempDir, { recursive: true });
        for (const file of files) {
            if (file.toString().endsWith(filename)) {
                const content = fs.readFileSync(path.join(tempDir, file.toString()), 'utf8');
                return content.split('\n');
            }
        }

        throw new Error(`${filename} not found after extraction`);
    } finally {
        // Cleanup temp files
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    }
}

// Process GTFS data
async function processGTFS(apiKey) {
    const chelmsfordStops = loadChelmsfordStops();

    if (chelmsfordStops) {
        console.log(`Loaded ${chelmsfordStops.size} Chelmsford bus stops for filtering\n`);
    }

    // Download GTFS ZIP
    const zipBuffer = await downloadFile(BODS_GTFS_URL, apiKey);
    console.log(`\nZIP size: ${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB`);

    // Extract and process files
    console.log('\nExtracting and processing GTFS files...');

    // Parse stops.txt to get stop coordinates (for filtering if no bus-stops.json)
    console.log('Processing stops.txt...');
    const stopsLines = await extractWithUnzip(zipBuffer, 'stops.txt');
    const stopsHeader = parseCSVLine(stopsLines[0]);
    const stopIdIdx = stopsHeader.indexOf('stop_id');
    const stopLatIdx = stopsHeader.indexOf('stop_lat');
    const stopLonIdx = stopsHeader.indexOf('stop_lon');

    const validStops = new Set();

    for (let i = 1; i < stopsLines.length; i++) {
        if (!stopsLines[i].trim()) continue;
        const fields = parseCSVLine(stopsLines[i]);
        const stopId = fields[stopIdIdx];
        const lat = parseFloat(fields[stopLatIdx]);
        const lon = parseFloat(fields[stopLonIdx]);

        // Check if stop is in Chelmsford area
        if (chelmsfordStops) {
            if (chelmsfordStops.has(stopId)) {
                validStops.add(stopId);
            }
        } else if (isInChelmsford(lat, lon)) {
            validStops.add(stopId);
        }
    }

    console.log(`Found ${validStops.size} stops in Chelmsford area`);

    // Parse routes.txt
    console.log('Processing routes.txt...');
    const routesLines = await extractWithUnzip(zipBuffer, 'routes.txt');
    const routesHeader = parseCSVLine(routesLines[0]);
    const routeIdIdx = routesHeader.indexOf('route_id');
    const routeShortNameIdx = routesHeader.indexOf('route_short_name');
    const routeLongNameIdx = routesHeader.indexOf('route_long_name');
    const agencyIdIdx = routesHeader.indexOf('agency_id');

    const routes = {};
    for (let i = 1; i < routesLines.length; i++) {
        if (!routesLines[i].trim()) continue;
        const fields = parseCSVLine(routesLines[i]);
        routes[fields[routeIdIdx]] = {
            routeId: fields[routeIdIdx],
            routeShortName: fields[routeShortNameIdx] || '',
            routeLongName: fields[routeLongNameIdx] || '',
            operatorName: agencyIdIdx >= 0 ? fields[agencyIdIdx] : undefined,
        };
    }
    console.log(`Loaded ${Object.keys(routes).length} routes`);

    // Parse trips.txt
    console.log('Processing trips.txt...');
    const tripsLines = await extractWithUnzip(zipBuffer, 'trips.txt');
    const tripsHeader = parseCSVLine(tripsLines[0]);
    const tripRouteIdIdx = tripsHeader.indexOf('route_id');
    const tripIdIdx = tripsHeader.indexOf('trip_id');
    const serviceIdIdx = tripsHeader.indexOf('service_id');
    const tripHeadsignIdx = tripsHeader.indexOf('trip_headsign');
    const directionIdIdx = tripsHeader.indexOf('direction_id');
    const blockIdIdx = tripsHeader.indexOf('block_id');

    const trips = {};
    for (let i = 1; i < tripsLines.length; i++) {
        if (!tripsLines[i].trim()) continue;
        const fields = parseCSVLine(tripsLines[i]);
        trips[fields[tripIdIdx]] = {
            tripId: fields[tripIdIdx],
            routeId: fields[tripRouteIdIdx],
            serviceId: fields[serviceIdIdx],
            tripHeadsign: tripHeadsignIdx >= 0 ? fields[tripHeadsignIdx] : undefined,
            directionId: directionIdIdx >= 0 ? parseInt(fields[directionIdIdx]) : undefined,
            blockId: blockIdIdx >= 0 ? fields[blockIdIdx] : undefined,
        };
    }
    console.log(`Loaded ${Object.keys(trips).length} trips`);

    // Parse stop_times.txt - this is usually the largest file
    console.log('Processing stop_times.txt (this may take a while)...');
    const stopTimesLines = await extractWithUnzip(zipBuffer, 'stop_times.txt');
    const stopTimesHeader = parseCSVLine(stopTimesLines[0]);
    const stTripIdIdx = stopTimesHeader.indexOf('trip_id');
    const stArrivalIdx = stopTimesHeader.indexOf('arrival_time');
    const stDepartureIdx = stopTimesHeader.indexOf('departure_time');
    const stStopIdIdx = stopTimesHeader.indexOf('stop_id');
    const stStopSeqIdx = stopTimesHeader.indexOf('stop_sequence');

    const stopTimes = {}; // Indexed by stop_id
    const relevantTrips = new Set();
    let processedCount = 0;
    let includedCount = 0;

    for (let i = 1; i < stopTimesLines.length; i++) {
        if (!stopTimesLines[i].trim()) continue;
        processedCount++;

        if (processedCount % 500000 === 0) {
            console.log(`  Processed ${(processedCount / 1000000).toFixed(1)}M stop times...`);
        }

        const fields = parseCSVLine(stopTimesLines[i]);
        const stopId = fields[stStopIdIdx];

        // Only include stop times for Chelmsford stops
        if (!validStops.has(stopId)) continue;

        includedCount++;
        relevantTrips.add(fields[stTripIdIdx]);

        if (!stopTimes[stopId]) {
            stopTimes[stopId] = [];
        }

        stopTimes[stopId].push({
            tripId: fields[stTripIdIdx],
            arrivalTime: fields[stArrivalIdx],
            departureTime: fields[stDepartureIdx],
            stopId: stopId,
            stopSequence: parseInt(fields[stStopSeqIdx]),
        });
    }

    console.log(`Processed ${processedCount} stop times, included ${includedCount} for Chelmsford`);

    // Sort stop times by departure time
    for (const stopId of Object.keys(stopTimes)) {
        stopTimes[stopId].sort((a, b) => a.departureTime.localeCompare(b.departureTime));
    }

    // Filter trips and routes to only those serving Chelmsford
    const filteredTrips = {};
    const relevantRoutes = new Set();

    for (const tripId of relevantTrips) {
        if (trips[tripId]) {
            filteredTrips[tripId] = trips[tripId];
            relevantRoutes.add(trips[tripId].routeId);
        }
    }

    const filteredRoutes = {};
    for (const routeId of relevantRoutes) {
        if (routes[routeId]) {
            filteredRoutes[routeId] = routes[routeId];
        }
    }

    console.log(
        `\nFiltered to ${Object.keys(filteredTrips).length} trips and ${Object.keys(filteredRoutes).length} routes`
    );

    // Build output
    const output = {
        stopTimes,
        trips: filteredTrips,
        routes: filteredRoutes,
        lastUpdated: new Date().toISOString(),
    };

    // Write output
    const json = JSON.stringify(output);
    fs.writeFileSync(OUTPUT_FILE, json);

    const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
    console.log(`\nOutput written to: ${OUTPUT_FILE}`);
    console.log(`File size: ${sizeMB}MB`);
    console.log(`\nGTFS processing complete!`);
}

// Main
async function main() {
    const apiKey = getApiKey();

    if (!apiKey) {
        console.error('Error: BODS API key not found');
        console.error('Set BODS_API_KEY environment variable or add to public/app.config.json');
        process.exit(1);
    }

    console.log('GTFS Data Processor for Chelmsford Bus App');
    console.log('==========================================\n');

    try {
        await processGTFS(apiKey);
    } catch (error) {
        console.error('\nError processing GTFS data:', error.message);
        process.exit(1);
    }
}

main();
