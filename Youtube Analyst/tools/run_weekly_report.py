"""
run_weekly_report.py — YouTube Analyst orchestrator
───────────────────────────────────────────────────
Top-level workflow:

    1. Authenticate against Google (browser consent on first run).
    2. Pull last-week metrics from YouTube Data API.
    3. Append a dated tab to the Google Sheet.
    4. Build a Google Slides report.
    5. Email the summary (with links) via Gmail.

Run one-shot:
    python3 tools/run_weekly_report.py

Dry run (skip slides + gmail; still fetches + writes to sheet if configured):
    python3 tools/run_weekly_report.py --dry-run

Schedule weekly via cron (Sunday 7 AM local time):
    0 7 * * 0  cd "/Users/admin/W1D2/Youtube Analyst" && /usr/bin/python3 tools/run_weekly_report.py >> /tmp/yt-analyst.log 2>&1
"""

from __future__ import annotations

import os
import sys
import json
from pathlib import Path

# Make ./tools importable whether invoked as a module or directly.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from dotenv import load_dotenv

from tools.auth            import build_services
from tools.youtube_client  import gather_report
from tools.sheets_writer   import write_weekly_tab
from tools.slides_builder  import build_report as build_slides
from tools.gmail_sender    import send_report


def log(msg: str) -> None:
    print(f"[weekly-report] {msg}", flush=True)


def main() -> int:
    load_dotenv(HERE.parent / ".env")

    channel_id  = os.environ.get("YOUTUBE_CHANNEL_ID")
    days        = int(os.environ.get("REPORT_WINDOW_DAYS", "7"))
    sheet_id    = os.environ.get("GOOGLE_SHEET_ID") or None
    template_id = os.environ.get("GOOGLE_SLIDES_TEMPLATE_ID") or None
    recipients  = [r.strip() for r in os.environ.get("REPORT_RECIPIENTS", "").split(",") if r.strip()]
    subject     = os.environ.get("REPORT_SUBJECT") or None
    dry         = "--dry-run" in sys.argv

    if not channel_id:
        log("✗ YOUTUBE_CHANNEL_ID is not set in .env")
        return 1
    if not recipients and not dry:
        log("✗ REPORT_RECIPIENTS is empty — set at least one email address")
        return 1

    # 1. Auth + services
    log("Authenticating…")
    services = build_services()
    log("✓ authenticated")

    # 2. YouTube data
    log(f"Fetching YouTube metrics for {channel_id} (last {days} days)…")
    data = gather_report(services["youtube"], channel_id, days=days)
    log(f"✓ channel: {data['channel']['title']} — "
        f"{data['totals']['subscribers']:,} subs, "
        f"{len(data['recent_videos'])} video(s) in window")

    if dry:
        log("DRY RUN — dumping report data, skipping Sheets / Slides / Gmail")
        print(json.dumps(data, indent=2))
        return 0

    # 3. Sheets
    if sheet_id:
        log("Writing weekly tab to Google Sheet…")
        sheet_url = write_weekly_tab(services["sheets"], sheet_id, data)
        log(f"✓ sheet updated: {sheet_url}")
    else:
        log("! GOOGLE_SHEET_ID not set — skipping Sheets step")
        sheet_url = ""

    # 4. Slides
    log("Building Google Slides report…")
    slides_url = build_slides(services["slides"], services["drive"], data, template_id=template_id)
    log(f"✓ deck ready: {slides_url}")

    # 5. Gmail
    log(f"Emailing report to {len(recipients)} recipient(s)…")
    message_id = send_report(
        services["gmail"],
        recipients,
        data,
        sheet_url=sheet_url,
        slides_url=slides_url,
        subject=subject,
    )
    log(f"✓ email sent (message id: {message_id})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
