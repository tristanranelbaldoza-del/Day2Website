import 'dotenv/config';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// Also load Youtube Analyst/.env so YOUTUBE_API_KEY etc. are available.
// Existing env vars (from root .env or shell) take precedence.
dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), 'Youtube Analyst', '.env'),
  override: false,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const {
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_SHEET_ID,
  GOOGLE_SHEET_TAB = 'Contacts',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  RESEND_API_KEY,
  // Sandbox sender — works without domain verification, but only delivers
  // to the email you signed up to Resend with. Swap for hello@yourdomain.com
  // once you have a verified Resend domain.
  SENDER_EMAIL_ADDRESS = 'onboarding@resend.dev',
  // Where replies should land. Safe to be any email you own — it's just
  // the Reply-To header, not enforced by Resend like the From address.
  REPLY_TO_EMAIL_ADDRESSES,
  // Shared secret for the admin dashboard. If not set, /api/admin/* is
  // disabled so nothing is accidentally exposed.
  ADMIN_PASSWORD,
  // Google Apps Script Web App URL. Every submission is POSTed here as
  // JSON in parallel with the Supabase insert, so Sheets mirrors Supabase.
  SHEETS_WEBHOOK_URL,
  // Kie.ai key — server-side only (never exposed to the browser)
  // for the moodboard.html image generator.
  KIE_API_KEY,
} = process.env;

const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const SHEETS_CONFIGURED   = Boolean(GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY && GOOGLE_SHEET_ID);
const RESEND_CONFIGURED   = Boolean(RESEND_API_KEY);
const WEBHOOK_CONFIGURED  = Boolean(SHEETS_WEBHOOK_URL);
const FALLBACK_LOG = path.join(__dirname, 'contact-submissions.log.jsonl');

// ─────────────────────────────────────────────────────────────
// Google Sheets client (lazy — built on first submission)
// ─────────────────────────────────────────────────────────────
let _sheets;
function getSheetsClient() {
  if (_sheets) return _sheets;
  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

async function appendToSheet({ timestamp, name, email, message }) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${GOOGLE_SHEET_TAB}!A:D`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[timestamp, name, email, message]] },
  });
}

// ─────────────────────────────────────────────────────────────
// Supabase client (lazy, same pattern as the Sheets client)
// ─────────────────────────────────────────────────────────────
let _supabase;
function getSupabase() {
  if (_supabase) return _supabase;
  _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
}

async function insertIntoSupabase({ name, email, message, newsletter = false }) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('contact_submissions')
    .insert({ name, email, message, newsletter })
    .select('id, created_at')
    .single();
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return data;
}

async function markEmailSent(rowId, resendMessageId) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('contact_submissions')
    .update({ email_sent_at: new Date().toISOString(), resend_message_id: resendMessageId })
    .eq('id', rowId);
  if (error) throw new Error(`Mark-sent update failed: ${error.message}`);
}

function appendToLocalLog(entry) {
  fs.appendFileSync(FALLBACK_LOG, JSON.stringify(entry) + '\n', 'utf8');
}

// ─────────────────────────────────────────────────────────────
// Google Apps Script webhook — parallel mirror to the "Test backend" Sheet
// ─────────────────────────────────────────────────────────────
// Posts each submission as JSON to an Apps Script /exec endpoint. The
// script reads e.postData.contents and appends a row. Fire-and-forget
// from the caller's perspective — we never block the form response on
// this.
async function postToSheetsWebhook(entry) {
  const res = await fetch(SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
    redirect: 'follow',
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`HTTP ${res.status} — ${body}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Resend — confirmation email after a successful form submission
// ─────────────────────────────────────────────────────────────
let _resend;
function getResend() {
  if (_resend) return _resend;
  _resend = new Resend(RESEND_API_KEY);
  return _resend;
}

async function sendConfirmationEmail({ name, email, message }) {
  const resend = getResend();
  const firstName = (name || '').split(/\s+/)[0] || 'there';

  const { data, error } = await resend.emails.send({
    from:    SENDER_EMAIL_ADDRESS,   // onboarding@resend.dev (sandbox)
    to:      email,                   // must match your Resend-account email while using sandbox
    ...(REPLY_TO_EMAIL_ADDRESSES && { replyTo: REPLY_TO_EMAIL_ADDRESSES }),
    subject: "Thanks — we've got your message",
    html:    renderConfirmationHtml({ firstName, message }),
    text:    renderConfirmationText({ firstName, message }),
  });

  if (error) {
    // Resend returns errors as objects; surface the message cleanly.
    throw new Error(error.message || JSON.stringify(error));
  }
  return data; // { id: "re_..." }
}

function renderConfirmationText({ firstName, message }) {
  return [
    `Hi ${firstName},`,
    ``,
    `Thanks for getting in touch with Tester.io — we've received your message`,
    `and a human on our team will reply within one business day.`,
    ``,
    `For your records, here's what you sent us:`,
    ``,
    `  ${message.trim().split('\n').join('\n  ')}`,
    ``,
    `— The Tester.io team`,
    `https://daytwowebsite.vercel.app/`,
  ].join('\n');
}

function renderConfirmationHtml({ firstName, message }) {
  // Inline styles only — most email clients strip <style> tags. Escape the
  // user's message so HTML tags they type don't render as markup.
  const safeMessage = String(message)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f5ead6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1b1305;line-height:1.6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6d8ba;border-radius:14px;overflow:hidden;">
          <tr><td style="background:linear-gradient(135deg,#f0c990,#c6a559 55%,#8b6f2e);height:4px;"></td></tr>
          <tr><td style="padding:36px 32px 12px;">
            <div style="font-weight:800;font-size:15px;letter-spacing:-0.01em;">
              Tester<span style="color:#c6a559;">.io</span>
            </div>
          </td></tr>
          <tr><td style="padding:8px 32px 32px;font-size:15.5px;">
            <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.015em;margin:16px 0 20px;color:#1b1305;">Thanks for reaching out, ${firstName}.</h1>
            <p style="margin:12px 0;">We've received your message — a real human on our team will reply within one business day.</p>
            <p style="margin:24px 0 8px;color:#7a6a4a;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;">Your message</p>
            <div style="background:#faf4e6;border-left:3px solid #c6a559;border-radius:0 8px 8px 0;padding:14px 18px;white-space:pre-wrap;color:#3a2d18;">${safeMessage}</div>
            <p style="margin:28px 0 12px;">If you want to poke around while you wait, our <a href="https://daytwowebsite.vercel.app/" style="color:#8b6f2e;font-weight:600;">main site</a> has the tour.</p>
            <p style="margin:12px 0;">— The Tester.io team</p>
          </td></tr>
          <tr><td style="padding:18px 32px 30px;border-top:1px solid #e6d8ba;font-size:12px;color:#8a7a58;">
            You're receiving this because you submitted the contact form on daytwowebsite.vercel.app.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: true, limit: '32kb' }));

// Serve all static files (index.html, thankyou.html, images, etc.)
app.use(express.static(__dirname, { extensions: ['html'] }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ─────────────────────────────────────────────────────────────
// Admin dashboard endpoints (behind ADMIN_PASSWORD)
// ─────────────────────────────────────────────────────────────
// Auth model: single shared password from .env. Dashboard stashes it
// in localStorage and sends it on every request as a Bearer token.
// Not great for a multi-user team, fine for a solo operator.

const ADMIN_CONFIGURED = Boolean(ADMIN_PASSWORD);

function requireAdmin(req, res, next) {
  if (!ADMIN_CONFIGURED) return res.status(501).json({ ok: false, error: 'Admin not configured' });
  const auth = req.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

// Login — verifies the password without ever echoing it back.
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_CONFIGURED) return res.status(501).json({ ok: false, error: 'Admin not configured' });
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Wrong password' });
  }
  res.json({ ok: true });
});

// List all contact_submissions rows (newest first). Returns everything
// the dashboard needs to render in one payload.
app.get('/api/admin/submissions', requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await getSupabase()
      .from('contact_submissions')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ ok: true, rows: data });
  } catch (err) {
    console.error('[admin] list failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Patch a single row — whitelist the columns the dashboard can change.
app.patch('/api/admin/submissions/:id', requireAdmin, async (req, res) => {
  const ALLOWED = new Set(['reply_status', 'newsletter']);
  const patch = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (ALLOWED.has(k)) patch[k] = v;
  }
  if (!Object.keys(patch).length) {
    return res.status(400).json({ ok: false, error: 'No valid fields to update' });
  }
  try {
    const { data, error } = await getSupabase()
      .from('contact_submissions')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, row: data });
  } catch (err) {
    console.error('[admin] patch failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete a row — mostly used for pruning stray test rows.
app.delete('/api/admin/submissions/:id', requireAdmin, async (req, res) => {
  try {
    const { error } = await getSupabase()
      .from('contact_submissions')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin] delete failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/contact', async (req, res) => {
  const name = String(req.body.name || '').trim();
  // Lowercase the email so "Foo@X.com" and "foo@x.com" dedupe in the DB
  // and so Resend's sandbox (which is case-sensitive) always matches.
  const email = String(req.body.email || '').trim().toLowerCase();
  const message = String(req.body.message || '').trim();
  // Accepts the checkbox in multiple shapes: "on", "true", true, 1, "1".
  const newsletter = ['on', 'true', true, 1, '1'].includes(req.body.newsletter);

  const errors = [];
  if (!name || name.length > 200) errors.push('Name is required.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) errors.push('A valid email is required.');
  if (!message || message.length > 5000) errors.push('Message is required (max 5000 chars).');

  if (errors.length) {
    if (wantsJSON(req)) return res.status(400).json({ ok: false, errors });
    return res.status(400).send(errors.join(' '));
  }

  const entry = { timestamp: new Date().toISOString(), name, email, message, newsletter };
  let saved = false;
  let supabaseRowId = null;

  // 1. Preferred destination: Supabase (the new primary store).
  if (SUPABASE_CONFIGURED) {
    try {
      const row = await insertIntoSupabase(entry);
      console.log(`[contact] Supabase row ${row.id} created (${email})`);
      supabaseRowId = row.id;
      saved = true;
    } catch (err) {
      console.error('[contact] Supabase insert failed, falling through:', err.message);
    }
  }

  // 2. Fallback #1: Google Sheets (kept for continuity if you still use it).
  if (!saved && SHEETS_CONFIGURED) {
    try {
      await appendToSheet(entry);
      console.log(`[contact] Appended to Google Sheet: ${email}`);
      saved = true;
    } catch (err) {
      console.error('[contact] Sheets write failed, falling through:', err.message);
    }
  }

  // 3. Fallback #2: local log. Last resort so we never drop a submission.
  if (!saved) {
    try {
      appendToLocalLog(entry);
      console.log(`[contact] Logged locally to ${path.basename(FALLBACK_LOG)}: ${email}`);
      saved = true;
    } catch (logErr) {
      console.error('[contact] Local log write also failed:', logErr.message);
      if (wantsJSON(req)) return res.status(500).json({ ok: false, error: 'Could not save your message. Please try again.' });
      return res.status(500).send('Could not save your message. Please try again.');
    }
  }

  // Mirror every submission into the Google Sheet via Apps Script. Fire
  // and forget — the primary store (Supabase) already has the record, so
  // a Sheets failure shouldn't block or fail the response.
  if (WEBHOOK_CONFIGURED) {
    postToSheetsWebhook(entry)
      .then(() => console.log(`[contact] Mirrored to Sheets webhook (${entry.email})`))
      .catch(err => console.error(`[contact] Sheets webhook FAILED for ${entry.email}:`, err.message));
  }

  // Fire off a confirmation email. We don't await it — the submission
  // already succeeded, and we don't want a slow/failed Resend call to
  // block the response. Errors are logged server-side only.
  if (RESEND_CONFIGURED) {
    sendConfirmationEmail(entry)
      .then(async r => {
        const resendId = r?.id ?? null;
        console.log(`[contact] Confirmation sent to ${entry.email} (resend_id=${resendId ?? '?'})`);
        if (supabaseRowId && resendId) {
          try {
            await markEmailSent(supabaseRowId, resendId);
          } catch (err) {
            console.error(`[contact] Could not stamp email_sent_at on row ${supabaseRowId}:`, err.message);
          }
        }
      })
      .catch(err => console.error(`[contact] Confirmation email FAILED for ${entry.email}:`, err.message));
  }

  // AJAX clients get JSON pointing at the thank-you page;
  // classic form-POST clients get a 303 redirect.
  if (wantsJSON(req)) {
    return res.json({ ok: true, redirect: '/thank-you.html' });
  }
  return res.redirect(303, '/thank-you.html');
});

function wantsJSON(req) {
  const accept = req.get('accept') || '';
  const ct = req.get('content-type') || '';
  return accept.includes('application/json') || ct.includes('application/json');
}

// ─────────────────────────────────────────────────────────────
// YouTube Analyst — live pipeline runner
// POST /run streams NDJSON events: {type:'log'|'stage'|'done', ...}
// ─────────────────────────────────────────────────────────────
const YT_PYTHON_CWD    = path.join(__dirname, 'Youtube Analyst');
const YT_PYTHON_BIN    = path.join(__dirname, 'venv', 'bin', 'python3');
const YT_PYTHON_SCRIPT = 'tools/run_weekly_report.py';
let ytRunLock = false;

const YT_API_KEY = process.env.YOUTUBE_API_KEY;

const RX_ID         = /^UC[A-Za-z0-9_-]{22}$/;
const RX_CHANNEL    = /\/channel\/(UC[A-Za-z0-9_-]{22})/;
const RX_HANDLE_BARE= /^@([A-Za-z0-9._-]{1,30})$/;
const RX_HANDLE_URL = /youtube\.com\/@([A-Za-z0-9._-]{1,30})/i;
const RX_WATCH_V    = /[?&]v=([A-Za-z0-9_-]{11})/;
const RX_YOUTU_BE   = /youtu\.be\/([A-Za-z0-9_-]{11})/i;
const RX_SHORTS     = /\/shorts\/([A-Za-z0-9_-]{11})/i;

async function ytApi(endpoint, params) {
  if (!YT_API_KEY) {
    throw new Error('YOUTUBE_API_KEY not set — cannot resolve handles or video URLs. Paste a /channel/UC… URL or raw UC… ID instead.');
  }
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('key', YT_API_KEY);
  const r = await fetch(url);
  if (!r.ok) {
    let detail = '';
    try { const j = await r.json(); detail = j?.error?.message || ''; } catch {}
    throw new Error(`YouTube API ${endpoint} ${r.status}${detail ? ': ' + detail : ''}`);
  }
  return r.json();
}

async function resolveChannelId(input) {
  if (!input) return { ok: false, error: 'Empty input.' };
  const s = String(input).trim();

  if (RX_ID.test(s)) return { ok: true, channelId: s, source: 'id' };

  let m;
  if ((m = s.match(RX_CHANNEL))) {
    return { ok: true, channelId: m[1], source: 'channel-url' };
  }

  let handle = null;
  if ((m = s.match(RX_HANDLE_BARE))) handle = m[1];
  else if ((m = s.match(RX_HANDLE_URL))) handle = m[1];
  if (handle) {
    try {
      const data = await ytApi('channels', { part: 'id,snippet', forHandle: '@' + handle });
      const item = data.items?.[0];
      if (!item) return { ok: false, error: `No channel found for @${handle}.` };
      return { ok: true, channelId: item.id, channelTitle: item.snippet?.title, source: 'handle', handle: '@' + handle };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  let videoId = null;
  if ((m = s.match(RX_WATCH_V))) videoId = m[1];
  else if ((m = s.match(RX_YOUTU_BE))) videoId = m[1];
  else if ((m = s.match(RX_SHORTS))) videoId = m[1];
  if (videoId) {
    try {
      const data = await ytApi('videos', { part: 'snippet', id: videoId });
      const item = data.items?.[0];
      if (!item) return { ok: false, error: `No video found for ID ${videoId}.` };
      return {
        ok: true,
        channelId: item.snippet.channelId,
        channelTitle: item.snippet.channelTitle,
        source: 'video',
        videoId,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return { ok: false, error: 'Unrecognized input. Paste a channel URL, @handle, video URL, or raw UC… ID.' };
}

function stageForLine(line) {
  if (/Authenticating/.test(line))              return { stage: 'fetch', status: 'running' };
  if (/Fetching YouTube metrics/.test(line))    return { stage: 'fetch', status: 'running' };
  if (/✓ channel:/.test(line))                  return { stage: 'fetch', status: 'done' };
  if (/Writing weekly tab/.test(line))          return { stage: 'write', status: 'running' };
  if (/✓ sheet updated/.test(line))             return { stage: 'write', status: 'done' };
  if (/GOOGLE_SHEET_ID not set/.test(line))     return { stage: 'write', status: 'skipped' };
  if (/Building Google Slides/.test(line))      return { stage: 'build', status: 'running' };
  if (/✓ deck ready/.test(line))                return { stage: 'build', status: 'done' };
  if (/Emailing report/.test(line))             return { stage: 'send', status: 'running' };
  if (/✓ email sent/.test(line))                return { stage: 'send', status: 'done' };
  return null;
}

app.get('/api/resolve-channel', async (req, res) => {
  const input = req.query.input;
  if (!input || typeof input !== 'string') {
    return res.status(400).json({ ok: false, error: 'Missing input.' });
  }
  const result = await resolveChannelId(input);
  res.json(result);
});

app.post('/run', async (req, res) => {
  if (ytRunLock) {
    return res.status(409).json({ error: 'A run is already in progress.' });
  }

  const resolved = await resolveChannelId(req.body && req.body.channel);
  if (!resolved.ok) {
    return res.status(400).json({ error: resolved.error });
  }
  const channelId = resolved.channelId;

  ytRunLock = true;

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
    'Connection': 'keep-alive',
  });

  const emit = (obj) => res.write(JSON.stringify(obj) + '\n');
  const keywords = String((req.body && req.body.keywords) || '').slice(0, 500);

  emit({ type: 'log', line: `[serve] spawning python3 tools/run_weekly_report.py` });
  if (resolved.source === 'handle')        emit({ type: 'log', line: `[serve] resolved ${resolved.handle} → ${channelId}${resolved.channelTitle ? ` (${resolved.channelTitle})` : ''}` });
  else if (resolved.source === 'video')    emit({ type: 'log', line: `[serve] resolved video ${resolved.videoId} → ${channelId}${resolved.channelTitle ? ` (${resolved.channelTitle})` : ''}` });
  else if (resolved.source === 'channel-url') emit({ type: 'log', line: `[serve] extracted channel ID from URL → ${channelId}` });
  emit({ type: 'log', line: `[serve] YOUTUBE_CHANNEL_ID=${channelId}` });
  if (keywords) emit({ type: 'log', line: `[serve] REPORT_KEYWORDS="${keywords}" (captured; not filtered in this build)` });
  emit({ type: 'stage', stage: 'fetch', status: 'running' });

  const env = {
    ...process.env,
    YOUTUBE_CHANNEL_ID: channelId,
    REPORT_KEYWORDS: keywords,
    PYTHONUNBUFFERED: '1',
  };

  let child;
  try {
    child = spawn(YT_PYTHON_BIN, [YT_PYTHON_SCRIPT], { cwd: YT_PYTHON_CWD, env });
  } catch (err) {
    emit({ type: 'log', line: `[serve] spawn failed: ${err.message}` });
    emit({ type: 'stage', stage: 'fetch', status: 'failed' });
    emit({ type: 'done', exitCode: -1 });
    ytRunLock = false;
    res.end();
    return;
  }

  let currentStage = 'fetch';
  let failureEmitted = false;

  const emitFailure = () => {
    if (failureEmitted) return;
    failureEmitted = true;
    emit({ type: 'stage', stage: currentStage, status: 'failed' });
  };

  const handleLine = (line) => {
    emit({ type: 'log', line });
    const match = stageForLine(line);
    if (match) {
      if (match.status === 'running') currentStage = match.stage;
      emit({ type: 'stage', stage: match.stage, status: match.status });
    }
    if (/\[weekly-report\] ✗/.test(line)) {
      emitFailure();
    }
  };

  let stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (line.length) handleLine(line);
    }
  });

  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString('utf8');
    let idx;
    while ((idx = stderrBuf.indexOf('\n')) !== -1) {
      const line = stderrBuf.slice(0, idx);
      stderrBuf = stderrBuf.slice(idx + 1);
      if (line.length) emit({ type: 'log', line: `[stderr] ${line}` });
    }
  });

  child.on('error', (err) => {
    emit({ type: 'log', line: `[serve] child error: ${err.message}` });
    emitFailure();
    emit({ type: 'done', exitCode: -1 });
    ytRunLock = false;
    res.end();
  });

  child.on('close', (code, signal) => {
    if (stdoutBuf.length) handleLine(stdoutBuf);
    if (stderrBuf.length) emit({ type: 'log', line: `[stderr] ${stderrBuf}` });
    if (code !== 0) emitFailure();
    emit({ type: 'done', exitCode: code, signal });
    ytRunLock = false;
    res.end();
  });

  let clientGone = false;
  res.on('close', () => {
    if (!clientGone && child && !child.killed && child.exitCode === null) {
      clientGone = true;
      console.log('[/run] client disconnected, killing child');
      child.kill('SIGTERM');
    }
  });
});

// ─────────────────────────────────────────────────────────────
// moodboard.html image generator — proxies Kie.ai's nano-banana
// playground so KIE_API_KEY never leaves the server.
// ─────────────────────────────────────────────────────────────
const KIE_BASE       = 'https://api.kie.ai/api/v1/playground';
const KIE_POLL_MS    = 4_000;
const KIE_MAX_WAIT_S = 180;

async function kieGenerateImage(prompt) {
  if (!KIE_API_KEY) throw new Error('KIE_API_KEY is not set on the server.');
  const headers = { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' };

  const submit = await fetch(`${KIE_BASE}/createTask`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({
      model: 'google/nano-banana',
      input: { prompt, image_size: '3:4', output_format: 'png' },
    }),
  });
  const submitJson = await submit.json().catch(() => ({}));
  const taskId = submitJson?.data?.taskId;
  if (!taskId) throw new Error(submitJson?.msg || `Kie.ai createTask failed (HTTP ${submit.status}).`);

  const deadline = Date.now() + KIE_MAX_WAIT_S * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, KIE_POLL_MS));
    const poll = await fetch(`${KIE_BASE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers });
    const pollJson = await poll.json().catch(() => ({}));
    const state = pollJson?.data?.state;
    if (state === 'success') {
      try {
        const urls = JSON.parse(pollJson.data.resultJson || '{}').resultUrls;
        if (Array.isArray(urls) && urls[0]) return urls[0];
      } catch (e) {
        throw new Error(`Could not parse Kie.ai result: ${e.message}`);
      }
      throw new Error('Kie.ai returned no result URL.');
    }
    if (state === 'fail') {
      throw new Error(pollJson?.data?.failMsg || 'Kie.ai reported render failure.');
    }
    // any other state = still working; loop
  }
  throw new Error(`Render timed out after ${KIE_MAX_WAIT_S}s.`);
}

// One-shot loader for the moodboard: returns a pre-rendered concept set
// from .frontend-seed.json (created by tools or scripts that drive
// /api/generate-image server-side). moodboard.html fetches this on first
// load if the local archive is empty, so a curated set can land in the
// browser without manual paste.
app.get('/api/frontend-seed', (_req, res) => {
  const p = path.join(__dirname, '.frontend-seed.json');
  fs.stat(p, (err) => {
    if (err) return res.status(404).json({ error: 'No seed set available.' });
    res.sendFile(p, { dotfiles: 'allow' });
  });
});

app.post('/api/generate-image', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Missing "prompt" in body.' });
  if (prompt.length > 5_000) return res.status(400).json({ error: 'Prompt too long (max 5000 chars).' });

  try {
    const imageUrl = await kieGenerateImage(prompt);
    res.json({ imageUrl });
  } catch (err) {
    console.error('[generate-image]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Video analyzer — single-shot summary of one YouTube video.
// Spawns tools/video_analyzer.py which fetches the captions and
// asks Groq for a structured summary + key moments + highlights.
// ─────────────────────────────────────────────────────────────
app.post('/api/analyze-video', (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Missing "url" in body.' });
  if (url.length > 500) return res.status(400).json({ error: 'URL too long.' });

  const child = spawn(YT_PYTHON_BIN, ['tools/video_analyzer.py', url], {
    cwd: YT_PYTHON_CWD,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d.toString('utf8'); });
  child.stderr.on('data', d => { stderr += d.toString('utf8'); });

  child.on('close', (code) => {
    if (code === 0) {
      try {
        return res.json(JSON.parse(stdout));
      } catch {
        return res.status(500).json({ error: 'Analyzer returned non-JSON output.', raw: stdout.slice(0, 500) });
      }
    }
    // Try to surface a clean error from the script's JSON-on-stderr convention.
    let msg = stderr.trim();
    try { const parsed = JSON.parse(msg); if (parsed?.error) msg = parsed.error; } catch {}
    res.status(400).json({ error: msg || `Analyzer exited with code ${code}.` });
  });

  child.on('error', (err) => {
    res.status(500).json({ error: `Could not spawn analyzer: ${err.message}` });
  });

  res.on('close', () => {
    if (!child.killed && child.exitCode === null) child.kill('SIGTERM');
  });
});

// ─────────────────────────────────────────────────────────────
// Trend Finder proxy routes
// ─────────────────────────────────────────────────────────────
// The frontend served on port 3000 can hit these instead of calling
// the Flask service on :5050 directly — keeps everything same-origin
// and dodges CORS / mixed-port issues entirely. If the Flask service
// is down, each route surfaces a clean 502 instead of a fetch error.
const TREND_FINDER_BASE = 'http://localhost:5050';

app.get('/api/trending', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q parameter is required' });
  if (q.length > 200) return res.status(400).json({ error: 'q too long (max 200 chars)' });
  try {
    const upstream = await fetch(
      `${TREND_FINDER_BASE}/api/trending?q=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    const body = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(body);
  } catch (err) {
    return res.status(502).json({
      error: 'Trend Finder API (port 5050) is not reachable. Start it with `cd trend-finder && python server.py`.',
      detail: err.message,
    });
  }
});

app.get('/api/extract', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url parameter is required' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must be http(s)' });
  if (url.length > 1000) return res.status(400).json({ error: 'url too long' });
  try {
    const upstream = await fetch(
      `${TREND_FINDER_BASE}/api/extract?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(90_000) },        // Gemini calls can take up to ~60s
    );
    const body = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(body);
  } catch (err) {
    return res.status(502).json({
      error: 'Trend Finder API (port 5050) is not reachable. Start it with `cd trend-finder && python server.py`.',
      detail: err.message,
    });
  }
});

// Image proxy — lets the frontend display thumbnails from Reddit / news
// sites that block hot-linking via Referer or that serve images over plain
// HTTP. The browser asks our server for the image; we fetch it and stream
// the bytes back with the original Content-Type.
app.get('/api/proxy-image', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) return res.status(400).send('url parameter is required');
  if (!/^https?:\/\//i.test(url)) return res.status(400).send('url must be http(s)');
  if (url.length > 2000) return res.status(400).send('url too long');
  try {
    const upstream = await fetch(url, {
      // Some image CDNs (Reddit's preview.redd.it most notably) require the
      // Referer/User-Agent of an actual browser, otherwise they 403 us.
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept':     'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });
    if (!upstream.ok) return res.status(upstream.status).send(`upstream ${upstream.status}`);

    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!ct.startsWith('image/')) return res.status(415).send('upstream is not an image');

    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');         // cache for a day
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    // Stream the body straight through to the browser — no buffering.
    if (upstream.body && typeof upstream.body.pipe === 'function') {
      upstream.body.pipe(res);
    } else if (upstream.body) {
      // Node 18+ ReadableStream → pipe via the web-stream interop
      const { Readable } = await import('node:stream');
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    }
  } catch (err) {
    res.status(502).send(`proxy fetch failed: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Tester.io site running at http://localhost:${PORT}`);

  if (SUPABASE_CONFIGURED) {
    console.log(`→ Primary store: Supabase (${SUPABASE_URL})`);
  } else {
    console.log('→ Supabase not configured. Add SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to .env.');
  }

  if (SHEETS_CONFIGURED) {
    console.log(`→ Fallback: Google Sheet ${GOOGLE_SHEET_ID} (tab ${GOOGLE_SHEET_TAB})`);
  }

  console.log(`→ Final fallback: ${path.basename(FALLBACK_LOG)} (local log)`);

  if (RESEND_CONFIGURED) {
    console.log(`→ Confirmation emails: via ${SENDER_EMAIL_ADDRESS} (Resend)`);
    if (SENDER_EMAIL_ADDRESS.endsWith('@resend.dev')) {
      console.log(`  ⚠ Sandbox mode — Resend will ONLY deliver to your account email.`);
    }
  } else {
    console.log('→ Confirmation emails: OFF (set RESEND_API_KEY in .env to enable)');
  }

  if (ADMIN_CONFIGURED) {
    console.log(`→ Admin dashboard: http://localhost:${PORT}/dashboard.html (ADMIN_PASSWORD set)`);
  } else {
    console.log('→ Admin dashboard: OFF (set ADMIN_PASSWORD in .env to enable)');
  }

  if (WEBHOOK_CONFIGURED) {
    console.log(`→ Sheets mirror: ${SHEETS_WEBHOOK_URL.replace(/\/[^\/]+\/exec$/, '/.../exec')}`);
  } else {
    console.log('→ Sheets mirror: OFF (set SHEETS_WEBHOOK_URL in .env to enable)');
  }
});
