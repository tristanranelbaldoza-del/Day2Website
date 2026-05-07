"""
video_analyzer.py — summarize a single YouTube video
─────────────────────────────────────────────────────
Pulls the video's caption track via youtube-transcript-api (no API key,
no quota) and asks Groq to produce a structured summary.

Usage:
    python3 tools/video_analyzer.py <url-or-video-id>

Outputs a single JSON object on stdout:
    { "video_id", "transcript_minutes",
      "summary":      "2-3 sentence overview",
      "key_moments":  [{"timestamp": "MM:SS", "description": "..."}, ...],
      "highlights":   ["quotable line", ...] }

Errors go to stderr and the process exits non-zero so the calling
server can surface a clean message.
"""

from __future__ import annotations

import json
import os
import re
import sys
import warnings
from pathlib import Path

# Silence library import-time warnings so stderr is reserved for our own
# structured error JSON. (Python 3.9 + LibreSSL combo triggers urllib3's
# NotOpenSSLWarning otherwise.)
warnings.filterwarnings("ignore")

import requests
from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    TranscriptsDisabled, NoTranscriptFound, VideoUnavailable,
)

# Load .env from project root so GROQ_API_KEY is available regardless of cwd.
ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "Youtube Analyst" / ".env")  # fallback

GROQ_MODEL = "llama-3.3-70b-versatile"
GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions"

VIDEO_ID_RE = re.compile(
    r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/|youtube\.com/embed/)"
    r"([A-Za-z0-9_-]{11})"
)
BARE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_video_id(url: str) -> str:
    s = url.strip()
    if BARE_ID_RE.match(s):
        return s
    m = VIDEO_ID_RE.search(s)
    if not m:
        raise ValueError(f"Not a recognizable YouTube video URL: {url!r}")
    return m.group(1)


def fetch_transcript(video_id: str):
    api = YouTubeTranscriptApi()
    fetched = api.fetch(video_id, languages=["en"])
    # Newer versions return a FetchedTranscript wrapping FetchedTranscriptSnippet
    # objects. Older versions returned plain dicts. Normalize both.
    out = []
    for seg in fetched:
        if hasattr(seg, "text"):
            out.append({"text": seg.text, "start": seg.start, "duration": seg.duration})
        else:
            out.append({"text": seg["text"], "start": seg["start"], "duration": seg.get("duration", 0)})
    return out


def format_for_llm(transcript: list[dict]) -> str:
    lines = []
    for seg in transcript:
        m, s = divmod(int(seg["start"]), 60)
        lines.append(f"[{m:d}:{s:02d}] {seg['text']}")
    return "\n".join(lines)


SYSTEM_PROMPT = (
    "You analyze YouTube video transcripts. Return ONLY a single valid JSON "
    "object with these exact keys: summary (2-3 sentence string), "
    "key_moments (array of 3-5 objects with keys timestamp [MM:SS string] "
    "and description [string]), highlights (array of 3-5 quotable strings "
    "lifted verbatim from the transcript). No markdown fences, no commentary."
)


def summarize_with_groq(transcript_text: str) -> tuple[dict, bool]:
    """Returns (summary_json, truncated_flag)."""
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set in .env")
    # Free-tier Groq is rate-limited to 12,000 tokens/min on llama-3.3-70b.
    # Reserve ~2k tokens for the system prompt + JSON output, leaving ~10k
    # for the transcript. At ~3.5 chars/token for English captions that's
    # ~35k chars — be conservative and cap at 30k.
    max_chars = 30_000
    truncated = len(transcript_text) > max_chars
    if truncated:
        transcript_text = transcript_text[:max_chars] + "\n[transcript truncated]"

    r = requests.post(
        GROQ_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type":  "application/json",
        },
        json={
            "model": GROQ_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": f"Transcript:\n\n{transcript_text}"},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
        },
        timeout=60,
    )
    if r.status_code == 413 or (r.status_code == 429 and "tokens per minute" in r.text.lower()):
        raise RuntimeError(
            "This video is too long for the current Groq free-tier limit "
            "(12,000 tokens/min). Try a shorter video, or upgrade Groq to Dev tier."
        )
    if not r.ok:
        raise RuntimeError(f"Groq API {r.status_code}: {r.text[:300]}")
    content = r.json()["choices"][0]["message"]["content"]
    return json.loads(content), truncated


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python3 tools/video_analyzer.py <youtube-url-or-id>", file=sys.stderr)
        return 2
    raw = sys.argv[1]

    try:
        video_id = extract_video_id(raw)
    except ValueError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        return 1

    try:
        transcript = fetch_transcript(video_id)
    except TranscriptsDisabled:
        print(json.dumps({"error": "Captions are disabled on this video."}), file=sys.stderr)
        return 1
    except NoTranscriptFound:
        print(json.dumps({"error": "No English transcript available for this video."}), file=sys.stderr)
        return 1
    except VideoUnavailable:
        print(json.dumps({"error": "Video is private, deleted, or region-blocked."}), file=sys.stderr)
        return 1

    if not transcript:
        print(json.dumps({"error": "Empty transcript."}), file=sys.stderr)
        return 1

    text = format_for_llm(transcript)
    try:
        result, truncated = summarize_with_groq(text)
    except RuntimeError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        return 1
    result["video_id"] = video_id
    result["video_url"] = f"https://www.youtube.com/watch?v={video_id}"
    result["transcript_truncated"] = truncated
    result["transcript_minutes"] = round(
        sum(s.get("duration", 0) for s in transcript) / 60, 1
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
