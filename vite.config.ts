import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    plugins: [
        tsconfigPaths(),
        VitePWA({
            registerType: 'autoUpdate',
            devOptions: {
                enabled: true,
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
                runtimeCaching: [
                    {
                        urlPattern: /^https:\/\/api\./i,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'api-cache',
                            expiration: {
                                maxEntries: 50,
                                maxAgeSeconds: 300,
                            },
                        },
                    },
                    {
                        urlPattern: /\/api\/bods\//i,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'bods-cache',
                            expiration: {
                                maxEntries: 50,
                                maxAgeSeconds: 60, // 1 minute for real-time data
                            },
                        },
                    },
                ],
            },
            manifest: {
                name: 'cm123go',
                short_name: 'cm123go',
                description: 'Transport app for Chelmsford UK',
                theme_color: '#2563eb',
                background_color: '#f5f5f5',
                display: 'standalone',
                icons: [
                    {
                        src: '/icons/icon-192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: '/icons/icon-512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                ],
            },
        }),
    ],
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
    server: {
        proxy: {
            '/api/bods': {
                target: 'https://data.bus-data.dft.gov.uk',
                changeOrigin: true,
                rewrite: path => path.replace(/^\/api\/bods/, '/api/v1'),
            },
            '/api/firstbus': {
                target: 'https://www.firstbus.co.uk',
                changeOrigin: true,
                rewrite: path => path.replace(/^\/api\/firstbus/, ''),
            },
        },
    },
});
