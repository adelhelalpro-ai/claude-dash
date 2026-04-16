/**
 * Generate app icon (.icns) and DMG background (.png) using Canvas API.
 * Requires: npm install canvas (or run with system-installed node-canvas)
 * Fallback: generates icon.iconset PNGs and uses sips + iconutil (macOS native)
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const ICONSET_DIR = path.join(ASSETS_DIR, 'icon.iconset');

// Ensure dirs exist
fs.mkdirSync(ICONSET_DIR, { recursive: true });

// ── Generate icon SVG ──────────────────────────────────

function generateIconSVG(size) {
  const r = size / 2;
  const pad = size * 0.08;
  const bgR = r - pad;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a1030"/>
      <stop offset="100%" stop-color="#0f0a1e"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#C4B5FD"/>
      <stop offset="100%" stop-color="#8B5CF6"/>
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8B5CF6" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#6D28D9" stop-opacity="0.1"/>
    </linearGradient>
  </defs>
  <!-- Background rounded square -->
  <rect x="${pad}" y="${pad}" width="${bgR * 2}" height="${bgR * 2}" rx="${size * 0.22}" fill="url(#bg)"/>
  <rect x="${pad}" y="${pad}" width="${bgR * 2}" height="${bgR * 2}" rx="${size * 0.22}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="${size * 0.005}"/>
  <!-- Outer ring -->
  <circle cx="${r}" cy="${r}" r="${size * 0.3}" fill="none" stroke="url(#accent)" stroke-width="${size * 0.018}" opacity="0.7"/>
  <!-- Inner glow ring -->
  <circle cx="${r}" cy="${r}" r="${size * 0.2}" fill="url(#glow)" stroke="url(#accent)" stroke-width="${size * 0.01}" opacity="0.5"/>
  <!-- Center dot -->
  <circle cx="${r}" cy="${r}" r="${size * 0.08}" fill="url(#accent)"/>
  <!-- Meter arcs (usage indicators) -->
  <path d="M ${r - size * 0.25} ${r + size * 0.15} A ${size * 0.3} ${size * 0.3} 0 0 1 ${r - size * 0.15} ${r - size * 0.25}" fill="none" stroke="#22C55E" stroke-width="${size * 0.025}" stroke-linecap="round" opacity="0.8"/>
  <path d="M ${r + size * 0.15} ${r - size * 0.25} A ${size * 0.3} ${size * 0.3} 0 0 1 ${r + size * 0.25} ${r + size * 0.15}" fill="none" stroke="#F97316" stroke-width="${size * 0.025}" stroke-linecap="round" opacity="0.8"/>
</svg>`;
}

// ── Generate DMG background SVG ────────────────────────

function generateDMGBackgroundSVG() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="600" height="400" viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a1030"/>
      <stop offset="100%" stop-color="#0f0a1e"/>
    </linearGradient>
  </defs>
  <rect width="600" height="400" fill="url(#bg)"/>
  <!-- Arrow hint -->
  <path d="M 250 200 L 340 200" stroke="rgba(139,92,246,0.5)" stroke-width="3" stroke-linecap="round" stroke-dasharray="8 6"/>
  <path d="M 330 190 L 345 200 L 330 210" fill="none" stroke="rgba(139,92,246,0.5)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Text -->
  <text x="300" y="340" text-anchor="middle" fill="rgba(255,255,255,0.3)" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="13">Drag to Applications</text>
</svg>`;
}

// ── Write SVGs and convert ─────────────────────────────

const sizes = [16, 32, 64, 128, 256, 512, 1024];

// Generate icon PNGs using sips (macOS native)
for (const size of sizes) {
  const svg = generateIconSVG(size);
  const svgPath = path.join(ICONSET_DIR, `icon_${size}.svg`);
  fs.writeFileSync(svgPath, svg);

  // Convert SVG to PNG using sips/qlmanage
  const pngName = size <= 512 ? `icon_${size}x${size}.png` : `icon_512x512@2x.png`;
  const pngPath = path.join(ICONSET_DIR, pngName);

  try {
    // Use qlmanage for SVG -> PNG (macOS native, no extra deps)
    execSync(`qlmanage -t -s ${size} -o "${ICONSET_DIR}" "${svgPath}" 2>/dev/null`, { stdio: 'pipe' });
    const qlOutput = path.join(ICONSET_DIR, `icon_${size}.svg.png`);
    if (fs.existsSync(qlOutput)) {
      fs.renameSync(qlOutput, pngPath);
    }
  } catch {
    // Fallback: use sips to create a sized PNG from the SVG
    try {
      execSync(`sips -s format png "${svgPath}" --out "${pngPath}" --resampleWidth ${size} --resampleHeight ${size} 2>/dev/null`, { stdio: 'pipe' });
    } catch {
      console.log(`Warning: Could not convert ${size}px icon`);
    }
  }

  // Also generate @2x versions for Retina
  if (size <= 256) {
    const retinaName = `icon_${size}x${size}@2x.png`;
    const retinaSrc = path.join(ICONSET_DIR, `icon_${size * 2}x${size * 2}.png`);
    const retinaDst = path.join(ICONSET_DIR, retinaName);
    // Will be copied after all sizes are generated
  }

  // Clean up SVG
  fs.unlinkSync(svgPath);
}

// Copy @2x retina versions
const retinaMap = { 16: 32, 32: 64, 128: 256, 256: 512 };
for (const [base, src] of Object.entries(retinaMap)) {
  const srcPath = path.join(ICONSET_DIR, `icon_${src}x${src}.png`);
  const dstPath = path.join(ICONSET_DIR, `icon_${base}x${base}@2x.png`);
  if (fs.existsSync(srcPath) && !fs.existsSync(dstPath)) {
    fs.copyFileSync(srcPath, dstPath);
  }
}

// Generate .icns
try {
  execSync(`iconutil -c icns "${ICONSET_DIR}" -o "${path.join(ASSETS_DIR, 'icon.icns')}"`, { stdio: 'pipe' });
  console.log('Generated: assets/icon.icns');
} catch (e) {
  console.error('iconutil failed:', e.message);
  console.log('Listing iconset contents:');
  console.log(fs.readdirSync(ICONSET_DIR).join(', '));
}

// Generate DMG background
const dmgSvg = generateDMGBackgroundSVG();
const dmgSvgPath = path.join(ASSETS_DIR, 'dmg-background.svg');
const dmgPngPath = path.join(ASSETS_DIR, 'dmg-background.png');
fs.writeFileSync(dmgSvgPath, dmgSvg);
try {
  execSync(`qlmanage -t -s 600 -o "${ASSETS_DIR}" "${dmgSvgPath}" 2>/dev/null`, { stdio: 'pipe' });
  const qlOut = path.join(ASSETS_DIR, 'dmg-background.svg.png');
  if (fs.existsSync(qlOut)) {
    fs.renameSync(qlOut, dmgPngPath);
    console.log('Generated: assets/dmg-background.png');
  }
} catch {
  console.log('Warning: Could not generate DMG background PNG');
}
fs.unlinkSync(dmgSvgPath);

// Cleanup iconset dir
try { fs.rmSync(ICONSET_DIR, { recursive: true }); } catch {}

console.log('Done!');
