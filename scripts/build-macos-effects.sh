#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

SRC_FILE="$PROJECT_ROOT/native/macos/window-effects.mm"
OUT_FILE="$PROJECT_ROOT/src/bun/libMacWindowEffects.dylib"

if [[ "$(uname)" == "Darwin" ]]; then
    echo "Building macOS native effects library..."
    xcrun clang++ -dynamiclib -fobjc-arc -framework Cocoa \
        -mmacosx-version-min=10.14 \
        "$SRC_FILE" -o "$OUT_FILE"
    echo "Built: $OUT_FILE"
else
    echo "Skipping macOS native effects build (not on macOS)"
    # Create empty placeholder for non-macOS builds
    touch "$OUT_FILE"
fi
