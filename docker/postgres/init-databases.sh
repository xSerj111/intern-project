#!/bin/bash
# Each microservice owns its own database, but the postgres image only creates
# the one named by POSTGRES_DB. Create the rest on first initialisation so a
# fresh clone can run the migrations without manual setup.
set -e

for db in "$DB_NAME_AUTH" "$DB_NAME_CORE" "$DB_NAME_NOTIFICATIONS"; do
  if [ -z "$db" ] || [ "$db" = "$POSTGRES_DB" ]; then
    continue
  fi
  echo "Creating database $db"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -c "CREATE DATABASE \"$db\""
done
