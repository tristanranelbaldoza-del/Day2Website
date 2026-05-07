"""
gmail_sender.py — send the finished report via Gmail API
─────────────────────────────────────────────────────────
Uses the gmail.send scope (can't read inbox, can only send).
Sends from whichever Gmail account authenticated the token.
"""

from __future__ import annotations

import base64
from email.message import EmailMessage


def send_report(gmail, recipients: list[str], data: dict,
                sheet_url: str, slides_url: str, subject: str | None = None) -> str:
    """Build a clean HTML + plaintext email and send it. Returns message id."""
    subject = subject or f"YouTube Analyst — {data['channel']['title']} · {data['window']['end']}"
    msg = EmailMessage()
    msg["To"]      = ", ".join(recipients)
    msg["Subject"] = subject

    # Plain-text first (for clients without HTML)
    msg.set_content(_render_text(data, sheet_url, slides_url))
    # HTML alternative
    msg.add_alternative(_render_html(data, sheet_url, slides_url), subtype="html")

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    sent = gmail.users().messages().send(
        userId="me",
        body={"raw": raw},
    ).execute()
    return sent.get("id", "?")


# ── Templates ──────────────────────────────────────────────────────
def _render_text(data, sheet_url, slides_url) -> str:
    t  = data["totals"]
    w  = data["window"]
    tv = data.get("top_video")
    lines = [
        f"YouTube Analyst — Weekly Report",
        f"{data['channel']['title']}  ·  {w['start']} → {w['end']}",
        "",
        f"Subscribers: {t['subscribers']:,}",
        f"Lifetime views: {t['views']:,}",
        f"Total videos: {t['videos']:,}",
        f"Videos in window: {len(data['recent_videos'])}",
        "",
    ]
    if tv:
        lines += [
            "Top video this week:",
            f"  {tv['title']}",
            f"  {tv['views']:,} views · {tv['likes']:,} likes · {tv['comments']:,} comments",
            f"  {tv['url']}",
            "",
        ]
    lines += [
        f"Full data: {sheet_url}",
        f"Slides deck: {slides_url}",
    ]
    return "\n".join(lines)


def _render_html(data, sheet_url, slides_url) -> str:
    t  = data["totals"]
    w  = data["window"]
    tv = data.get("top_video")
    top_html = ""
    if tv:
        top_html = f"""
          <tr><td style="padding:22px 0 6px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#a1a1a1;font-weight:700;">Top video this week</td></tr>
          <tr><td style="padding:10px 14px;background:#161616;border-left:3px solid #ff0033;border-radius:0 8px 8px 0;">
            <div style="font-weight:600;font-size:15px;color:#ffffff;line-height:1.35;">{_esc(tv['title'])}</div>
            <div style="margin-top:6px;font-size:12.5px;color:#a1a1a1;">
              <strong style="color:#ff3355;">{tv['views']:,}</strong> views ·
              {tv['likes']:,} likes ·
              {tv['comments']:,} comments
            </div>
            <div style="margin-top:8px;"><a href="{tv['url']}" style="color:#ff3355;font-size:12px;">Watch →</a></div>
          </td></tr>
        """

    return f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f0f10;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#e9e9e9;line-height:1.6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#151516;border:1px solid #2a2a2b;border-radius:14px;overflow:hidden;">
      <tr><td style="background:linear-gradient(135deg,#ff0033,#ff3355 60%,#c2185b);height:4px;"></td></tr>
      <tr><td style="padding:30px 30px 6px;">
        <div style="display:inline-block;font-size:10.5px;letter-spacing:0.22em;font-weight:700;text-transform:uppercase;color:#ff3355;padding:4px 10px;border:1px solid rgba(255,51,85,0.4);border-radius:999px;background:rgba(255,51,85,0.07);">YouTube Analyst</div>
        <h1 style="margin:14px 0 2px;font-size:24px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;">{_esc(data['channel']['title'])}</h1>
        <p style="margin:4px 0 0;font-size:13.5px;color:#a1a1a1;">Weekly report · {_esc(w['start'])} → {_esc(w['end'])}</p>
      </td></tr>

      <tr><td style="padding:18px 30px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:14px;background:#0f0f10;border:1px solid #2a2a2b;border-radius:10px;width:33%;vertical-align:top;">
              <div style="font-size:10.5px;letter-spacing:0.18em;color:#a1a1a1;text-transform:uppercase;font-weight:700;">Subscribers</div>
              <div style="margin-top:6px;font-size:22px;font-weight:700;color:#ffffff;">{t['subscribers']:,}</div>
            </td>
            <td style="width:10px;"></td>
            <td style="padding:14px;background:#0f0f10;border:1px solid #2a2a2b;border-radius:10px;width:33%;vertical-align:top;">
              <div style="font-size:10.5px;letter-spacing:0.18em;color:#a1a1a1;text-transform:uppercase;font-weight:700;">Lifetime views</div>
              <div style="margin-top:6px;font-size:22px;font-weight:700;color:#ffffff;">{t['views']:,}</div>
            </td>
            <td style="width:10px;"></td>
            <td style="padding:14px;background:#0f0f10;border:1px solid #2a2a2b;border-radius:10px;width:33%;vertical-align:top;">
              <div style="font-size:10.5px;letter-spacing:0.18em;color:#a1a1a1;text-transform:uppercase;font-weight:700;">Videos</div>
              <div style="margin-top:6px;font-size:22px;font-weight:700;color:#ffffff;">{t['videos']:,}</div>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:13px;color:#a1a1a1;">{len(data['recent_videos'])} video(s) published in the last {w['days']} day(s).</p>
      </td></tr>

      {top_html}

      <tr><td style="padding:22px 30px 28px;">
        <a href="{_esc(slides_url)}" style="display:inline-block;padding:12px 20px;background:linear-gradient(135deg,#ff0033,#ff3355);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:13px;letter-spacing:0.02em;">Open Slides deck ↗</a>
        <a href="{_esc(sheet_url)}"  style="display:inline-block;margin-left:8px;padding:12px 20px;background:transparent;color:#ff3355;text-decoration:none;border:1px solid rgba(255,51,85,0.4);border-radius:8px;font-weight:600;font-size:13px;">Full metrics Sheet ↗</a>
      </td></tr>

      <tr><td style="padding:14px 30px 24px;border-top:1px solid #2a2a2b;font-size:11px;color:#777;">
        YouTube Analyst · automated weekly report
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def _esc(s: str) -> str:
    return (str(s)
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#039;"))
