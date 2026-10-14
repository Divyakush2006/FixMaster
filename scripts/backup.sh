#!/bin/sh
# Takes one logical backup of the FixMaster database, checks it can be read
# back, and prunes old ones. Exits non-zero on any failure so a scheduler or
# monitor can alert. Needs pg_dump / pg_restore (the postgres image has them).
#
#   DATABASE_URL        connection string (use the DIRECT / unpooled URL on Neon)
#   BACKUP_DIR          where dumps go (default /backups)
#   BACKUP_RETENTION_DAYS  delete dumps older than this (default 14; 0 = keep all)
#
# Restore with scripts/restore.sh. Dumps contain every user's data and password
# hashes: keep the backup volume as protected as the database itself.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$BACKUP_DIR/fixmaster-$stamp.dump"
partial="$final.partial"

# Write to a temporary name so a half-written dump is never mistaken for a backup.
if ! pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$partial"; then
    rm -f "$partial"
    echo "backup FAILED: pg_dump error" >&2
    exit 1
fi

# A dump that cannot be listed cannot be restored, and one with no tables
# (a database that was never migrated) is not a backup worth keeping.
if ! pg_restore --list "$partial" > "$partial.list"; then
    rm -f "$partial" "$partial.list"
    echo "backup FAILED: the dump could not be read back" >&2
    exit 1
fi
if ! grep -q ' TABLE DATA ' "$partial.list"; then
    rm -f "$partial" "$partial.list"
    echo "backup FAILED: the database has no tables yet, nothing to back up" >&2
    exit 1
fi
rm -f "$partial.list"

mv "$partial" "$final"
echo "backup ok: $final ($(wc -c < "$final") bytes)"

if [ "$RETENTION_DAYS" -gt 0 ]; then
    find "$BACKUP_DIR" -name 'fixmaster-*.dump' -type f -mtime "+$RETENTION_DAYS" -print -delete | sed 's/^/pruned: /'
fi
