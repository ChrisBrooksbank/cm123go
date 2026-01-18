import { loadConfig } from '@/config';
import { Logger } from '@/utils/logger';

async function init() {
    try {
        const config = await loadConfig();
        Logger.setDebugMode(config.debug);
        Logger.success('Configuration loaded');

        const app = document.getElementById('app');
        if (app) {
            Logger.success('Application mounted');
        }
    } catch (error) {
        Logger.error('Failed to initialize:', String(error));
    }
}

init();
