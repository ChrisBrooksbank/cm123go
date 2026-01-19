# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Transport app for Chelmsford UK

## Development Commands

```bash
npm run dev            # Start Vite dev server
npm run build          # Production build
npm run preview        # Preview production build
npm test               # Vitest watch mode
npm run test:run       # Run tests once
npm run test:coverage  # Coverage report
npm run lint           # ESLint check
npm run lint:fix       # ESLint auto-fix
npm run format         # Prettier format all files
npm run typecheck      # TypeScript type check
npm run knip           # Find unused code
npm run check          # Run all checks

# Run a single test file
npm test -- src/path/to/file.test.ts
```

## Architecture

### Data Flow

App initialization (`main.ts`):

1. Load config → Get user location → Reverse geocode to postcode
2. Find nearest bus stops (up to 4, both directions)
3. Fetch departures in parallel with fallback chain

**Departure data sources** (in priority order):

1. First Bus API - real-time for First Essex buses
2. BODS SIRI-VM + GTFS - real-time vehicle positions + static timetables
3. GTFS scheduled times only

**Caching** (IndexedDB):

- Bus stops: 7 days TTL
- Departures: 60 seconds TTL
- GTFS timetables: 1 day TTL

### External APIs

| API          | Purpose                     | Module                    |
| ------------ | --------------------------- | ------------------------- |
| First Bus    | Real-time departures        | `src/api/first-bus.ts`    |
| BODS SIRI-VM | Vehicle positions           | `src/api/bods-siri-vm.ts` |
| BODS GTFS    | Static timetables           | `src/api/bods-gtfs.ts`    |
| NAPTAN       | Bus stop data (pre-bundled) | `src/api/naptan.ts`       |
| postcodes.io | Geocoding (no API key)      | `src/api/geocoding.ts`    |

### TypeScript with ES Modules

Path aliases configured:

- `@/*` → `src/*`
- `@api/*` → `src/api/*`
- `@core/*` → `src/core/*`
- `@utils/*` → `src/utils/*`
- `@config/*` → `src/config/*`
- `@types/*` → `src/types/*`

### Key Patterns

Use Logger instead of console.log:

```typescript
import { Logger } from '@utils/logger';
Logger.info('Message');
Logger.warn('Warning');
Logger.error('Error');
Logger.success('Done');
Logger.debug('Debug'); // Only in debug mode
```

Config is loaded asynchronously and validated with Zod:

```typescript
import { loadConfig, getConfig } from '@config';

// At startup (once):
await loadConfig();

// After initialization:
const config = getConfig();
```

Retry logic for flaky operations:

```typescript
import { retryWithBackoff } from '@utils/helpers';
const data = await retryWithBackoff(() => fetchData());
```

Other utilities available:

```typescript
import { debounce, throttle, IntervalManager } from '@utils/helpers';

// Debounce rapid calls
const debouncedSearch = debounce(search, 300);

// Throttle frequent updates
const throttledUpdate = throttle(update, 1000);

// Manage intervals with automatic cleanup
const intervalId = IntervalManager.register(() => poll(), 5000);
IntervalManager.clear(intervalId); // Or clearAll() on shutdown
```

### Error Handling Pattern

Use discriminated union result types for type-safe error handling:

```typescript
type Result<T> = { success: true; data: T } | { success: false; error: string };

// Usage
const result = await fetchData();
if (result.success) {
    // result.data is typed
} else {
    // result.error is typed
}
```

### PWA Configuration

The app is configured as a PWA with:

- Auto-update service worker
- Offline caching for assets
- NetworkFirst strategy for API calls

Icons needed in `public/icons/`:

- `icon-192.png`
- `icon-512.png`
