/* eslint-disable no-console */
/**
 * Process NAPTAN CSV to extract Chelmsford bus stops
 * Run with: node scripts/process-stops.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Chelmsford bounding box (same as in config)
const BOUNDS = {
    north: 51.82,
    south: 51.68,
    east: 0.55,
    west: 0.4,
};

// CSV column indices for NAPTAN format
const COLS = {
    ATCOCode: 0,
    CommonName: 4,
    Indicator: 14,
    Bearing: 16,
    Street: 10,
    LocalityName: 18,
    Longitude: 29,
    Latitude: 30,
    StopType: 31,
};

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

function isInBounds(lat, lng) {
    return lat >= BOUNDS.south && lat <= BOUNDS.north && lng >= BOUNDS.west && lng <= BOUNDS.east;
}

// Read CSV
const csvPath = join(rootDir, 'essex-stops.csv');
const csvContent = readFileSync(csvPath, 'utf-8');
const lines = csvContent.split('\n');

console.log(`Processing ${lines.length} lines...`);

const stops = [];

// Skip header row
for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCsvLine(line);

    // Filter to BCT stop type (bus/coach/tram)
    const stopType = fields[COLS.StopType];
    if (stopType !== 'BCT') continue;

    const lat = parseFloat(fields[COLS.Latitude]);
    const lng = parseFloat(fields[COLS.Longitude]);

    // Skip invalid coordinates
    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) continue;

    // Filter to Chelmsford bounding box
    if (!isInBounds(lat, lng)) continue;

    stops.push({
        atcoCode: fields[COLS.ATCOCode],
        commonName: fields[COLS.CommonName] || 'Unknown Stop',
        indicator: fields[COLS.Indicator] || undefined,
        bearing: fields[COLS.Bearing] || undefined,
        coordinates: {
            latitude: lat,
            longitude: lng,
        },
        street: fields[COLS.Street] || undefined,
        locality: fields[COLS.LocalityName] || undefined,
    });
}

console.log(`Found ${stops.length} bus stops in Chelmsford area`);

// Write JSON
const outputPath = join(rootDir, 'public', 'bus-stops.json');
writeFileSync(outputPath, JSON.stringify(stops, null, 2));
console.log(`Written to ${outputPath}`);

// Also output a minified version for production
const minifiedPath = join(rootDir, 'public', 'bus-stops.min.json');
writeFileSync(minifiedPath, JSON.stringify(stops));
console.log(`Minified version: ${(Buffer.byteLength(JSON.stringify(stops)) / 1024).toFixed(1)} KB`);
