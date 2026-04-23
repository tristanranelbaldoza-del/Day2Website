#!/usr/bin/env node
// Generates a pair of images — blueprint "start frame" + rendered "end frame"
// for the Famous Building category (Empire State Building) via Kie.ai Nano
// Banana. Reads KIE_API_KEY from env or .env. Writes PNGs to
// images/generated/landmarks/building-*.png.
//
// Run:  node scripts/gen-landmark-building.mjs
//       FORCE=1 node scripts/gen-landmark-building.mjs  (regenerate existing)
import fs from 'fs';
import path from 'path';

const KEY = process.env.KIE_API_KEY
  || fs.readFileSync('.env', 'utf8').match(/KIE_API_KEY=(.+)/)?.[1]?.trim();
if (!KEY) { console.error('Set KIE_API_KEY in env or .env'); process.exit(1); }

const HEADERS = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const SUBJECT =
  'the Empire State Building in Manhattan, New York — iconic Art Deco skyscraper ' +
  'with its signature tiered setbacks rising to the mooring mast and antenna spire, ' +
  'limestone and steel façade, 102 stories';

const FRAMES = [
  {
    out: 'images/generated/landmarks/building-01-blueprint.png',
    prompt: `Detailed architectural blueprint drawing of ${SUBJECT}, thin technical white lines on a deep blueprint blue paper, faint gridded paper background, dimension annotations and measurement ticks in the margins, faint construction guide lines, draftsman elevation view, fine monochrome white-on-blueprint-blue drawing, cinematic architectural illustration, 3:4 portrait aspect, crisp and precise, no readable text labels`,
  },
  {
    out: 'images/generated/landmarks/building-02-rendered.png',
    prompt: `Beautifully finished photorealistic rendering of ${SUBJECT}, dramatic golden hour lighting with warm amber sunset, rich material detail showing limestone and brushed steel, deep shadows in the setback tiers, illuminated crown, cinematic editorial architectural photography quality, shallow depth of field with the tower in focus, 3:4 portrait aspect, high detail`,
  },
];

async function submit(prompt) {
  const r = await fetch('https://api.kie.ai/api/v1/playground/createTask', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      model: 'google/nano-banana',
      input: { prompt, image_size: '3:4', output_format: 'png' },
    }),
  });
  const j = await r.json();
  if (!j.data?.taskId) throw new Error(`submit: ${JSON.stringify(j)}`);
  return j.data.taskId;
}

async function poll(taskId, maxSeconds = 180) {
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    const r = await fetch(
      `https://api.kie.ai/api/v1/playground/recordInfo?taskId=${taskId}`,
      { headers: HEADERS }
    );
    const j = await r.json();
    if (j.data?.state === 'success') return JSON.parse(j.data.resultJson).resultUrls[0];
    if (j.data?.state === 'fail')    throw new Error(`failed: ${j.data.failMsg || 'unknown'}`);
    await new Promise(r => setTimeout(r, 5_000));
  }
  throw new Error('timeout');
}

async function download(url, out) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
}

async function generate(p) {
  const tag = path.basename(p.out);
  if (fs.existsSync(p.out) && !process.env.FORCE) {
    console.log(`[${tag}] skip (exists — set FORCE=1 to regenerate)`);
    return true;
  }
  try {
    const taskId = await submit(p.prompt);
    console.log(`[${tag}] task=${taskId}`);
    const url = await poll(taskId);
    await download(url, p.out);
    console.log(`[${tag}] saved ${(fs.statSync(p.out).size / 1024).toFixed(0)}KB`);
    return true;
  } catch (e) {
    console.error(`[${tag}] ERROR: ${e.message}`);
    return false;
  }
}

const t = Date.now();
const results = await Promise.all(FRAMES.map(generate));
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${FRAMES.length} succeeded in ${((Date.now() - t) / 1000).toFixed(1)}s`);
process.exit(ok === FRAMES.length ? 0 : 1);
