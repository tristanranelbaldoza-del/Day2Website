# YouTube Analyst

A weekly YouTube analytics report delivered to your inbox. One `python3` command
fetches last week's channel metrics, writes them to a Google Sheet, builds a
Google Slides deck, and emails the summary via Gmail.

## What's where

```
Youtube Analyst/
├── .env                    ← your secrets (gitignored)
├── .env.example            ← template — copy to .env and fill in
├── .gitignore
├── credentials.json        ← OAuth client JSON from Google Cloud Console
├── requirements.txt        ← Python deps (install with pip)
├── serve.mjs               ← static server for the HTML page (Node, zero deps)
├── youtube-analyst.html    ← dashboard page — open in browser for docs/overview
├── token.json              ← auto-created on first run (OAuth refresh token)
└── tools/
    ├── auth.py             ← shared OAuth flow
    ├── youtube_client.py   ← YouTube Data API v3 fetcher
    ├── sheets_writer.py    ← Google Sheets writer (one tab per weekly report)
    ├── slides_builder.py   ← Google Slides builder
    ├── gmail_sender.py     ← Gmail email sender
    └── run_weekly_report.py ← orchestrator (run this)
```

## First-time setup

1. **Google Cloud project** — [console.cloud.google.com](https://console.cloud.google.com/). Any project works.
2. **Enable these 4 APIs** — YouTube Data API v3, Google Sheets API, Google Slides API, Gmail API.
3. **OAuth consent screen** — External, Testing. Add your own email as a test user.
4. **Create OAuth 2.0 Client** — type: **Desktop app**. Download the JSON, save as `credentials.json` in the project root.
5. **Fill in `.env`** — at minimum:
   - `YOUTUBE_CHANNEL_ID` (your channel's canonical ID, starts with `UC…`)
   - `GOOGLE_SHEET_ID` (any Sheet you own — find the ID in its URL)
   - `REPORT_RECIPIENTS` (comma-separated email(s) to send to)
6. **Install Python deps:**
   ```
   pip install -r requirements.txt
   ```

## Running

### One-shot

```
python3 tools/run_weekly_report.py
```

First run opens a browser for Google OAuth consent. Subsequent runs are silent —
token cached in `token.json`.

### Dry run (inspect the YouTube data without sending anything)

```
python3 tools/run_weekly_report.py --dry-run
```

### View the dashboard page locally

```
node serve.mjs
# then open http://localhost:3002
```

### Schedule weekly (Sunday 7 AM, macOS/Linux crontab)

```
crontab -e
# add this line:
0 7 * * 0  cd "/Users/admin/W1D2/Youtube Analyst" && /usr/bin/python3 tools/run_weekly_report.py >> /tmp/yt-analyst.log 2>&1
```

## Pipeline

The orchestrator runs these five stages in order:

1. **Auth** → `tools/auth.py` loads (or creates) an OAuth token covering all 4 APIs.
2. **Fetch** → `tools/youtube_client.py` pulls the channel's lifetime totals + videos published in the last N days.
3. **Write** → `tools/sheets_writer.py` creates a dated tab in your Sheet (e.g., `2026-04-25 Weekly`) with metrics + per-video rows.
4. **Build** → `tools/slides_builder.py` creates a 3-slide deck (cover, metrics, top video).
5. **Send** → `tools/gmail_sender.py` emails the summary with links to the Sheet and Slides deck.

Each stage is a function you can `import` and call standalone — useful for
writing tests or wiring a different trigger.

## Troubleshooting

- **"Missing credentials.json"** — step 4 of setup; download from Google Cloud Console and place in the project root.
- **"Channel not found"** — `YOUTUBE_CHANNEL_ID` needs to be the `UC…` ID, not the `@handle`. Find yours at [youtube.com/account_advanced](https://www.youtube.com/account_advanced).
- **Browser flow keeps reopening** — delete `token.json` and run again. Scopes may have changed since the last consent.
- **403 / access denied** — confirm the 4 APIs are enabled on your project AND that your email is in the OAuth consent screen's test-user list.

## Security

- `.env`, `credentials.json`, and `token.json` are all gitignored.
- The OAuth token is scoped to your account — if someone steals `token.json`, they can read your YouTube stats, write to Sheets you own, create Slides, and send email as you. Treat it like a password.
