# CLAUDE.md

This file provides guidance to Claude Code when working with this codebase.

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
```

## Architecture

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

### PWA Configuration

The app is configured as a PWA with:

- Auto-update service worker
- Offline caching for assets
- NetworkFirst strategy for API calls

Icons needed in `public/icons/`:

- `icon-192.png`
- `icon-512.png`
