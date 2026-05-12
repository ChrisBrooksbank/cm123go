import { writeFileSync } from 'node:fs';

const config = {
    busStops: {
        bodsApiKey: process.env.BODS_API_KEY ?? '',
    },
    trainStations: {
        railDataApiKey: process.env.RAIL_DATA_API_KEY ?? '',
    },
};

writeFileSync('public/app.config.json', `${JSON.stringify(config, null, 2)}\n`);
console.log('Created public/app.config.json');
