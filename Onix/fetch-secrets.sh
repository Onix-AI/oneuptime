#!/bin/bash
set -e
cd /opt/oneuptime

echo "Fetching secrets from GCP Secret Manager..."

# Ensure config.env ends with newline before appending
[ -n "$(tail -c1 config.env)" ] && echo "" >> config.env

# List of secrets to fetch from Doppler/GCP Secret Manager
SECRETS=(
  ONEUPTIME_SECRET
  DATABASE_PASSWORD
  CLICKHOUSE_PASSWORD
  REDIS_PASSWORD
  ENCRYPTION_SECRET
  GLOBAL_PROBE_1_KEY
  GLOBAL_PROBE_2_KEY
  SLACK_APP_CLIENT_ID
  SLACK_APP_CLIENT_SECRET
  SLACK_APP_SIGNING_SECRET
  HOST
  STATUS_PAGE_CNAME_RECORD
  LOG_LEVEL
  HTTP_PROTOCOL
  PROVISION_SSL
  ONEUPTIME_HTTP_PORT
  STATUS_PAGE_HTTPS_PORT
  ENVIRONMENT
  CAPTCHA_ENABLED
  CAPTCHA_SITE_KEY
  CAPTCHA_SECRET_KEY
  REGISTER_PROBE_KEY
  PUSH_NOTIFICATION_RELAY_URL
  LETS_ENCRYPT_NOTIFICATION_EMAIL
)

for secret in "${SECRETS[@]}"; do
  value=$(gcloud secrets versions access latest --secret="doppler-${secret}" 2>/dev/null || echo "")
  if [ -n "$value" ]; then
    # Remove existing line if present, then add new value
    sed -i "/^${secret}=/d" config.env
    echo "${secret}=${value}" >> config.env
    echo "  Updated: ${secret}"
  fi
done

echo "Secrets fetched successfully"
