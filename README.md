# nearfield.space

A music discovery tool that visualizes track similarity as an interactive force-directed graph. Search for a track (or paste a YouTube URL), and the app extracts an audio fingerprint — spectral shape, MFCCs, tempo, dynamics — then finds and graphs the most similar tracks.

## How it works

- Track metadata/search comes from the [cosine.club](https://cosine.club) API.
- Audio is pulled via `yt-dlp`, decoded with `ffmpeg`, and analyzed with [Meyda](https://meyda.js.org/) to build a 39-dimensional feature vector per track.
- Similarity between tracks is a weighted cosine distance over that vector.
- The frontend renders results as an interactive graph (`force-graph`), with "Discovery" (explore from a seed track) and "Library" (browse everything you've added) views.

## Project structure

- `frontend/` — static HTML/CSS/vanilla JS (MVVM-ish: `models/`, `viewmodels/`, `views/`, `services/api.js`). No build step.
- `backend/` — Node/Express API (`server.js`). Talks to the cosine.club API, runs `yt-dlp`/`ffmpeg` extraction, and caches results in a local SQLite file (`backend/data/cache.sqlite3`).

## Local development

```bash
cd backend
npm install
cp .env.example .env   # then fill in COSINE_API_KEY
npm start
```

This serves both the frontend and the `/api/*` routes from `http://localhost:3000`.

Requires `yt-dlp` and `ffmpeg` on `PATH`.

## Deployment

- **Frontend**: deployed to Vercel as a static site (project root directory set to `frontend/`, no build command).
- **Backend**: runs on a persistent host (it shells out to `yt-dlp`/`ffmpeg` and needs a writable SQLite file, so it isn't a fit for serverless), reachable at `api.nearfield.space` via a Cloudflare Tunnel.
- CORS is restricted via the `ALLOWED_ORIGINS` env var (see `backend/src/config.js`), and the frontend's API base URL (`frontend/js/services/api.js`) switches between a relative `/api` path locally and the absolute `api.nearfield.space` URL in production.
