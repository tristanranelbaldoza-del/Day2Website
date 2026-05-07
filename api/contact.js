import {
  SUPABASE_CONFIGURED, SHEETS_CONFIGURED, RESEND_CONFIGURED, WEBHOOK_CONFIGURED,
  insertIntoSupabase, appendToSheet, postToSheetsWebhook,
  sendConfirmationEmail, markEmailSent,
} from './_lib/contact-pipeline.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Vercel parses JSON bodies automatically when Content-Type is application/json.
  const body = req.body || {};
  const name       = String(body.name    || '').trim();
  const email      = String(body.email   || '').trim().toLowerCase();
  const message    = String(body.message || '').trim();
  const newsletter = ['on','true',true,1,'1'].includes(body.newsletter);

  const errors = [];
  if (!name || name.length > 200) errors.push('Name is required.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) errors.push('A valid email is required.');
  if (!message || message.length > 5000) errors.push('Message is required (max 5000 chars).');
  if (errors.length) return res.status(400).json({ ok: false, errors });

  const entry = { timestamp: new Date().toISOString(), name, email, message, newsletter };
  let saved = false;
  let supabaseRowId = null;

  if (SUPABASE_CONFIGURED) {
    try {
      const row = await insertIntoSupabase(entry);
      supabaseRowId = row.id;
      saved = true;
      console.log(`[contact] Supabase row ${row.id} created (${email})`);
    } catch (err) {
      console.error('[contact] Supabase failed:', err.message);
    }
  }

  if (!saved && SHEETS_CONFIGURED) {
    try {
      await appendToSheet(entry);
      saved = true;
      console.log(`[contact] Sheet append OK (${email})`);
    } catch (err) {
      console.error('[contact] Sheets failed:', err.message);
    }
  }

  if (!saved) {
    // No persistent disk on Vercel — fail loudly instead of silently dropping.
    return res.status(500).json({ ok: false, error: 'Could not save your message. Please try again.' });
  }

  // Fire-and-forget mirrors. They run in the background; we still respond fast.
  // Vercel needs us to await the chain or wrap with `waitUntil` to keep the
  // function alive — using awaits here is simpler and contact volume is low.
  const sideTasks = [];
  if (WEBHOOK_CONFIGURED) {
    sideTasks.push(
      postToSheetsWebhook(entry)
        .then(() => console.log(`[contact] Webhook OK (${email})`))
        .catch(err => console.error('[contact] Webhook failed:', err.message))
    );
  }
  if (RESEND_CONFIGURED) {
    sideTasks.push(
      sendConfirmationEmail(entry)
        .then(async r => {
          const id = r?.id ?? null;
          console.log(`[contact] Resend sent (${email}) id=${id}`);
          if (supabaseRowId && id) {
            try { await markEmailSent(supabaseRowId, id); } catch (e) { console.error('[contact] markEmailSent:', e.message); }
          }
        })
        .catch(err => console.error('[contact] Resend failed:', err.message))
    );
  }
  // Best-effort wait so logs/email actually fire before the function suspends.
  await Promise.allSettled(sideTasks);

  return res.status(200).json({ ok: true, redirect: '/thank-you.html' });
}
