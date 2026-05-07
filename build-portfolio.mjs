// One-shot: screenshot every content-rich live page on localhost:3000,
// save each under /portfolio-screenshots/, then write a portfolio.html
// grid that displays them. Skips empty/utility pages (coming-soon,
// thank-you, login, signup, dashboard).

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = '/Users/admin/W1D2';
const FOLDER     = path.join(ROOT, 'about', 'live project screenshots');
const OUT_HTML   = path.join(FOLDER, 'portfolio.html');
const BASE       = 'http://localhost:3000';

// Screenshots and the gallery HTML all live inside the folder so the
// whole thing is portable as a self-contained directory.
const OUT_DIR    = FOLDER;

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const PAGES = [
  { slug: 'index',           title: 'Tester.io',           subtitle: 'Landing — the studio',                       url: '/' },
  { slug: 'about',           title: 'About',               subtitle: 'Manifesto, principles, history',             url: '/about/about.html' },
  { slug: 'product',         title: 'Smart Watch Pro',     subtitle: 'Product page',                                url: '/product.html' },
  { slug: 'tester-tech',     title: 'TesterTech',          subtitle: '3D Tester Hub speaker · scroll scenes',       url: '/TesterTech.html' },
  { slug: 'taj',             title: 'Taj',                 subtitle: 'Landmark sequence · blueprint→render',        url: '/Taj.html' },
  { slug: 'sights',          title: 'Sights',              subtitle: 'Landmark scroll narrative',                   url: '/Sights.html' },
  { slug: 'lantern-fund',    title: 'Lantern Fund',        subtitle: 'Charity — children\'s home cause page',       url: '/anything.html' },
  { slug: 'moodboard',       title: 'FrontEnd · Moodboard', subtitle: 'AI concept generator · kie.ai',              url: '/moodboard.html' },
  { slug: 'youtube-analyst', title: 'YouTube Analyst',     subtitle: 'Channel-report dashboard · Sheets + Slides',  url: '/Youtube%20Analyst/youtube-analyst.html' },
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const taken = [];
for (const p of PAGES) {
  const page = await context.newPage();
  const fullUrl = BASE + p.url;
  process.stdout.write(`  · ${p.slug.padEnd(18)} ${fullUrl}  …  `);
  try {
    await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30000 });
    // Give scroll-driven / GSAP-style animations a moment to settle
    await page.waitForTimeout(1200);
    const out = path.join(OUT_DIR, `${p.slug}.png`);
    await page.screenshot({ path: out, fullPage: false });
    const kb = (fs.statSync(out).size / 1024).toFixed(0);
    console.log(`✓ ${kb}KB`);
    taken.push(p);
  } catch (e) {
    console.log(`✗ ${e.message}`);
  } finally {
    await page.close();
  }
}
await browser.close();

console.log(`\n${taken.length}/${PAGES.length} pages captured.`);

// ── Generate portfolio.html ──────────────────────────────────────
const cardsHtml = taken.map((p, i) => `
      <a href="${p.url}" target="_blank" rel="noopener" class="card group" style="--i:${i}">
        <figure class="card-frame">
          <img src="${p.slug}.png" alt="${p.title} screenshot" loading="lazy"/>
          <div class="card-overlay">
            <span class="card-cta">Visit ↗</span>
          </div>
        </figure>
        <figcaption class="card-meta">
          <h3 class="card-title">${p.title}</h3>
          <p class="card-sub">${p.subtitle}</p>
          <p class="card-url">${p.url}</p>
        </figcaption>
      </a>`).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="A tour of every live page in the Tester.io studio." />
  <title>Portfolio — Tester.io</title>

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,300&family=Montserrat:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

  <style>
    :root {
      --canvas:        #0E0A03;
      --canvas-elev:   #150E05;
      --ink:           #f5ead6;
      --ink-dim:       #c9b882;
      --ink-faint:     #8B6F2E;
      --gold:          #E6B979;
      --gold-soft:     #F0C990;
      --line:          rgba(230, 185, 121, 0.18);
      --ease:          cubic-bezier(.2,.8,.2,1);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: var(--canvas); color: var(--ink); }
    body { font-family: 'Montserrat', sans-serif; -webkit-font-smoothing: antialiased; min-height: 100vh; overflow-x: hidden; }
    a { color: inherit; text-decoration: none; }
    img { display: block; max-width: 100%; }
    ::selection { background: rgba(230,185,121,0.35); color: #fff; }

    body::before {
      content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 0;
      background:
        radial-gradient(ellipse 80% 50% at 50% 0%, rgba(230, 185, 121, 0.10) 0%, transparent 60%),
        radial-gradient(ellipse 50% 35% at 5% 95%, rgba(198, 165, 89, 0.05) 0%, transparent 70%);
    }
    body::after {
      content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 1;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.05' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 0.95  0 0 0 0 0.92  0 0 0 0 0.84  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.45'/></svg>");
      opacity: 0.06; mix-blend-mode: overlay;
    }

    .display { font-family: 'Fraunces', serif; font-variation-settings: "opsz" 144; font-weight: 700; letter-spacing: -0.022em; line-height: 0.9; }
    .display-it { font-family: 'Fraunces', serif; font-variation-settings: "opsz" 144; font-weight: 300; font-style: italic; }

    .wrap { position: relative; z-index: 2; max-width: 1320px; margin: 0 auto; padding: 56px clamp(20px, 4vw, 56px) 80px; }

    .nav-back {
      display: inline-flex; align-items: center; gap: 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
      color: var(--ink-faint);
      transition: color 200ms;
    }
    .nav-back:hover { color: var(--gold); }

    h1.hero {
      margin-top: 28px;
      font-size: clamp(56px, 11vw, 168px);
      color: var(--ink);
      max-width: 14ch;
    }
    h1.hero em { color: var(--gold); }

    .lede {
      margin-top: 22px;
      max-width: 640px;
      font-size: 16px;
      line-height: 1.7;
      color: var(--ink-dim);
    }

    .meta-row {
      margin-top: 18px;
      display: flex; flex-wrap: wrap; gap: 28px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--ink-faint);
    }
    .meta-row span strong { color: var(--gold); font-weight: 500; }

    .grid {
      margin-top: 60px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 28px;
    }

    @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }

    .card {
      display: block;
      animation: rise 700ms var(--ease) calc(var(--i, 0) * 70ms + 200ms) both;
    }
    .card-frame {
      position: relative;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      border: 1px solid var(--line);
      background: var(--canvas-elev);
      border-radius: 4px;
      transition: border-color 320ms, transform 320ms var(--ease), box-shadow 320ms var(--ease);
    }
    .card-frame img {
      width: 100%; height: 100%;
      object-fit: cover; object-position: top center;
      transition: transform 600ms var(--ease), filter 320ms;
      filter: saturate(0.95);
    }
    .card-overlay {
      position: absolute; inset: 0;
      background: linear-gradient(to top, rgba(14,10,3,0.85) 0%, rgba(14,10,3,0) 50%);
      display: flex; align-items: flex-end; justify-content: flex-end;
      padding: 18px;
      opacity: 0;
      transition: opacity 320ms var(--ease);
    }
    .card-cta {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 16px;
      background: var(--gold);
      color: var(--canvas);
      font-family: 'JetBrains Mono', monospace;
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      border-radius: 999px;
      transform: translateY(8px);
      transition: transform 320ms var(--ease);
    }
    .card:hover .card-frame { border-color: rgba(230, 185, 121, 0.55); transform: translateY(-3px); box-shadow: 0 22px 50px -22px rgba(230, 185, 121, 0.35); }
    .card:hover .card-frame img { transform: scale(1.04); filter: saturate(1.05); }
    .card:hover .card-overlay { opacity: 1; }
    .card:hover .card-cta { transform: translateY(0); }

    .card-meta { padding-top: 16px; }
    .card-title {
      font-family: 'Fraunces', serif;
      font-variation-settings: "opsz" 96;
      font-weight: 600;
      font-size: 22px;
      line-height: 1.15;
      color: var(--ink);
      letter-spacing: -0.01em;
    }
    .card-sub {
      margin-top: 4px;
      font-size: 13px;
      color: var(--ink-dim);
      line-height: 1.5;
    }
    .card-url {
      margin-top: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--ink-faint);
      word-break: break-all;
    }

    footer {
      margin-top: 80px;
      padding-top: 28px;
      border-top: 1px solid var(--line);
      display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--ink-faint);
    }
    footer a { color: var(--ink-faint); transition: color 200ms; }
    footer a:hover { color: var(--gold); }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    }

    @media (max-width: 540px) {
      .grid { grid-template-columns: 1fr; gap: 22px; }
    }
  </style>
</head>

<body>
  <div class="wrap">
    <a href="/" class="nav-back">← Back to home</a>
    <span class="nav-back" style="margin-left:18px;color:rgba(139,111,46,0.65);">·  /about/live project screenshots/</span>

    <h1 class="hero display">Every <span class="display-it">page</span>, in one room.</h1>
    <p class="lede">A live tour of every page in the Tester.io studio — landing, product surfaces, brand pages, and the working tools. Each thumbnail links to the live page. Captured at 1440×900.</p>
    <div class="meta-row">
      <span><strong>${taken.length}</strong> pages</span>
      <span>captured · ${new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
      <span>localhost · 3000</span>
    </div>

    <div class="grid">${cardsHtml}
    </div>

    <footer>
      <span>Tester.io · Studio · MMXXVI</span>
      <span><a href="/">Home</a> · <a href="/about/about.html">About</a> · <a href="/moodboard.html">Moodboard</a></span>
    </footer>
  </div>
</body>
</html>
`;

fs.writeFileSync(OUT_HTML, html, 'utf8');
console.log(`Wrote ${OUT_HTML} (${(html.length / 1024).toFixed(1)}KB)`);
