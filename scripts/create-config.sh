#!/bin/bash
# Create app.config.json from environment variables

cat > public/app.config.json << EOF
{
  "busStops": {
    "transportApiAppId": "${TRANSPORT_API_APP_ID}",
    "transportApiAppKey": "${TRANSPORT_API_KEY}"
  }
}
EOF

echo "Created public/app.config.json"
