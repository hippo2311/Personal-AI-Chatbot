# DayPulse AI – Developer Guide

DayPulse AI is an interactive wellbeing companion that blends AI-powered daily chats, a journaling workflow with photos, community sharing, and analytics. The codebase is split into two workspaces:

- `client/` – React + Vite SPA that handles chat, diary, knowledge graph visualizations, dashboard, and the community wall.
- `server/` – Express backend / worker endpoints backing AI workflows (chat completion, extraction, etc.).

This document explains how to set up both apps locally, manage environment variables, run the development servers, and contextualizes the pitch narrative you can deliver alongside the demo.

---

## Table of Contents
1. [Features](#features)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Environment Configuration](#environment-configuration)
5. [Installation & Local Development](#installation--local-development)
6. [Useful Commands](#useful-commands)
7. [Troubleshooting](#troubleshooting)
8. [Pitch Narrative Explained](#pitch-narrative-explained)

---

## Features
- **AI Daily Chat** – Mood-aware conversational agent that initiates check-ins, stores transcripts, and keeps mood analytics up to date.
- **Diary + Media Vault** – Log moments with text and photos, filter/search, auto-tag sensitive content, and sync to Firestore.
- **Life Graph / Analytics** – Graph page and dashboard highlight mood trends, streaks, challenge completion, and community stats.
- **Community Wall** – Share gratitude posts, attach media, add reactions, and comment (with Firestore rules guarding updates).
- **Settings & Social Layer** – Manage reminders, notification settings, profile, and friend connections.

---

## Architecture

| Layer | Tech | Notes |
| --- | --- | --- |
| Frontend | React 18 + Vite + Firebase Web SDK | Also uses Lottie animations, custom hooks, and CSS modules. |
| Backend | Node.js + Express | Provides AI orchestration (chat completions, day-end extraction), runs on `npm start`. |
| Data | Firebase Authentication, Firestore, Storage | Firestore rules control community wall and per-user collections. |

---

## Environment Configuration

Both workspaces expect a `.env` file **that is not committed to git** (see `.gitignore`). Keep `.env` files locally and distribute secrets via a secure channel (password manager, secret-sharing doc, etc.). Never upload API keys to the repository.

### `client/.env`
Copy `client/.env.example` and fill in your Firebase web config:

```
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

These values come from **Firebase Console → Project Settings → Your apps (Web)**. Share them privately with teammates who need to run the client.

### `server/.env`
Provide any backend secrets here (OpenAI keys, service URLs, etc.). Example (adjust to your actual needs):

```
OPENAI_API_KEY=sk-...
```

---

## Installation & Local Development

Clone the repository, then set up each workspace individually.

### 1. Client (React + Vite)
```bash
cd client
npm install
# ensure client/.env is populated before running
npm run dev
```

Vite will print a URL (e.g., `http://localhost:5173/`). Click/open that link in your browser for the frontend.

### 2. Server (Express backend)
```bash
cd server
npm install
# ensure server/.env is populated before running
npm start
```

By default the backend listens on `http://localhost:4000` (adjust if you changed `PORT`). Keep it running while you test chat or extraction flows from the client.

---

## Useful Commands

| Location | Command | Description |
| --- | --- | --- |
| `client/` | `npm run dev` | Starts Vite dev server with hot reloading. |
| `client/` | `npm run build` | Builds production assets. |
| `server/` | `npm start` | Launches Express server (after `npm install`). |
---

## Troubleshooting
- **`ERR_BLOCKED_BY_CLIENT` on Firestore calls** – Disable ad/tracker blockers for `localhost:5173` so requests to `https://firestore.googleapis.com` aren’t intercepted.
