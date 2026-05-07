// @ts-check
// ═══════════════════════════════════════════════════════════════════
// Playwright reporter that writes one row per test run to the
// contact_submissions table, with the reply-* columns filled in as if
// the row got a successful reply — so every "reply" column in the
// dashboard reflects test outcome at a glance.
// ═══════════════════════════════════════════════════════════════════
// Guards so the rest of the pipeline ignores the row:
//   · email     — @playwright.local (never deliverable)
//   · newsletter = false           (follow-up script skips)
//   · reply_message_id — synthetic (check-replies.mjs dedupes on it so
//                                    the Gmail poller won't overwrite)

import 'dotenv/config';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

export default class SupabaseReporter {
  constructor() {
    this.enabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
    if (!this.enabled) {
      console.log('[supabase-reporter] Disabled — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env to record runs.');
      return;
    }
    this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.records = [];       // one per test for summary rendering
    this.startedAt = Date.now();
  }

  onBegin(config, suite) {
    if (!this.enabled) return;
    this.totalTests = suite.allTests().length;
    this.projectNames = [...new Set(config.projects.map(p => p.name))];
    console.log(`[supabase-reporter] Recording run: ${this.totalTests} tests across ${this.projectNames.join(' + ')}`);
  }

  onTestEnd(test, result) {
    if (!this.enabled) return;
    this.records.push({
      title:    test.title,
      project:  projectName(test),
      status:   result.status,
      duration: result.duration,
      error:    result.error?.message || null,
    });
  }

  async onEnd(fullResult) {
    if (!this.enabled) return;

    const { sha, branch } = gitInfo();
    const counts = tally(this.records);
    const durationSec = ((fullResult.duration || (Date.now() - this.startedAt)) / 1000).toFixed(1);

    const statusLabel = counts.failed > 0 ? 'FAILED' : 'PASSED';
    const projectsStr = (this.projectNames || []).join('+') || 'unknown';
    const name = trim(`[TEST RUN] ${statusLabel} · ${projectsStr}`, 200);

    // Unique fake address per run — passes the email CHECK constraint but
    // routes nowhere. Timestamp makes it deduplicate-friendly.
    const runTag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const email = `test-run-${runTag}@playwright.local`;

    const message = trim(renderSummary({ counts, durationSec, branch, sha, records: this.records }), 5000);

    // Simulated reply — fills the same columns a real Gmail reply would.
    // The wording is the classic "if you can read this, the pipeline works":
    // a passing run writes "successful", a failing run writes "unsuccessful"
    // so you can filter by snippet/subject in Supabase.
    const replyLine = counts.failed === 0
      ? 'If this sends then the test was successful'
      : 'If this sends then the test was unsuccessful';
    const replySubject   = `Re: ${replyLine}`;
    const replyMessageId = `<test-run-${runTag}@playwright.local>`;
    const nowIso         = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('contact_submissions')
      .insert({
        name,
        email,
        message,
        newsletter:        false,
        // Outbound-email columns — synthetic values so the row looks
        // fully populated in the dashboard. No real email is sent.
        email_sent_at:     nowIso,
        resend_message_id: `test-run-${runTag}`,
        // Inbound-reply columns — also synthetic, wording reflects the
        // test outcome.
        reply_status:      'replied',
        reply_received_at: nowIso,
        reply_subject:     replySubject,
        reply_snippet:     replyLine,
        reply_message_id:  replyMessageId,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[supabase-reporter] insert failed:', error.message);
      return;
    }
    console.log(`[supabase-reporter] Recorded row ${data.id} — ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`);
  }
}

// ── helpers ────────────────────────────────────────────────────────

function projectName(test) {
  let s = test.parent;
  while (s && typeof s.project === 'function' && !s.project()) s = s.parent;
  return (s && typeof s.project === 'function' && s.project()?.name) || 'unknown';
}

function gitInfo() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return { sha, branch };
  } catch { return { sha: null, branch: null }; }
}

function tally(rows) {
  const out = { passed: 0, failed: 0, skipped: 0 };
  for (const r of rows) {
    if (r.status === 'passed') out.passed++;
    else if (r.status === 'skipped') out.skipped++;
    else out.failed++;
  }
  return out;
}

function renderSummary({ counts, durationSec, branch, sha, records }) {
  const lines = [
    `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped in ${durationSec}s`,
  ];
  if (branch || sha) lines.push(`branch=${branch ?? '?'}  sha=${sha ?? '?'}`);

  const failures = records.filter(r => r.status !== 'passed' && r.status !== 'skipped');
  if (failures.length) {
    lines.push('', 'Failures:');
    for (const f of failures) {
      lines.push(`• [${f.project}] ${f.title}`);
      if (f.error) lines.push(`    ${f.error.split('\n')[0].slice(0, 300)}`);
    }
  }
  return lines.join('\n');
}

function trim(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : s; }
