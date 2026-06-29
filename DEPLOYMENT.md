# Deployment notes — Mondial 2026

This file documents the **non-obvious prerequisites** a deploy must satisfy, especially
for features added after the initial launch. A fresh agent/session deploying this site
should read this first.

Hosts (all track git branch `main`, remote `git@github-work:DevelopSeach/Mondial-2026`):

| Alias        | SSH host    | Project path                         | pm2 process     |
|--------------|-------------|--------------------------------------|-----------------|
| seach-web    | `seach-web` | `/var/www/DevelopSeach-Mondial-2026` | `Mondial-2026`  |
| multidev     | `multidev`  | `/var/www/Mondial-2026`              | `mondial-all`   |

> 4pharma / mon4all are served from the multidev box (same `/var/www/Mondial-2026`).

## Standard deploy

```bash
ssh <host> 'cd <project-path> \
  && sudo git pull --ff-only \
  && sudo npm --prefix server install \
  && sudo npm run client:build \
  && sudo npm --prefix server run db:init \
  && sudo pm2 restart <pm2-process> --update-env'
```

- `npm --prefix server install` — installs new server deps (see below). Skip only if no
  server dep changed.
- `db:init` — creates any **new tables** (idempotent `CREATE TABLE IF NOT EXISTS`; safe to
  re-run, never drops data). Required whenever `server/schema.js` gained a table.
- `client:build` — rebuilds the SPA; the app auto-reloads clients on a new build id.

---

## Feature: Match Voice Reviews ("ריביו קולי") — added 2026-06

Lets users record a spoken match review, auto-transcribe it to Hebrew, edit, and publish.
Transcription is powered by **`@hinbit/transcriber`** (OpenAI `gpt-4o-transcribe` under the
hood). The feature **degrades gracefully**: if any prerequisite below is missing, the audio
still uploads and the user types the review text manually — nothing crashes — but you get
NO automatic transcription until all three are satisfied.

### 1. npm package `@hinbit/transcriber`
- Declared in `server/package.json` (`^1.0.0`). Public scoped package on the npm registry.
- Installed by `npm --prefix server install`. If the registry rejects the `@hinbit` scope
  (private), configure an npm auth token on the host:
  `npm config set //registry.npmjs.org/:_authToken <token>` (or a project `.npmrc`).

### 2. System binary: `ffmpeg` (+ `ffprobe`)
- The browser records WebM/Opus; the lib shells out to ffmpeg to convert to mp3.
- Install once per host: `sudo apt-get update && sudo apt-get install -y ffmpeg`
- Verify: `ffmpeg -version` and `ffprobe -version` both resolve on PATH.

### 3. Secret: `OPENAI_API_KEY` in `server/.env`
- The transcriber calls OpenAI; **without this key transcription is disabled** (per-use
  cost applies once set). `server/.env` is git-ignored — set it on each host directly:
  `OPENAI_API_KEY=sk-...`
- After editing `.env`, restart pm2 with `--update-env`.

### Runtime/storage notes
- Saved recordings live under `data/match_reviews/` and are served from `/data` (static).
  Ensure `data/` is writable by the pm2 process user.
- DB table `match_reviews` is created by `db:init`.
- Known caveat: the lib hard-codes a Hebrew transcription prompt biased toward a lecture
  context (not overridable in 1.0.0). Fine for short clips; fork if quality matters.

---

## Feature: Data-source admin tab ("מקור נתונים") — added 2026-06

- Admin → **מקור נתונים** lets an admin paste the ESPN scoreboard API URL.
- Stored in `settings.espn_scoreboard_url` (via `POST /api/admin/settings`). Empty/invalid
  → the scraper falls back to the hardcoded default. No extra deploy step beyond the
  standard build/restart.

---

## Per-host status checklist (update when you change a host)

- [ ] `ffmpeg` installed
- [ ] `OPENAI_API_KEY` set in `server/.env`
- [ ] `npm --prefix server install` run after the reviews feature landed (pulls `@hinbit/transcriber`)
- [ ] `db:init` run (creates `match_reviews`)
