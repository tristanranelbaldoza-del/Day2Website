"""
slides_builder.py — generate a Google Slides report
────────────────────────────────────────────────────
Two paths:

1. **Template mode** (GOOGLE_SLIDES_TEMPLATE_ID set):
   Copies the template deck, then replaces `{{PLACEHOLDERS}}` in-place
   using Slides' batchUpdate replaceAllText. Fast, stable formatting.

2. **From-scratch mode** (no template):
   Creates a new presentation with a title slide + metrics slide + top
   video slide. Plainer but works out of the box.

Returns the presentation URL for use in the email.
"""

from __future__ import annotations
from datetime import datetime


def build_report(slides, drive, data: dict, template_id: str | None = None) -> str:
    if template_id:
        return _build_from_template(slides, drive, data, template_id)
    return _build_from_scratch(slides, data)


# ── Template mode ─────────────────────────────────────────────────
def _build_from_template(slides, drive, data: dict, template_id: str) -> str:
    """Copy the template deck via Drive, then replace {{PLACEHOLDERS}} in-place."""
    title = f"Weekly Report · {data['channel']['title']} · {data['window']['end']}"
    copy = drive.files().copy(
        fileId=template_id,
        body={"name": title},
        fields="id",
    ).execute()
    pres_id = copy["id"]

    tv = data.get("top_video") or {}
    if tv:
        top_title = tv["title"]
        top_stats = f"{tv['views']:,} views · {tv['likes']:,} likes · {tv['comments']:,} comments"
        top_url   = tv["url"]
    else:
        top_title = "No videos published this week"
        top_stats = ""
        top_url   = ""

    substitutions = {
        "{{CHANNEL_TITLE}}":     data["channel"]["title"],
        "{{WINDOW_RANGE}}":      f"{data['window']['start']} → {data['window']['end']}",
        "{{GENERATED_DATE}}":    datetime.now().strftime("%B %d, %Y"),
        "{{SUBSCRIBERS}}":       f"{data['totals']['subscribers']:,}",
        "{{VIEWS}}":             f"{data['totals']['views']:,}",
        "{{VIDEOS}}":            f"{data['totals']['videos']:,}",
        "{{WINDOW_VIDEOS_LINE}}": f"{len(data['recent_videos'])} video(s) published in last {data['window']['days']} day(s)",
        "{{TOP_VIDEO_TITLE}}":   top_title,
        "{{TOP_VIDEO_STATS}}":   top_stats,
        "{{TOP_VIDEO_URL}}":     top_url,
    }
    requests = [
        {"replaceAllText": {
            "containsText": {"text": placeholder, "matchCase": True},
            "replaceText": value,
        }}
        for placeholder, value in substitutions.items()
    ]
    slides.presentations().batchUpdate(
        presentationId=pres_id, body={"requests": requests},
    ).execute()
    return f"https://docs.google.com/presentation/d/{pres_id}/edit"


# ── From-scratch mode ─────────────────────────────────────────────
def _build_from_scratch(slides, data: dict) -> str:
    title = f"Weekly Report · {data['channel']['title']} · {data['window']['end']}"
    pres = slides.presentations().create(body={"title": title}).execute()
    pres_id = pres["presentationId"]

    # Replace the default blank first slide with our content.
    # We build requests in one batchUpdate call for speed.
    first_slide_id = pres["slides"][0]["objectId"]

    requests = []

    # ── Slide 1 — cover ────────────────────────────────────────────
    requests += _cover_slide(first_slide_id, data)

    # ── Slide 2 — metrics ──────────────────────────────────────────
    metrics_slide_id = "metrics_slide"
    requests.append({"createSlide": {
        "objectId": metrics_slide_id,
        "insertionIndex": 1,
        "slideLayoutReference": {"predefinedLayout": "BLANK"},
    }})
    requests += _metrics_slide(metrics_slide_id, data)

    # ── Slide 3 — top video ────────────────────────────────────────
    if data.get("top_video"):
        top_slide_id = "top_slide"
        requests.append({"createSlide": {
            "objectId": top_slide_id,
            "insertionIndex": 2,
            "slideLayoutReference": {"predefinedLayout": "BLANK"},
        }})
        requests += _top_video_slide(top_slide_id, data)

    slides.presentations().batchUpdate(
        presentationId=pres_id,
        body={"requests": requests},
    ).execute()

    return f"https://docs.google.com/presentation/d/{pres_id}/edit"


# ── Slide content builders ─────────────────────────────────────────
def _cover_slide(slide_id: str, data: dict):
    return [
        _text_box(slide_id, "cover_title",
                  f"{data['channel']['title']}",
                  x=40,  y=120, w=640, h=80,
                  font_size=36, bold=True),
        _text_box(slide_id, "cover_sub",
                  f"Weekly report · {data['window']['start']} → {data['window']['end']}",
                  x=40,  y=210, w=640, h=40,
                  font_size=16),
        _text_box(slide_id, "cover_date",
                  f"Generated {datetime.now().strftime('%B %d, %Y')}",
                  x=40,  y=380, w=640, h=30,
                  font_size=12),
    ]


def _metrics_slide(slide_id: str, data: dict):
    t = data["totals"]
    w = data["window"]["days"]
    return [
        _text_box(slide_id, "m_title", "Channel Totals",
                  x=40, y=40, w=640, h=40, font_size=28, bold=True),
        _text_box(slide_id, "m_subs",  f"{t['subscribers']:,} subscribers",
                  x=40, y=120, w=640, h=40, font_size=22),
        _text_box(slide_id, "m_views", f"{t['views']:,} lifetime views",
                  x=40, y=170, w=640, h=40, font_size=22),
        _text_box(slide_id, "m_videos", f"{t['videos']:,} videos total",
                  x=40, y=220, w=640, h=40, font_size=22),
        _text_box(slide_id, "m_window",
                  f"{len(data['recent_videos'])} video(s) published in last {w} day(s)",
                  x=40, y=320, w=640, h=40, font_size=16),
    ]


def _top_video_slide(slide_id: str, data: dict):
    tv = data["top_video"]
    return [
        _text_box(slide_id, "t_title", "Top Video This Week",
                  x=40, y=40, w=640, h=40, font_size=28, bold=True),
        _text_box(slide_id, "t_video", tv["title"],
                  x=40, y=120, w=640, h=60, font_size=20, bold=True),
        _text_box(slide_id, "t_stats",
                  f"{tv['views']:,} views · {tv['likes']:,} likes · {tv['comments']:,} comments",
                  x=40, y=200, w=640, h=30, font_size=14),
        _text_box(slide_id, "t_url", tv["url"],
                  x=40, y=260, w=640, h=30, font_size=12),
    ]


# ── Helper: emit the requests to create + fill a text box ──────────
def _text_box(slide_id, obj_id, text, x, y, w, h, font_size=14, bold=False):
    """Returns the three requests needed to create one filled text box."""
    reqs = [
        {"createShape": {
            "objectId": obj_id,
            "shapeType": "TEXT_BOX",
            "elementProperties": {
                "pageObjectId": slide_id,
                "size": {"width": {"magnitude": w, "unit": "PT"},
                         "height": {"magnitude": h, "unit": "PT"}},
                "transform": {"scaleX": 1, "scaleY": 1,
                              "translateX": x, "translateY": y,
                              "unit": "PT"},
            },
        }},
        {"insertText": {"objectId": obj_id, "text": text}},
        {"updateTextStyle": {
            "objectId": obj_id,
            "style": {"fontSize": {"magnitude": font_size, "unit": "PT"},
                      "bold": bold},
            "fields": "fontSize,bold",
        }},
    ]
    return reqs
