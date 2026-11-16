// ─────────────────────────────────────────────────────────────────────────────
// Sunfall City — MOST WANTED card template
//
// Single source of truth for the card artwork. Both the real card pipeline
// (buildCardInBackground) and the landing-page demo card (generateDemoCard)
// render through buildCardSvgs, so the two can never drift apart.
//
// The card is authored in a 400x533 viewBox (3:4, ID-card proportion) and
// rasterised at 2x (800x1066) for retina. Layers are returned separately so
// the client can stack them with per-layer translateZ for 3D parallax.
// ─────────────────────────────────────────────────────────────────────────────

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function formatPlayerNumber(n: number): string {
  return n.toString().padStart(4, '0');
}

export interface CardFields {
  name: string;
  city: string;
  skill: string;
  district: string;
  playerNumber: number;
}

export interface CardSvgs {
  bgSvg: string;
  frameSvg: string;
  textSvg: string;
  bounty: string;
}

export function buildCardSvgs({ name, city, skill, district, playerNumber }: CardFields): CardSvgs {
  // Guilloche grain lines — violet/magenta tones for the Sunfall palette
  const guillocheLines = (() => {
    let paths = "";
    for (let y = 0; y <= 533; y += 11) {
      let d = `M 0 ${y}`;
      for (let x = 0; x <= 400; x += 8) {
        const dy = Math.sin((x / 400) * Math.PI * 6 + (y / 11)) * 2.5;
        d += ` L ${x} ${y + dy}`;
      }
      paths += `<path d="${d}" fill="none" stroke="rgba(45,226,230,0.07)" stroke-width="0.4"/>`;
    }
    for (let x = 0; x <= 400; x += 13) {
      let d = `M ${x} 0`;
      for (let y = 0; y <= 533; y += 8) {
        const dx = Math.sin((y / 533) * Math.PI * 8 + (x / 13)) * 2;
        d += ` L ${x + dx} ${y}`;
      }
      paths += `<path d="${d}" fill="none" stroke="rgba(255,45,149,0.05)" stroke-width="0.4"/>`;
    }
    return paths;
  })();

  // Sheriff star badge — 5-point star in a ticked ring, "SF" at centre
  const sheriffBadge = (() => {
    const cx = 377, cy = 25, r = 19;
    const ticks = Array.from({ length: 12 }, (_, i) => {
      const a = (i * 30 - 90) * Math.PI / 180;
      return `<line x1="${(cx + Math.cos(a) * r).toFixed(1)}" y1="${(cy + Math.sin(a) * r).toFixed(1)}" x2="${(cx + Math.cos(a) * (r - 4)).toFixed(1)}" y2="${(cy + Math.sin(a) * (r - 4)).toFixed(1)}" stroke="#ffd166" stroke-width="0.8"/>`;
    }).join('');
    const starR = r - 6, innerR = (r - 6) * 0.45;
    let pts = '';
    for (let i = 0; i < 5; i++) {
      const oa = (i * 72 - 90) * Math.PI / 180;
      const ia = ((i + 0.5) * 72 - 90) * Math.PI / 180;
      pts += `${(cx + Math.cos(oa) * starR).toFixed(1)},${(cy + Math.sin(oa) * starR).toFixed(1)} `;
      pts += `${(cx + Math.cos(ia) * innerR).toFixed(1)},${(cy + Math.sin(ia) * innerR).toFixed(1)} `;
    }
    return `<g opacity="0.9"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffd166" stroke-width="0.9"/>${ticks}<polygon points="${pts.trim()}" fill="#ffd166" opacity="0.7"/><text x="${cx}" y="${(cy + 3).toFixed(1)}" font-family="Impact,'Arial Black',sans-serif" font-size="5.5" fill="#1a0a2e" text-anchor="middle" font-weight="900">SF</text></g>`;
  })();

  // Fake barcode lines — bottom strip
  const barcodeLines = (() => {
    const pat = [2,1,3,1,2,1,1,3,2,1,1,2,3,1,1,2,1,3,2,1,1,2,1,1,3];
    const total = pat.reduce((a,b) => a+b, 0);
    const scale = 96 / total;
    let cx = 20, out = '';
    pat.forEach((u, i) => {
      const w = (u * scale).toFixed(1);
      if (i % 2 === 0) out += `<rect x="${cx.toFixed(1)}" y="503" width="${w}" height="13" fill="#8b6f9c" opacity="0.5"/>`;
      cx += u * scale;
    });
    return out;
  })();

  const playerNumStr = formatPlayerNumber(playerNumber);
  const caseNo = `SF-${playerNumber.toString().padStart(8, '0')}`;

  // Bounty: deterministic from player number so it never changes between rebuilds.
  // Range roughly $250K to $9.5M, rounded to the nearest 10K.
  const bountyAmount = Math.round((250000 + ((playerNumber * 738917) % 9250000)) / 10000) * 10000;
  const bounty = `$${bountyAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  const bountyFontSize = bounty.length <= 10 ? 27 : 23;

  const nameFontSize = name.length <= 8 ? 26 : name.length <= 13 ? 21 : 17;
  const nameLetterSpacing = name.length <= 8 ? 3 : 1;

  // All SVGs at 2× (800×1066) with viewBox="0 0 400 533" — crisp retina rendering
  // Card: 400×533 (3:4 ratio — ID card proportion)
  const sharedDefs = `
    <defs>
      <linearGradient id="bg-main" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#2b1055"/>
        <stop offset="55%"  stop-color="#160a2b"/>
        <stop offset="100%" stop-color="#0a0414"/>
      </linearGradient>
      <linearGradient id="sunset" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#ff2d95"/>
        <stop offset="100%" stop-color="#ff8a3d"/>
      </linearGradient>
      <linearGradient id="wanted-band" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%"   stop-color="#ff1f6b"/>
        <stop offset="50%"  stop-color="#ff2d95"/>
        <stop offset="100%" stop-color="#ff7a3d"/>
      </linearGradient>
      <linearGradient id="holo-strip" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%"   stop-color="#ff2d95"/>
        <stop offset="25%"  stop-color="#2de2e6"/>
        <stop offset="50%"  stop-color="#ffd166"/>
        <stop offset="75%"  stop-color="#9b4dff"/>
        <stop offset="100%" stop-color="#ff2d95"/>
      </linearGradient>
      <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#ffd166"/>
        <stop offset="50%"  stop-color="#ffe9a8"/>
        <stop offset="100%" stop-color="#d49a1f"/>
      </linearGradient>
      <radialGradient id="portrait-glow" cx="50%" cy="28%" r="40%">
        <stop offset="0%"   stop-color="#ff8a3d" stop-opacity="0.10"/>
        <stop offset="100%" stop-color="#0a0414" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="edge-dark" cx="50%" cy="50%" r="65%">
        <stop offset="55%"  stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.5"/>
      </radialGradient>
      <clipPath id="card-clip"><rect width="400" height="533" rx="18"/></clipPath>
    </defs>
  `;

  const bgSvg = `
    <svg width="800" height="1066" viewBox="0 0 400 533" xmlns="http://www.w3.org/2000/svg">
      ${sharedDefs}
      <g clip-path="url(#card-clip)">
        <rect width="400" height="533" fill="url(#bg-main)"/>
        <!-- Sun low on the horizon behind the portrait window -->
        <circle cx="200" cy="300" r="150" fill="url(#sunset)" opacity="0.13"/>
        ${guillocheLines}
        <rect x="60" y="44" width="280" height="310" fill="url(#portrait-glow)" rx="14"/>
        <!-- Holographic diagonal strip -->
        <rect x="-200" y="322" width="800" height="32" fill="url(#holo-strip)" opacity="0.13"
              transform="rotate(-35, 200, 338)"/>
        <rect width="400" height="533" fill="url(#edge-dark)"/>
      </g>
    </svg>
  `;

  const frameSvg = `
    <svg width="800" height="1066" viewBox="0 0 400 533" xmlns="http://www.w3.org/2000/svg">
      ${sharedDefs}
      <defs>
        <mask id="portrait-window">
          <rect width="400" height="533" rx="18" fill="white"/>
          <rect x="70" y="50" width="260" height="300" rx="12" fill="black"/>
        </mask>
      </defs>

      <!-- Deep violet overlay (masked away at the portrait window) -->
      <rect width="400" height="533" fill="rgba(22,10,43,0.58)" rx="18" mask="url(#portrait-window)"/>

      <!-- Card outer border -->
      <rect width="400" height="533" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1" rx="18"/>

      <!-- Portrait window border -->
      <rect x="69" y="49" width="262" height="302" rx="13" fill="none" stroke="url(#sunset)" stroke-width="2"/>

      <!-- Header -->
      <text x="20" y="31"
        fill="#ff2d95" font-family="Impact,'Arial Black',sans-serif"
        font-size="19" font-weight="900" letter-spacing="3.5">SUNFALL CITY</text>
      <text x="20" y="43"
        fill="#fdf4ff" font-family="Arial,sans-serif"
        font-size="7.5" letter-spacing="3" opacity="0.5">COUNTY SHERIFF — FUGITIVE BULLETIN</text>

      ${sheriffBadge}

      <rect x="0" y="50" width="400" height="0.6" fill="rgba(255,45,149,0.3)"/>

      <!-- MOST WANTED band, directly under the mugshot -->
      <rect x="16" y="356" width="368" height="24" rx="3" fill="url(#wanted-band)"/>
      <text x="200" y="372"
        fill="#ffffff" font-family="Impact,'Arial Black',sans-serif"
        font-size="15" font-weight="900" letter-spacing="6" text-anchor="middle">MOST WANTED</text>

      <!-- Data section dividers -->
      <rect x="16" y="414" width="368" height="0.5" fill="rgba(255,255,255,0.08)"/>

      <!-- Data row labels -->
      <text x="20" y="428" fill="#8b6f9c" font-family="'Courier New',monospace" font-size="7" letter-spacing="1.5">CASE NO</text>
      <text x="20" y="442" fill="#8b6f9c" font-family="'Courier New',monospace" font-size="7" letter-spacing="1.5">CHARGES</text>
      <text x="20" y="456" fill="#8b6f9c" font-family="'Courier New',monospace" font-size="7" letter-spacing="1.5">JURISDICTION</text>
      <text x="20" y="470" fill="#8b6f9c" font-family="'Courier New',monospace" font-size="7" letter-spacing="1.5">ISSUED</text>

      <!-- Bounty panel -->
      <rect x="16" y="478" width="368" height="0.5" fill="rgba(255,255,255,0.08)"/>
      <text x="20" y="494" fill="#ffd166" font-family="'Courier New',monospace" font-size="7.5" letter-spacing="2" opacity="0.75">REWARD FOR INFORMATION</text>

      <!-- Bottom strip -->
      ${barcodeLines}

      <text x="384" y="513"
        fill="#ff3b5c" font-family="'Courier New',monospace"
        font-size="7.5" text-anchor="end" letter-spacing="1.5" font-weight="700">STATUS: AT LARGE ✦</text>

      <!-- Legal disclaimer -->
      <text x="200" y="528"
        fill="rgba(255,255,255,0.12)" font-family="monospace"
        font-size="4" text-anchor="middle" letter-spacing="0.8">
        SUNFALL CITY NOVELTY BULLETIN ✦ FICTIONAL ✦ NOT A GOVERNMENT DOCUMENT
      </text>
    </svg>
  `;

  const textSvg = `
    <svg width="800" height="1066" viewBox="0 0 400 533" xmlns="http://www.w3.org/2000/svg">
      ${sharedDefs}

      <!-- Fugitive number (top-right in header) -->
      <text x="338" y="31"
        fill="rgba(255,45,149,0.45)" font-family="'Courier New',monospace"
        font-size="7" text-anchor="end" letter-spacing="1">#${playerNumStr}</text>

      <!-- Alias -->
      <text x="20" y="398"
        fill="#fdf4ff" font-family="Impact,'Arial Black',sans-serif"
        font-size="${nameFontSize}" font-weight="900" letter-spacing="${nameLetterSpacing}">${escapeXml(name.toUpperCase())}</text>

      <!-- Last seen -->
      <text x="20" y="410"
        fill="#8b6f9c" font-family="Arial,sans-serif"
        font-size="9.5" letter-spacing="1.8">LAST SEEN IN ${escapeXml(city.toUpperCase())}</text>

      <!-- CASE NO value -->
      <text x="135" y="428"
        fill="#fdf4ff" font-family="'Courier New',monospace"
        font-size="7" letter-spacing="1" opacity="0.82">${escapeXml(caseNo)}</text>

      <!-- CHARGES value -->
      <text x="135" y="442"
        fill="#ff8a3d" font-family="'Courier New',monospace"
        font-size="7" letter-spacing="1">${escapeXml(skill.toUpperCase())}</text>

      <!-- JURISDICTION value -->
      <text x="135" y="456"
        fill="#fdf4ff" font-family="'Courier New',monospace"
        font-size="7" letter-spacing="1" opacity="0.82">${escapeXml(district)}</text>

      <!-- ISSUED value -->
      <text x="135" y="470"
        fill="#fdf4ff" font-family="'Courier New',monospace"
        font-size="7" letter-spacing="1" opacity="0.82">${new Date().toISOString().slice(0, 10)}</text>

      <!-- Bounty figure -->
      <text x="384" y="496"
        fill="url(#gold)" font-family="Impact,'Arial Black',sans-serif"
        font-size="${bountyFontSize}" font-weight="900" text-anchor="end" letter-spacing="1">${bounty}</text>
    </svg>
  `;
  return { bgSvg, frameSvg, textSvg, bounty };
}
