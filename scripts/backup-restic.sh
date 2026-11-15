#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   RESTIC_REPOSITORY=sftp:user@nas:/volume2/backups/watermark-camera \
#   RESTIC_PASSWORD_FILE=/root/watermark-camera-restic.pass \
#   ./scripts/backup-restic.sh
#
# The NAS target is intentionally NOT hard-coded until the NAS is clean/safe.
RESTIC_REPOSITORY="${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY}"
RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-/root/watermark-camera-restic.pass}"
DATA_DIR="${DATA_DIR:-/opt/watermark-camera/data}"

export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE

if ! restic snapshots >/dev/null 2>&1; then
  echo "[restic] initializing repository"
  restic init
fi

echo "[restic] backing up ${DATA_DIR}"
restic backup "${DATA_DIR}" \
  --tag watermark-camera \
  --host "$(hostname)" \
  --exclude '*.tmp' \
  --exclude '*.log'

echo "[restic] forget/prune"
restic forget --tag watermark-camera --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

echo "[restic] check"
restic check --read-data-subset=5%

echo "[restic] done"
