#!/bin/sh
set -eu

state_file="${STATE_FILE:-/var/lib/timetable/timetable.json}"
backup_dir="${BACKUP_DIR:-/var/backups/timetable}"

test -f "$state_file"
mkdir -p "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$backup_dir/timetable-$timestamp.json.next"
destination="$backup_dir/timetable-$timestamp.json"

cp --preserve=mode,timestamps "$state_file" "$temporary"
mv "$temporary" "$destination"
find "$backup_dir" -type f -name 'timetable-*.json' -mtime +30 -delete
