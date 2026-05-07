"""
auth.py — shared Google OAuth2 flow
────────────────────────────────────
Runs the browser-based consent flow on first use, caches the token
in ./token.json, and returns ready-to-use service objects for all
four APIs the report needs:
  · YouTube Data  v3
  · Sheets        v4
  · Slides        v1
  · Gmail         v1

First run: opens a browser, asks you to sign in, stores tokens.
Later runs: silent refresh from token.json, no UI.
"""

from __future__ import annotations

import os
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

PROJECT_DIR = Path(__file__).resolve().parent.parent

# All APIs this tool touches. Add/remove scopes carefully — any change
# forces a fresh consent (delete token.json to re-auth).
SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
]

CREDENTIALS_FILE = PROJECT_DIR / "credentials.json"  # from Google Cloud Console
TOKEN_FILE       = PROJECT_DIR / "token.json"        # auto-created on first run


def get_credentials() -> Credentials:
    """Load or obtain OAuth2 credentials, refreshing as needed."""
    creds: Credentials | None = None

    # 1. Try loading an existing token.
    if TOKEN_FILE.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
        except Exception as exc:
            # Token file corrupt or scopes changed — force re-auth.
            print(f"[auth] existing token unreadable ({exc}); re-authing")
            creds = None

    # 2. If no valid creds, either refresh or kick off the browser flow.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                raise FileNotFoundError(
                    f"Missing {CREDENTIALS_FILE.name}. Download OAuth client JSON "
                    "from https://console.cloud.google.com/apis/credentials "
                    "and place it in the project root."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            # run_local_server opens the browser automatically; port=0 picks any free port.
            creds = flow.run_local_server(port=0)

        # Persist for next run — refresh tokens don't expire, so this
        # only needs to happen once per OAuth consent.
        TOKEN_FILE.write_text(creds.to_json())

    return creds


def build_services() -> dict:
    """Return a dict of authenticated API client objects."""
    creds = get_credentials()
    return {
        "youtube": build("youtube",     "v3", credentials=creds, cache_discovery=False),
        "sheets":  build("sheets",      "v4", credentials=creds, cache_discovery=False),
        "slides":  build("slides",      "v1", credentials=creds, cache_discovery=False),
        "drive":   build("drive",       "v3", credentials=creds, cache_discovery=False),
        "gmail":   build("gmail",       "v1", credentials=creds, cache_discovery=False),
    }
