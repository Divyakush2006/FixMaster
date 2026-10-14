#!/bin/sh
# Restores a backup taken by scripts/backup.sh into an EMPTY database.
#
#   scripts/restore.sh <dump-file>
#   DATABASE_URL   target database (must exist and be empty)
#
# It refuses to touch a database that already has tables, so a typo cannot
# overwrite live data. To replace a database, create a fresh one, restore
# into it, check it, then point the application at it.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
dump="${1:?usage: restore.sh <dump-file>}"
[ -r "$dump" ] || { echo "cannot read $dump" >&2; exit 1; }

tables="$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
if [ "$tables" != "0" ]; then
    echo "refusing to restore: the target database already has $tables tables. Restore into an empty database." >&2
    exit 1
fi

pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$dump"
echo "restore ok: $dump -> $(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'") tables"
