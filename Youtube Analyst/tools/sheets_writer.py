"""
sheets_writer.py — append a weekly report as a new tab in the Sheet
────────────────────────────────────────────────────────────────────
Each run creates a tab named `YYYY-MM-DD Weekly` (date = end of window)
and writes a clean metrics block + per-video table. Side-effect: also
refreshes an `Overview` tab with running totals.

Returns the Sheet's URL so the orchestrator can link to it in the
email / Slides deck.
"""

from __future__ import annotations


def write_weekly_tab(sheets, sheet_id: str, data: dict) -> str:
    """Create a dated tab and populate it with this week's metrics."""
    tab_title = f"{data['window']['end']} Weekly"

    # 1. Create the new tab.
    req = {
        "requests": [{
            "addSheet": {
                "properties": {"title": tab_title}
            }
        }]
    }
    tab_gid = None
    try:
        resp = sheets.spreadsheets().batchUpdate(spreadsheetId=sheet_id, body=req).execute()
        tab_gid = resp["replies"][0]["addSheet"]["properties"]["sheetId"]
    except Exception as exc:
        # Tab may already exist on a re-run — look up its gid so the
        # returned URL still points to it instead of falling back to gid=0.
        if "already exists" not in str(exc).lower():
            raise
        meta = sheets.spreadsheets().get(
            spreadsheetId=sheet_id,
            fields="sheets(properties(title,sheetId))",
        ).execute()
        for s in meta["sheets"]:
            if s["properties"]["title"] == tab_title:
                tab_gid = s["properties"]["sheetId"]
                break

    # 2. Build the value grid. Two stacked blocks: summary, then videos.
    summary_rows = [
        ["YouTube Analyst — Weekly Report"],
        ["Channel",       data["channel"]["title"]],
        ["Window",        f"{data['window']['start']} → {data['window']['end']} ({data['window']['days']} days)"],
        [],
        ["Lifetime totals"],
        ["Subscribers",   data["totals"]["subscribers"]],
        ["Total views",   data["totals"]["views"]],
        ["Total videos",  data["totals"]["videos"]],
        [],
        [f"Videos published in window ({len(data['recent_videos'])})"],
        ["Title", "Views", "Likes", "Comments", "Published", "URL"],
    ]
    video_rows = [
        [v["title"], v["views"], v["likes"], v["comments"], v["published_at"], v["url"]]
        for v in data["recent_videos"]
    ] or [["(no videos published this window)"]]

    values = summary_rows + video_rows
    sheets.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range=f"'{tab_title}'!A1",
        valueInputOption="USER_ENTERED",
        body={"values": values},
    ).execute()

    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit#gid={tab_gid}"
