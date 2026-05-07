"""
youtube_client.py — pulls weekly metrics from YouTube Data API v3
─────────────────────────────────────────────────────────────────
Returns a plain dict the rest of the pipeline consumes:

    {
        "channel":     { "id": "...", "title": "...", "url": "..." },
        "totals":      { "subscribers": int, "views": int, "videos": int },
        "window":      { "days": 7, "start": "2026-04-18", "end": "2026-04-25" },
        "recent_videos": [
            { "id": "...", "title": "...", "published_at": "...",
              "views": int, "likes": int, "comments": int },
            ...
        ],
        "top_video":   <one entry from recent_videos or None>,
    }
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


def fetch_channel_stats(youtube, channel_id: str) -> dict:
    """Top-level channel totals (subs, lifetime views, video count)."""
    resp = youtube.channels().list(
        id=channel_id,
        part="snippet,statistics",
    ).execute()

    items = resp.get("items") or []
    if not items:
        raise ValueError(f"Channel not found: {channel_id}")

    ch    = items[0]
    stats = ch["statistics"]
    snip  = ch["snippet"]

    return {
        "channel": {
            "id":    channel_id,
            "title": snip["title"],
            "url":   f"https://www.youtube.com/channel/{channel_id}",
        },
        "totals": {
            "subscribers": int(stats.get("subscriberCount", 0)),
            "views":       int(stats.get("viewCount", 0)),
            "videos":      int(stats.get("videoCount", 0)),
        },
    }


def fetch_recent_videos(youtube, channel_id: str, days: int = 7) -> list[dict]:
    """Videos published in the last `days` days, with per-video stats."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    # Step 1: search for video IDs in the window.
    search = youtube.search().list(
        channelId=channel_id,
        part="id",
        type="video",
        order="date",
        publishedAfter=since,
        maxResults=50,
    ).execute()
    ids = [item["id"]["videoId"] for item in search.get("items", []) if item["id"].get("videoId")]
    if not ids:
        return []

    # Step 2: batch fetch stats for all of them in one call.
    details = youtube.videos().list(
        id=",".join(ids),
        part="snippet,statistics",
    ).execute()

    videos = []
    for v in details.get("items", []):
        s = v.get("statistics", {})
        sn = v["snippet"]
        videos.append({
            "id":           v["id"],
            "title":        sn["title"],
            "published_at": sn["publishedAt"],
            "url":          f"https://www.youtube.com/watch?v={v['id']}",
            "views":        int(s.get("viewCount", 0)),
            "likes":        int(s.get("likeCount", 0)),
            "comments":     int(s.get("commentCount", 0)),
        })
    # Sort newest-first for display.
    videos.sort(key=lambda x: x["published_at"], reverse=True)
    return videos


def gather_report(youtube, channel_id: str, days: int = 7) -> dict:
    """Top-level entry point: returns the full data blob the report uses."""
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days)).date().isoformat()
    end   = now.date().isoformat()

    out = fetch_channel_stats(youtube, channel_id)
    out["window"] = {"days": days, "start": start, "end": end}
    out["recent_videos"] = fetch_recent_videos(youtube, channel_id, days)
    out["top_video"] = max(out["recent_videos"], key=lambda v: v["views"], default=None)
    return out
