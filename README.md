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

## PWA Support

This app is configured as a Progressive Web App. To complete PWA setup:

1. Add icon files to `public/icons/`:
    - `icon-192.png` (192x192)
    - `icon-512.png` (512x512)

## License

MIT
