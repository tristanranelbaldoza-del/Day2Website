// ═══════════════════════════════════════════════════════════════════
// serve.mjs — tiny static server for the YouTube Analyst HTML page
// ═══════════════════════════════════════════════════════════════════
// Runs on :3002 by default. Serves youtube-analyst.html at "/" plus
// any other static assets in this folder. Zero dependencies — pure
// Node built-ins so there's nothing extra to install.
//
// Usage:  node serve.mjs
// Open:   http://localhost:3002

import http        from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 3002);
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));

// Minimal MIME map — enough for this project.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

// Files that must never be served — would leak secrets.
const FORBIDDEN = new Set(['.env', '.env.example', 'credentials.json', 'token.json']);

const server = http.createServer(async (req, res) => {
  try {
    // Default route — serve the dashboard HTML.
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/youtube-analyst.html';

    // Prevent path traversal (../), and block sensitive files.
    const rel  = path.replace(/^\/+/, '');
    const full = resolve(ROOT, rel);
    if (!full.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (FORBIDDEN.has(rel) || rel.startsWith('tools/') || rel.endsWith('.py')) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(full).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 — not found');
      return;
    }

    const type = MIME[extname(full).toLowerCase()] || 'application/octet-stream';
    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type':   type,
      'Cache-Control':  'no-cache',
    });
    res.end(body);
  } catch (err) {
    console.error('[serve]', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('500 — internal error');
  }
});

server.listen(PORT, () => {
  console.log(`
═══════════════════════════════════════════════════════════
  YouTube Analyst · local server
═══════════════════════════════════════════════════════════
  Open:  http://localhost:${PORT}
  Root:  ${ROOT}
  Stop:  Ctrl+C
`);
});
