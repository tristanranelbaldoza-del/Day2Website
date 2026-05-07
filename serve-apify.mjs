import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3005;

function loadEnv(filePath) {
  const env = {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return env;
  }
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}

const ENV = loadEnv(path.join(__dirname, '.env'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function fetchJSON(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try {
      urlObj = new URL(urlString);
    } catch (err) {
      reject(err);
      return;
    }

    const requestOptions = {
      method: options.method || 'GET',
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      headers: { ...(options.headers || {}) },
    };

    let bodyBuf;
    if (options.body !== undefined && options.body !== null) {
      bodyBuf =
        typeof options.body === 'string' || Buffer.isBuffer(options.body)
          ? Buffer.from(options.body)
          : Buffer.from(JSON.stringify(options.body));
      if (!requestOptions.headers['Content-Type']) {
        requestOptions.headers['Content-Type'] = 'application/json';
      }
      requestOptions.headers['Content-Length'] = bodyBuf.length;
    }

    const req = https.request(requestOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        try {
          data = text.length ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 5_000_000) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApifyRun(req, res) {
  const token = ENV.APIFY_TOKEN;
  if (!token) return sendJSON(res, 500, { error: 'APIFY_TOKEN not set in .env' });

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendJSON(res, 400, { error: err.message });
  }

  const { actorId, input } = body;
  if (!actorId) return sendJSON(res, 400, { error: 'Missing actorId in request body.' });

  try {
    const result = await fetchJSON(
      `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(token)}`,
      { method: 'POST', body: input ?? {} }
    );
    sendJSON(res, result.status || 502, result.data);
  } catch (err) {
    sendJSON(res, 502, { error: 'Apify request failed: ' + err.message });
  }
}

async function handleApifyRunStatus(req, res, runId) {
  const token = ENV.APIFY_TOKEN;
  if (!token) return sendJSON(res, 500, { error: 'APIFY_TOKEN not set in .env' });

  try {
    const runResp = await fetchJSON(
      `https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`
    );
    if (!runResp.status || runResp.status >= 400) {
      return sendJSON(res, runResp.status || 502, runResp.data);
    }

    const outputResp = await fetchJSON(
      `https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}/dataset/items?token=${encodeURIComponent(token)}`
    );

    sendJSON(res, 200, {
      status: runResp.data?.data?.status ?? null,
      run: runResp.data?.data ?? runResp.data,
      output: outputResp.status >= 200 && outputResp.status < 300 ? outputResp.data : null,
    });
  } catch (err) {
    sendJSON(res, 502, { error: 'Apify status request failed: ' + err.message });
  }
}

const REDDIT_SORTS = new Set(['hot', 'new', 'top', 'relevance']);
const REDDIT_LIMITS = new Set([25, 50, 100]);

async function handleRedditSearch(req, res, query) {
  const q = (query.get('q') || '').trim();
  if (!q) return sendJSON(res, 400, { error: 'Missing required query param: q' });

  const sort = REDDIT_SORTS.has(query.get('sort')) ? query.get('sort') : 'relevance';
  const limitNum = Number(query.get('limit'));
  const limit = REDDIT_LIMITS.has(limitNum) ? limitNum : 25;

  const url =
    'https://www.reddit.com/search.json' +
    `?q=${encodeURIComponent(q)}&sort=${sort}&limit=${limit}`;

  try {
    const result = await fetchJSON(url, {
      headers: { 'User-Agent': 'apify-tools-dashboard/0.1 (reddit-trend-finder)' },
    });
    if (!result.status || result.status >= 400) {
      return sendJSON(res, result.status || 502, {
        error: 'Reddit request failed',
        status: result.status,
        body: result.data,
      });
    }
    const children = result.data?.data?.children ?? [];
    const posts = children
      .map((c) => c?.data)
      .filter(Boolean)
      .map((d) => ({
        title: d.title,
        score: d.score,
        num_comments: d.num_comments,
        subreddit: d.subreddit,
        permalink: d.permalink,
        url: 'https://reddit.com' + d.permalink,
      }));
    sendJSON(res, 200, { query: q, sort, limit, count: posts.length, posts });
  } catch (err) {
    sendJSON(res, 502, { error: 'Reddit request failed: ' + err.message });
  }
}

const YT_MODES = new Set(['keyword', 'trending']);

const YT_SCHEMA = {
  type: 'object',
  properties: {
    videos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          viewCount: { type: ['number', 'string', 'null'] },
          channelName: { type: ['string', 'null'] },
          publishedAt: { type: ['string', 'null'] },
          url: { type: ['string', 'null'] },
          duration: { type: ['string', 'null'] },
        },
        required: ['title'],
      },
    },
  },
  required: ['videos'],
};

function parseViewCount(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/views?/g, '').replace(/,/g, '').trim();
  const m = s.match(/^([\d.]+)\s*([kmb])?$/);
  if (m) {
    const n = parseFloat(m[1]);
    const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1;
    const out = Math.round(n * mult);
    return Number.isFinite(out) ? out : null;
  }
  const digits = parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(digits) ? digits : null;
}

function normalizeYouTubeURL(raw) {
  if (!raw) return null;
  let u = String(raw).trim();
  if (!u) return null;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return 'https://www.youtube.com' + u;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[\w-]{11}$/.test(u)) return 'https://www.youtube.com/watch?v=' + u;
  return 'https://www.youtube.com/' + u.replace(/^\/+/, '');
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return null;
}

function normalizeVideo(v) {
  if (!v || typeof v !== 'object') return null;
  const title = pickFirst(v, ['title', 'videoTitle', 'name']);
  if (!title) return null;
  return {
    title: String(title),
    viewCount: parseViewCount(
      pickFirst(v, ['viewCount', 'views', 'view_count', 'viewsCount', 'viewers'])
    ),
    channelName: ((c) => (c ? String(c) : null))(
      pickFirst(v, ['channelName', 'channel', 'channel_name', 'author', 'uploader'])
    ),
    publishedAt: ((p) => (p ? String(p) : null))(
      pickFirst(v, ['publishedAt', 'published', 'uploadedAt', 'uploaded', 'date', 'publishedTime'])
    ),
    url: normalizeYouTubeURL(pickFirst(v, ['url', 'videoUrl', 'link', 'href'])),
    duration: ((d) => (d ? String(d) : null))(
      pickFirst(v, ['duration', 'length', 'runtime'])
    ),
  };
}

async function handleYouTubeSearch(req, res, query) {
  const key = ENV.FIRECRAWL_API_KEY;
  if (!key) return sendJSON(res, 500, { error: 'FIRECRAWL_API_KEY not set in .env' });

  const mode = YT_MODES.has(query.get('mode')) ? query.get('mode') : 'keyword';
  const q = (query.get('q') || '').trim();
  if (mode === 'keyword' && !q) {
    return sendJSON(res, 400, { error: 'Missing required query param: q (when mode=keyword)' });
  }

  const targetURL =
    mode === 'trending'
      ? 'https://www.youtube.com/feed/trending'
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=CAM%253D`;

  const prompt =
    mode === 'trending'
      ? 'Extract every video card on this YouTube Trending page. For each: title, viewCount (parse strings like "1.2M views" into the integer 1200000), channelName, publishedAt (the relative timestamp shown, e.g. "2 days ago"), url (the full https://www.youtube.com/watch?v=... link), and duration (e.g. "12:34"). Skip ads, playlists, and shelf headers.'
      : `Extract every YouTube video card from these search results. For each: title, viewCount (parse "1.2M views" -> 1200000), channelName, publishedAt (e.g. "2 days ago"), url (the full https://www.youtube.com/watch?v=... link), and duration (e.g. "12:34"). Skip ads, playlists, and shelf headers. Search query was: "${q}".`;

  const firecrawlBody = {
    url: targetURL,
    formats: ['json'],
    onlyMainContent: false,
    waitFor: 4000,
    proxy: 'stealth',
    jsonOptions: { prompt, schema: YT_SCHEMA },
  };

  try {
    const result = await fetchJSON('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: firecrawlBody,
    });

    if (!result.status || result.status >= 400) {
      return sendJSON(res, result.status || 502, {
        error: 'Firecrawl request failed',
        status: result.status,
        body: result.data,
      });
    }

    const extracted = result.data?.data?.json ?? {};
    const rawVideos = Array.isArray(extracted.videos) ? extracted.videos : [];

    let videos = rawVideos.map(normalizeVideo).filter(Boolean);

    const seen = new Set();
    videos = videos.filter((v) => {
      const k = v.url || v.title;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    videos.sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1));

    const totalViews = videos.reduce((sum, v) => sum + (v.viewCount ?? 0), 0);
    const topViews = videos.reduce((m, v) => Math.max(m, v.viewCount ?? 0), 0);
    const uniqueChannels = new Set(videos.map((v) => v.channelName).filter(Boolean)).size;

    sendJSON(res, 200, {
      mode,
      query: mode === 'keyword' ? q : null,
      count: videos.length,
      totalViews,
      topViews,
      uniqueChannels,
      videos,
    });
  } catch (err) {
    sendJSON(res, 502, { error: 'YouTube scrape failed: ' + err.message });
  }
}

const LINKEDIN_LIMITS = new Set([10, 20, 50]);

function extractLinkedInAuthor(title, url) {
  if (title) {
    const t = String(title).trim();
    let m = t.match(/^(.+?)\s+on\s+LinkedIn\b/i);
    if (m) return m[1].trim();
    m = t.match(/\|\s*([^|]+?)\s+posted\b/i);
    if (m) return m[1].trim();
  }
  if (url) {
    const m = String(url).match(/\/posts\/([^/_?#]+)/i);
    if (m) {
      const parts = m[1].split('-').filter(Boolean);
      while (parts.length && /^(?=.*\d)[a-z0-9]{6,}$/i.test(parts[parts.length - 1])) parts.pop();
      while (parts.length && /^\d+$/.test(parts[parts.length - 1])) parts.pop();
      const name = parts
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(' ');
      if (name) return name;
    }
  }
  return null;
}

async function handleLinkedInSearch(req, res, query) {
  const key = ENV.FIRECRAWL_API_KEY;
  if (!key) return sendJSON(res, 500, { error: 'FIRECRAWL_API_KEY not set in .env' });

  const q = (query.get('q') || '').trim();
  if (!q) return sendJSON(res, 400, { error: 'Missing required query param: q' });

  const limitNum = Number(query.get('limit'));
  const limit = LINKEDIN_LIMITS.has(limitNum) ? limitNum : 10;

  const firecrawlBody = {
    query: `site:linkedin.com/posts ${q}`,
    limit,
    scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
  };

  try {
    const result = await fetchJSON('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: firecrawlBody,
    });

    if (!result.status || result.status >= 400) {
      return sendJSON(res, result.status || 502, {
        error: 'Firecrawl search failed',
        status: result.status,
        body: result.data,
      });
    }

    const payload = result.data?.data;
    const rawItems = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.web)
        ? payload.web
        : [];

    const items = rawItems
      .map((r) => ({
        authorName: extractLinkedInAuthor(r?.title, r?.url) || 'Unknown',
        text: (r?.description || '').toString().trim(),
        url: r?.url || null,
      }))
      .filter((r) => r.url && r.text);

    sendJSON(res, 200, { query: q, count: items.length, items });
  } catch (err) {
    sendJSON(res, 502, { error: 'LinkedIn search failed: ' + err.message });
  }
}

function parseShopeePrice(text) {
  if (!text) return null;
  const m = String(text).match(/₱\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function cleanShopeeName(title) {
  if (!title) return '';
  let name = String(title);
  name = name.replace(/\s*[|–\-—]\s*Shopee(?:\s+Philippines)?\s*$/i, '');
  name = name.replace(/\s*\|\s*Shopee[^|]*$/i, '');
  name = name.replace(/\s*₱\s*[\d,]+(?:\.\d+)?\s*$/u, '');
  return name.trim();
}

async function handleShopeeSearch(req, res, query) {
  const key = ENV.FIRECRAWL_API_KEY;
  if (!key) return sendJSON(res, 500, { error: 'FIRECRAWL_API_KEY not set in .env' });

  const q = (query.get('q') || '').trim();
  if (!q) return sendJSON(res, 400, { error: 'Missing required query param: q' });

  const firecrawlBody = {
    query: `site:shopee.ph ${q}`,
    limit: 20,
  };

  try {
    const result = await fetchJSON('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: firecrawlBody,
    });

    if (!result.status || result.status >= 400) {
      return sendJSON(res, result.status || 502, {
        error: 'Firecrawl search failed',
        status: result.status,
        body: result.data,
      });
    }

    const payload = result.data?.data;
    const rawItems = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.web)
        ? payload.web
        : [];

    const items = rawItems
      .map((r) => ({
        url: r?.url || null,
        title: r?.title || '',
        description: (r?.description || '').toString().trim(),
      }))
      .filter((r) => r.url && /shopee\.ph/i.test(r.url))
      .filter((r) => !/\/buyer\//i.test(r.url) && !/\/search/i.test(r.url))
      .map((r) => {
        const price = parseShopeePrice(r.description) ?? parseShopeePrice(r.title);
        return {
          name: cleanShopeeName(r.title),
          price,
          description: r.description,
          url: r.url,
        };
      })
      .filter((r) => r.name);

    sendJSON(res, 200, { query: q, count: items.length, items });
  } catch (err) {
    sendJSON(res, 502, { error: 'Shopee search failed: ' + err.message });
  }
}

async function handleFirecrawlScrape(req, res) {
  const key = ENV.FIRECRAWL_API_KEY;
  if (!key) return sendJSON(res, 500, { error: 'FIRECRAWL_API_KEY not set in .env' });

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendJSON(res, 400, { error: err.message });
  }

  const { url, ...rest } = body;
  if (!url) return sendJSON(res, 400, { error: 'Missing url in request body.' });

  try {
    const result = await fetchJSON('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: { url, ...rest },
    });
    sendJSON(res, result.status || 502, result.data);
  } catch (err) {
    sendJSON(res, 502, { error: 'Firecrawl request failed: ' + err.message });
  }
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/apify-index.html';

  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(__dirname, safePath);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      ...CORS_HEADERS,
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  if (req.method === 'POST' && urlPath === '/api/apify/run') {
    return handleApifyRun(req, res);
  }

  const runMatch = urlPath.match(/^\/api\/apify\/run\/([^/]+)$/);
  if (req.method === 'GET' && runMatch) {
    return handleApifyRunStatus(req, res, decodeURIComponent(runMatch[1]));
  }

  if (req.method === 'POST' && urlPath === '/api/firecrawl/scrape') {
    return handleFirecrawlScrape(req, res);
  }

  if (req.method === 'GET' && urlPath === '/api/reddit/search') {
    const query = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    return handleRedditSearch(req, res, query);
  }

  if (req.method === 'GET' && urlPath === '/api/youtube/search') {
    const query = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    return handleYouTubeSearch(req, res, query);
  }

  if (req.method === 'GET' && urlPath === '/api/linkedin/search') {
    const query = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    return handleLinkedInSearch(req, res, query);
  }

  if (req.method === 'GET' && urlPath === '/api/shopee/search') {
    const query = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    return handleShopeeSearch(req, res, query);
  }

  if (req.method === 'GET') {
    return serveStatic(req, res);
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
