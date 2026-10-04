/**
 * Record README screenshots and a demo GIF.
 *
 * Runs the app in headless Chromium with the location set to Chelmsford station
 * and every external API answered with sample data, so the output is repeatable
 * and needs no API keys.
 *
 * Usage: npm run demo    (needs ffmpeg on PATH for the GIF)
 * Output: docs/screenshots/*.png, docs/demo.gif
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const OUT_DIR = 'docs';
const SCREENSHOT_DIR = join(OUT_DIR, 'screenshots');
const VIEWPORT = { width: 390, height: 844 };
const LOCATION = { latitude: 51.7356, longitude: 0.4685, accuracy: 15 }; // Chelmsford station

/** Sample bus departures per stop: [line, destination, minutes from now] */
const BUS_DEPARTURES = {
    '1500CFDRSTN2': [
        ['C8', 'Broomfield Hospital', 3],
        ['42', 'Witham', 9],
        ['C8', 'Broomfield Hospital', 18],
    ],
    '1500IM2169': [
        ['C10', 'Beaulieu Park', 5],
        ['31', 'Writtle', 12],
        ['C10', 'Beaulieu Park', 25],
    ],
    15003405902: [
        ['C9', 'Great Baddow', 2],
        ['X30', 'Stansted Airport', 14],
        ['C9', 'Great Baddow', 22],
    ],
    '1500AA160': [
        ['100', 'Lakeside', 7],
        ['1', 'Springfield', 11],
        ['351', 'Hatfield Peverel', 19],
    ],
};

/** Sample train departures per station: [destination, minutes from now, platform, etd] */
const TRAIN_DEPARTURES = {
    CHM: [
        ['London Liverpool Street', 4, '2', 'On time'],
        ['Colchester', 9, '1', 'On time'],
        ['Southend Victoria', 16, '3', 'Delayed'],
    ],
    BPA: [
        ['London Liverpool Street', 11, '2', 'On time'],
        ['Braintree', 21, '1', 'On time'],
    ],
};

function clockIn(minutes) {
    const date = new Date(Date.now() + minutes * 60000);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function firstBusResponse(atcoCode) {
    const departures = (BUS_DEPARTURES[atcoCode] ?? []).map(([line, direction, mins]) => ({
        mode: 'bus',
        line,
        line_name: line,
        direction,
        operator: 'FECS',
        operator_name: 'First Essex',
        aimed_departure_time: clockIn(mins),
        expected_departure_time: clockIn(mins),
        best_departure_estimate: clockIn(mins),
        dir: 'outbound',
        source: 'demo',
    }));
    return { atcocode: atcoCode, departures: { all: departures } };
}

function railResponse(crsCode) {
    const services = (TRAIN_DEPARTURES[crsCode] ?? []).map(
        ([destination, mins, platform, etd], i) => ({
            destination: [{ locationName: destination, crs: 'XXX' }],
            std: clockIn(mins),
            etd,
            platform,
            operator: 'Greater Anglia',
            operatorCode: 'LE',
            serviceID: `${crsCode}-${i}`,
        })
    );
    return {
        trainServices: services,
        locationName: crsCode,
        crs: crsCode,
        generatedAt: new Date().toISOString(),
    };
}

async function mockApis(page) {
    const json = body => ({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });

    await page.route('**/app.config.json', route =>
        route.fulfill(
            json({ busStops: { bodsApiKey: 'demo' }, trainStations: { railDataApiKey: 'demo' } })
        )
    );
    await page.route('https://api.postcodes.io/**', route =>
        route.fulfill(json({ status: 200, result: [{ postcode: 'CM1 1HT', distance: 20 }] }))
    );
    await page.route('**/api/firstbus/**', route => {
        const stop = new URL(route.request().url()).searchParams.get('stop');
        return route.fulfill(json(firstBusResponse(stop)));
    });
    await page.route('**/api/bods/**', route =>
        route.fulfill({
            status: 200,
            contentType: 'text/xml',
            body: '<Siri><ServiceDelivery/></Siri>',
        })
    );
    await page.route('https://api1.raildata.org.uk/**', route => {
        const crs = new URL(route.request().url()).pathname.split('/').at(-1);
        return route.fulfill(json(railResponse(crs)));
    });
}

async function setRouteFilter(page, routes) {
    await page.click('#route-filter-btn');
    await page.waitForTimeout(700);
    for (const route of routes) {
        await page.check(`#route-filter-list input[value="${route}"]`);
        await page.waitForTimeout(500);
    }
}

async function main() {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const videoDir = mkdtempSync(join(tmpdir(), 'cm123go-demo-'));

    const server = await createServer({
        server: { port: 5199, strictPort: true },
        logLevel: 'error',
    });
    await server.listen();

    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
        geolocation: LOCATION,
        permissions: ['geolocation'],
        serviceWorkers: 'block',
        recordVideo: { dir: videoDir, size: VIEWPORT },
    });
    // Skip the first-visit help modal
    await context.addInitScript(() => localStorage.setItem('cm123go-help-seen', 'true'));

    const page = await context.newPage();
    await mockApis(page);

    await page.goto('http://localhost:5199/');
    await page.waitForSelector('.card[data-atco-code]');
    await page.waitForSelector('.train-station-card');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'departures.png') });

    // Scroll down to the train stations
    await page.locator('.train-station-card').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'trains.png') });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(1000);

    // Filter down to the C8, C9 and C10
    await setRouteFilter(page, ['C8', 'C9', 'C10']);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'route-filter.png') });
    await page.click('#route-filter-close');
    await page.waitForTimeout(1800);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'filtered.png') });

    // Dark mode
    await page.click('#theme-btn');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'dark-mode.png') });

    await context.close();
    await browser.close();
    await server.close();

    const [video] = readdirSync(videoDir).filter(f => f.endsWith('.webm'));
    execFileSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        join(videoDir, video),
        '-vf',
        'fps=12,scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer',
        join(OUT_DIR, 'demo.gif'),
    ]);
    rmSync(videoDir, { recursive: true, force: true });

    console.log(`Wrote ${SCREENSHOT_DIR}/*.png and ${OUT_DIR}/demo.gif`);
}

await main();
