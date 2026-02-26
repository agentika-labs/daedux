#!/bin/bash
# Run this script on macOS to generate .icns files from .iconset folders.
# Usage: ./generate-icns.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

for iconset in "$SCRIPT_DIR"/*.iconset; do
    if [ -d "$iconset" ]; then
        name=$(basename "$iconset" .iconset)
        echo "Converting $name.iconset → $name.icns"
        iconutil -c icns "$iconset" -o "$SCRIPT_DIR/$name.icns"
    fi
done

echo ""
echo "Done! .icns files created."
