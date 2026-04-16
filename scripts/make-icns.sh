#!/bin/bash
# Generate proper .icns from an SVG using macOS native tools
set -e
cd "$(dirname "$0")/.."

ASSETS=assets
ICONSET="$ASSETS/icon.iconset"
SVG="/tmp/claude-dash-icon.svg"

# Create master SVG at 1024px
cat > "$SVG" << 'SVGEOF'
<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a1030"/>
      <stop offset="100%" stop-color="#0f0a1e"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#C4B5FD"/>
      <stop offset="100%" stop-color="#8B5CF6"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#8B5CF6" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#6D28D9" stop-opacity="0.05"/>
    </radialGradient>
  </defs>
  <rect x="82" y="82" width="860" height="860" rx="190" fill="url(#bg)"/>
  <rect x="82" y="82" width="860" height="860" rx="190" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4"/>
  <circle cx="512" cy="512" r="300" fill="none" stroke="url(#accent)" stroke-width="18" opacity="0.6"/>
  <circle cx="512" cy="512" r="200" fill="url(#glow)" stroke="url(#accent)" stroke-width="10" opacity="0.4"/>
  <circle cx="512" cy="512" r="80" fill="url(#accent)"/>
  <path d="M 262 662 A 300 300 0 0 1 362 262" fill="none" stroke="#22C55E" stroke-width="26" stroke-linecap="round" opacity="0.8"/>
  <path d="M 662 262 A 300 300 0 0 1 762 662" fill="none" stroke="#F97316" stroke-width="26" stroke-linecap="round" opacity="0.8"/>
</svg>
SVGEOF

# Create iconset directory
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# Convert SVG to master 1024 PNG
qlmanage -t -s 1024 -o /tmp "$SVG" 2>/dev/null
MASTER="/tmp/claude-dash-icon.svg.png"

if [ ! -f "$MASTER" ]; then
  echo "ERROR: qlmanage failed to convert SVG"
  exit 1
fi

# Generate all required sizes with sips
for SIZE in 16 32 128 256 512; do
  sips -z $SIZE $SIZE "$MASTER" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null 2>&1
  SIZE2=$((SIZE * 2))
  sips -z $SIZE2 $SIZE2 "$MASTER" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null 2>&1
done

# Build .icns
iconutil -c icns "$ICONSET" -o "$ASSETS/icon.icns"
echo "Generated: $ASSETS/icon.icns"

# Verify
iconutil --convert iconset "$ASSETS/icon.icns" --output /tmp/verify.iconset 2>/dev/null
echo "Icon contains: $(ls /tmp/verify.iconset | wc -l | tr -d ' ') images"
rm -rf /tmp/verify.iconset

# Cleanup
rm -rf "$ICONSET" "$SVG" "$MASTER"
echo "Done!"
