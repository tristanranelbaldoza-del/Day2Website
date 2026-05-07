// Shared helpers for the contact pipeline. Mirrors server.js but trimmed for
// Vercel: no local-log fallback (no persistent disk on serverless).

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { Resend } from 'resend';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_SHEET_ID,
  GOOGLE_SHEET_TAB = 'Contacts',
  RESEND_API_KEY,
  SENDER_EMAIL_ADDRESS = 'onboarding@resend.dev',
  REPLY_TO_EMAIL_ADDRESSES,
  SHEETS_WEBHOOK_URL,
} = process.env;

export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
export const SHEETS_CONFIGURED   = Boolean(GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY && GOOGLE_SHEET_ID);
export const RESEND_CONFIGURED   = Boolean(RESEND_API_KEY);
export const WEBHOOK_CONFIGURED  = Boolean(SHEETS_WEBHOOK_URL);

let _supabase;
export function getSupabase() {
  if (_supabase) return _supabase;
  _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
}

export async function insertIntoSupabase({ name, email, message, newsletter = false }) {
  const { data, error } = await getSupabase()
    .from('contact_submissions')
    .insert({ name, email, message, newsletter })
    .select('id, created_at')
    .single();
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return data;
}

export async function markEmailSent(rowId, resendMessageId) {
  const { error } = await getSupabase()
    .from('contact_submissions')
    .update({ email_sent_at: new Date().toISOString(), resend_message_id: resendMessageId })
    .eq('id', rowId);
  if (error) throw new Error(`Mark-sent update failed: ${error.message}`);
}

let _sheets;
function getSheets() {
  if (_sheets) return _sheets;
  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

export async function appendToSheet({ timestamp, name, email, message }) {
  await getSheets().spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${GOOGLE_SHEET_TAB}!A:D`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[timestamp, name, email, message]] },
  });
}

export async function postToSheetsWebhook(entry) {
  const r = await fetch(SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
    redirect: 'follow',
  });
  if (!r.ok) {
    const body = (await r.text()).slice(0, 300);
    throw new Error(`HTTP ${r.status} — ${body}`);
  }
}

let _resend;
function getResend() {
  if (_resend) return _resend;
  _resend = new Resend(RESEND_API_KEY);
  return _resend;
}

export async function sendConfirmationEmail({ name, email, message }) {
  const firstName = (name || '').split(/\s+/)[0] || 'there';
  const safeMessage = String(message)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const text = [
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
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5ead6;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1b1305;line-height:1.6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e6d8ba;border-radius:14px;overflow:hidden;">
      <tr><td style="background:linear-gradient(135deg,#f0c990,#c6a559 55%,#8b6f2e);height:4px;"></td></tr>
      <tr><td style="padding:36px 32px 12px;font-weight:800;font-size:15px;">Tester<span style="color:#c6a559;">.io</span></td></tr>
      <tr><td style="padding:8px 32px 32px;font-size:15.5px;">
        <h1 style="font-size:22px;font-weight:700;margin:16px 0 20px;color:#1b1305;">Thanks for reaching out, ${firstName}.</h1>
        <p style="margin:12px 0;">We've received your message — a real human on our team will reply within one business day.</p>
        <p style="margin:24px 0 8px;color:#7a6a4a;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;">Your message</p>
        <div style="background:#faf4e6;border-left:3px solid #c6a559;border-radius:0 8px 8px 0;padding:14px 18px;white-space:pre-wrap;color:#3a2d18;">${safeMessage}</div>
        <p style="margin:28px 0 12px;">— The Tester.io team</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const { data, error } = await getResend().emails.send({
    from: SENDER_EMAIL_ADDRESS,
    to: email,
    ...(REPLY_TO_EMAIL_ADDRESSES && { replyTo: REPLY_TO_EMAIL_ADDRESSES }),
    subject: "Thanks — we've got your message",
    html, text,
  });
  if (error) throw new Error(error.message || JSON.stringify(error));
  return data;
}
