#!/bin/bash
# Sets a custom icon on a DMG file so it shows the app icon in Finder
# Usage: ./scripts/set-dmg-icon.sh path/to/app.dmg [path/to/icon.icns]

set -euo pipefail

DMG_PATH="${1:?Usage: $0 <dmg-path> [icns-path]}"
ICNS_PATH="${2:-assets/files/iconsets/daedux-labyrinth-emerald-dark.icns}"

if [[ ! -f "$DMG_PATH" ]]; then
  echo "Error: DMG not found: $DMG_PATH" >&2
  exit 1
fi

if [[ ! -f "$ICNS_PATH" ]]; then
  echo "Error: Icon not found: $ICNS_PATH" >&2
  exit 1
fi

# Create a temporary resource file for the icon
TEMP_RSRC=$(mktemp /tmp/dmg-icon.XXXXXX)
trap 'rm -f "$TEMP_RSRC"' EXIT

# Read the icns file and write it as a custom icon resource
# Uses sips + DeRez/Rez approach for compatibility
sips -i "$ICNS_PATH" >/dev/null 2>&1 || true
DeRez -only icns "$ICNS_PATH" > "$TEMP_RSRC" 2>/dev/null || true

if [[ -s "$TEMP_RSRC" ]]; then
  Rez -append "$TEMP_RSRC" -o "$DMG_PATH"
  SetFile -a C "$DMG_PATH"
  echo "✓ DMG icon set from: $ICNS_PATH"
else
  # Fallback: mount DMG, set volume icon, unmount
  echo "Using volume icon fallback..."
  MOUNT_POINT=$(hdiutil attach "$DMG_PATH" -readwrite -noverify -noautoopen | tail -1 | awk '{print $NF}')

  if [[ -n "$MOUNT_POINT" && -d "$MOUNT_POINT" ]]; then
    cp "$ICNS_PATH" "$MOUNT_POINT/.VolumeIcon.icns"
    SetFile -a C "$MOUNT_POINT"
    hdiutil detach "$MOUNT_POINT" -quiet
    echo "✓ Volume icon set from: $ICNS_PATH"
  else
    echo "Error: Failed to mount DMG" >&2
    exit 1
  fi
fi
