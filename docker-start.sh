#!/bin/sh
# Starts MySQL in the background (official entrypoint), then the Node app on $PORT.
: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD is required}"
export MYSQL_ROOT_PASSWORD MYSQL_PASSWORD MYSQL_DATABASE MYSQL_USER

# Low-memory settings for a 512 MB free instance.
docker-entrypoint.sh mysqld \
  --performance-schema=OFF \
  --innodb-buffer-pool-size=64M \
  --max-connections=25 \
  --skip-log-bin &

exec node /app/server/src/index.js
