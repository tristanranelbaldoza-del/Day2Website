#!/usr/bin/env node
// Generates Tester Tech catalog imagery via Kie.ai (Nano Banana).
// Reads KIE_API_KEY from env or .env. Writes PNGs to images/generated/.
import fs from 'fs';
import path from 'path';

const KEY = process.env.KIE_API_KEY
  || fs.readFileSync('.env', 'utf8').match(/KIE_API_KEY=(.+)/)?.[1]?.trim();
if (!KEY) { console.error('Set KIE_API_KEY in env or .env'); process.exit(1); }

const HEADERS = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const STYLE = [
  'premium product photography',
  'on a deep warm near-black studio stage',
  'soft golden rim lighting from upper left',
  'subtle gold ambient atmosphere',
  'minimal cinematic composition, editorial catalog quality',
  'photorealistic, shallow depth of field, high detail',
  'no text, no watermark',
].join(', ');

const PRODUCTS = [
  {
    out: 'images/generated/hero-watch.png',
    prompt: `Grade 5 titanium smartwatch with sapphire crystal AMOLED display on its face, 42mm slim case, shown at a 3/4 hero angle floating, subtle gold reflections on the case edge, ${STYLE}`,
  },
  {
    out: 'images/generated/card-watch.png',
    prompt: `Grade 5 titanium smartwatch shown from a profile angle revealing the slim 9.8mm case thickness, elegant minimal strap, matte brushed finish, ${STYLE}`,
  },
  {
    out: 'images/generated/card-vision.png',
    prompt: `Ultra-thin modern AR smart glasses with a slim titanium frame in matte black, minimalist futuristic design, shown at a 3/4 angle floating, subtle gold glint on the temple arms, ${STYLE}`,
  },
  {
    out: 'images/generated/card-hub.png',
    prompt: `A minimalist cylindrical smart home speaker with a machined aluminum body, fabric-covered acoustic mesh, a single soft gold light ring glowing at the top, ${STYLE}`,
  },
  {
    out: 'images/generated/card-buds.png',
    prompt: `Two premium wireless earbuds floating next to a small polished matte black charging case, the case lid slightly open revealing the buds, stem-style design, ${STYLE}`,
  },
  {
    out: 'images/generated/card-ring.png',
    prompt: `A premium Grade 5 titanium smart ring with a subtle inner LED sensor glow, smooth brushed finish, shown at a 3/4 hero angle floating, ${STYLE}`,
  },
];

async function submit(prompt) {
  const r = await fetch('https://api.kie.ai/api/v1/playground/createTask', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      model: 'google/nano-banana',
      input: { prompt, image_size: '16:9', output_format: 'png' },
    }),
  });
  const j = await r.json();
  if (!j.data?.taskId) throw new Error(`submit: ${JSON.stringify(j)}`);
  return j.data.taskId;
}

async function poll(taskId, maxSeconds = 240) {
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    const r = await fetch(
      `https://api.kie.ai/api/v1/playground/recordInfo?taskId=${taskId}`,
      { headers: HEADERS }
    );
    const j = await r.json();
    if (j.data?.state === 'success') {
      return JSON.parse(j.data.resultJson).resultUrls[0];
    }
    if (j.data?.state === 'fail') {
      throw new Error(`failed: ${j.data.failMsg || 'unknown'}`);
    }
    await new Promise(res => setTimeout(res, 5_000));
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
    const size = fs.statSync(p.out).size;
    console.log(`[${tag}] saved ${(size / 1024).toFixed(0)}KB`);
    return true;
  } catch (e) {
    console.error(`[${tag}] ERROR: ${e.message}`);
    return false;
  }
}

const started = Date.now();
const results = await Promise.all(PRODUCTS.map(generate));
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${PRODUCTS.length} succeeded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(ok === PRODUCTS.length ? 0 : 1);
