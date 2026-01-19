#!/bin/bash
# Create app.config.json from environment variables

cat > public/app.config.json << EOF
{
  "busStops": {
    "bodsApiKey": "${BODS_API_KEY}"
  },
  "trainStations": {
    "railDataApiKey": "${RAIL_DATA_API_KEY}"
  }
}
EOF

echo "Created public/app.config.json"
