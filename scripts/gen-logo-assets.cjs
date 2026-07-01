// Generates raster brand assets (favicon, app icons, splash, og) from the
// Wearables Data Platform mark. Requires `sharp`.
// Run from repo root: `node scripts/gen-logo-assets.mjs`
const sharp = require('sharp');

const INK = '#1c1c1e'; // wordmark/mark ink, matches web --foreground
const APP_BG = '#e6f4fe'; // existing mobile app icon background
const OG_BG = '#f7f6f3'; // web --background (light)

// Ring + pulse mark filling a size x size box with `pad` padding.
function markSVG({ size, pad, stroke, bg = null }) {
  const s = size;
  const c = s / 2;
  const r = (s - pad * 2) / 2;
  const sw = Math.max(2, s * 0.055);
  const x0 = pad + r * 0.16;
  const w = 2 * r - r * 0.32;
  const y = c;
  const pts = [
    [0.0, 0.02], [0.16, 0.02], [0.3, -0.42], [0.52, 0.62],
    [0.7, -0.3], [0.82, 0.16], [1.0, 0.02],
  ];
  const d = pts
    .map(([px, py], i) => `${i ? 'L' : 'M'}${(x0 + px * w).toFixed(2)} ${(y + py * r).toFixed(2)}`)
    .join(' ');
  const rect = bg ? `<rect width="${s}" height="${s}" rx="${(s * 0.22).toFixed(1)}" fill="${bg}"/>` : '';
  return Buffer.from(
    `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">${rect}` +
      `<circle cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="none" stroke="${stroke}" stroke-width="${sw.toFixed(2)}"/>` +
      `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
}

async function png(svg, size, out) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out);
  console.log('wrote', out);
}

async function main() {
  await png(markSVG({ size: 128, pad: 12, stroke: INK }), 32, 'web/public/favicon.png');
  await png(markSVG({ size: 512, pad: 96, stroke: INK, bg: OG_BG }), 256, 'web/public/apple-touch-icon.png');
  await png(markSVG({ size: 1024, pad: 210, stroke: INK, bg: APP_BG }), 1024, 'app/assets/icon.png');
  await png(markSVG({ size: 128, pad: 10, stroke: INK }), 48, 'app/assets/favicon.png');
  await png(markSVG({ size: 512, pad: 150, stroke: INK }), 512, 'app/assets/android-icon-foreground.png');
  await png(markSVG({ size: 432, pad: 120, stroke: '#000000' }), 432, 'app/assets/android-icon-monochrome.png');
  await png(markSVG({ size: 1024, pad: 340, stroke: INK }), 1024, 'app/assets/splash-icon.png');

  const og = Buffer.from(
    `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="1200" height="630" fill="${OG_BG}"/>` +
      `<g transform="translate(378 250)">` +
      `<circle cx="55" cy="55" r="50" fill="none" stroke="${INK}" stroke-width="7"/>` +
      `<path d="M20 57 L34 57 L48 24 L74 96 L92 40 L102 62 L120 57" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<text x="152" y="74" font-family="Helvetica,Arial,sans-serif" font-size="66" font-weight="700" letter-spacing="-2" fill="${INK}">Wearables</text>` +
      `</g>` +
      `<text x="600" y="412" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="27" fill="#8f8f8f">Your body has a story. See it unfold.</text>` +
      `</svg>`
  );
  await sharp(og, { density: 144 }).png().toFile('web/public/og.png');
  console.log('wrote web/public/og.png');
}

main().catch((e) => { console.error(e); process.exit(1); });
