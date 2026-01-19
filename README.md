# cm123go

Transport app for Chelmsford UK

## Getting Started

```bash
npm install
npm run dev
```

## Scripts

| Command                 | Description               |
| ----------------------- | ------------------------- |
| `npm run dev`           | Start development server  |
| `npm run build`         | Production build          |
| `npm run preview`       | Preview production build  |
| `npm test`              | Run tests in watch mode   |
| `npm run test:run`      | Run tests once            |
| `npm run test:coverage` | Generate coverage report  |
| `npm run lint`          | Check for lint errors     |
| `npm run lint:fix`      | Fix lint errors           |
| `npm run format`        | Format code with Prettier |
| `npm run typecheck`     | TypeScript type checking  |
| `npm run knip`          | Find unused code          |
| `npm run check`         | Run all checks            |

## Project Structure

```
src/
├── main.ts          # Application entry point
├── main.test.ts     # Example test
├── api/             # External API clients
├── core/            # Core business logic
├── config/          # Configuration loading with Zod
├── utils/           # Logger and helper utilities
└── types/           # Shared type definitions
```

## Architecture

### How It Works

1. App loads config and gets user location via browser Geolocation API
2. Reverse geocodes location to display UK postcode (via postcodes.io)
3. Finds nearest bus stops in both directions (up to 4 stops)
4. Fetches real-time departures with fallback chain:
    - **First Bus API** - real-time for First Essex buses (primary)
    - **BODS SIRI-VM + GTFS** - vehicle positions + timetables (fallback)
    - **GTFS scheduled times** - static timetables (last resort)

### External APIs

| API          | Purpose                      |
| ------------ | ---------------------------- |
| First Bus    | Real-time departure times    |
| BODS SIRI-VM | Real-time vehicle positions  |
| BODS GTFS    | Static timetable data        |
| NAPTAN       | Bus stop data (pre-bundled)  |
| postcodes.io | Geocoding (free, no API key) |

### Caching

Uses IndexedDB for offline-first experience:

- Bus stops: 7 days
- Departures: 60 seconds
- Timetables: 1 day

## PWA Support

This app is configured as a Progressive Web App. To complete PWA setup:

1. Add icon files to `public/icons/`:
    - `icon-192.png` (192x192)
    - `icon-512.png` (512x512)

## License

MIT
