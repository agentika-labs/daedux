#!/bin/bash
# Generate all icon assets from SVG sources.
# Renders SVGs to PNGs at correct optical tiers, builds .icns bundles,
# and generates tray/favicon/apple-touch-icon assets.
#
# Prerequisites: rsvg-convert (brew install librsvg), iconutil (macOS built-in)
#
# Usage:
#   ./generate-icons.sh          # Generate everything
#   ./generate-icons.sh --check  # Verify all outputs exist without regenerating

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SVG_DIR="$SCRIPT_DIR/../svgs"
PUBLIC_DIR="$SCRIPT_DIR/../../../public"

# ─── Optical tier mapping ────────────────────────────────────────────────────
# Maps each target pixel size to the correct SVG tier suffix.
# Large (no suffix): 256+px, 4 layers, full detail
# Medium (-md):      64-128px, 3 layers
# Small (-sm):       16-32px, 2 layers, bold strokes

tier_for_size() {
  local size=$1
  if (( size >= 256 )); then
    echo ""
  elif (( size >= 64 )); then
    echo "-md"
  else
    echo "-sm"
  fi
}

# ─── Color variants ──────────────────────────────────────────────────────────

VARIANTS=("emerald-dark" "white-dark" "dark-light" "mark-only" "labyrinth-emerald-dark" "labyrinth-bold-emerald-dark")

# macOS .iconset sizes: pairs of (size, scale)
ICON_SIZES=(
  "16 1"
  "16 2"
  "32 1"
  "32 2"
  "128 1"
  "128 2"
  "256 1"
  "256 2"
  "512 1"
  "512 2"
)

# ─── Check mode ──────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--check" ]]; then
  echo "Checking all icon outputs..."
  missing=0

  for variant in "${VARIANTS[@]}"; do
    iconset_dir="$SCRIPT_DIR/daedux-${variant}.iconset"
    icns_file="$SCRIPT_DIR/daedux-${variant}.icns"

    for entry in "${ICON_SIZES[@]}"; do
      read -r size scale <<< "$entry"
      if (( scale == 2 )); then
        filename="icon_${size}x${size}@2x.png"
      else
        filename="icon_${size}x${size}.png"
      fi

      if [[ ! -f "$iconset_dir/$filename" ]]; then
        echo "  MISSING: $iconset_dir/$filename"
        ((missing++))
      fi
    done

    if [[ ! -f "$icns_file" ]]; then
      echo "  MISSING: $icns_file"
      ((missing++))
    fi
  done

  for f in "$PUBLIC_DIR/tray-icon.png" "$PUBLIC_DIR/tray-icon@2x.png" \
           "$PUBLIC_DIR/favicon.svg" "$PUBLIC_DIR/favicon-32.png" \
           "$PUBLIC_DIR/apple-touch-icon.png"; do
    if [[ ! -f "$f" ]]; then
      echo "  MISSING: $f"
      ((missing++))
    fi
  done

  if (( missing > 0 )); then
    echo ""
    echo "$missing file(s) missing. Run ./generate-icons.sh to regenerate."
    exit 1
  else
    echo "All icon outputs present."
    exit 0
  fi
fi

# ─── Verify prerequisites ────────────────────────────────────────────────────

if ! command -v rsvg-convert &>/dev/null; then
  echo "Error: rsvg-convert not found. Install with: brew install librsvg"
  exit 1
fi

if ! command -v iconutil &>/dev/null; then
  echo "Error: iconutil not found. This script requires macOS."
  exit 1
fi

# ─── Generate .iconset PNGs ──────────────────────────────────────────────────

echo "Rendering icon PNGs..."

for variant in "${VARIANTS[@]}"; do
  iconset_dir="$SCRIPT_DIR/daedux-${variant}.iconset"
  mkdir -p "$iconset_dir"

  for entry in "${ICON_SIZES[@]}"; do
    read -r size scale <<< "$entry"
    px=$(( size * scale ))
    tier=$(tier_for_size "$px")

    svg_file="$SVG_DIR/daedux-icon-${variant}${tier}.svg"

    # mark-only uses "daedux-mark-only" prefix instead of "daedux-icon-mark-only"
    if [[ "$variant" == "mark-only" ]]; then
      svg_file="$SVG_DIR/daedux-mark-only${tier}.svg"
    fi

    # labyrinth variant uses "daedux-labyrinth-" prefix
    if [[ "$variant" == labyrinth-* ]]; then
      svg_file="$SVG_DIR/daedux-${variant}${tier}.svg"
    fi

    if [[ ! -f "$svg_file" ]]; then
      echo "  WARNING: $svg_file not found, skipping"
      continue
    fi

    if (( scale == 2 )); then
      filename="icon_${size}x${size}@2x.png"
    else
      filename="icon_${size}x${size}.png"
    fi

    rsvg-convert -w "$px" -h "$px" "$svg_file" -o "$iconset_dir/$filename"
  done

  echo "  daedux-${variant}.iconset rendered"
done

# ─── Generate .icns bundles ──────────────────────────────────────────────────

echo ""
echo "Building .icns bundles..."

for iconset in "$SCRIPT_DIR"/*.iconset; do
  if [[ -d "$iconset" ]]; then
    name=$(basename "$iconset" .iconset)
    iconutil -c icns "$iconset" -o "$SCRIPT_DIR/$name.icns"
    echo "  $name.icns"
  fi
done

# ─── Tray icons ──────────────────────────────────────────────────────────────

echo ""
echo "Rendering tray icons..."

rsvg-convert -w 18 -h 18 "$PUBLIC_DIR/tray-icon.svg" -o "$PUBLIC_DIR/tray-icon.png"
rsvg-convert -w 36 -h 36 "$PUBLIC_DIR/tray-icon.svg" -o "$PUBLIC_DIR/tray-icon@2x.png"
echo "  tray-icon.png (18x18), tray-icon@2x.png (36x36)"

# ─── Web icons ───────────────────────────────────────────────────────────────

echo ""
echo "Rendering web icons..."

rsvg-convert -w 32 -h 32 "$PUBLIC_DIR/favicon.svg" -o "$PUBLIC_DIR/favicon-32.png"
echo "  favicon-32.png (32x32)"

# apple-touch-icon uses medium tier at 180px
rsvg-convert -w 180 -h 180 "$SVG_DIR/daedux-icon-emerald-dark-md.svg" -o "$PUBLIC_DIR/apple-touch-icon.png"
echo "  apple-touch-icon.png (180x180)"

echo ""
echo "Done! All icon assets generated."
