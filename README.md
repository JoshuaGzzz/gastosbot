# 🤡 gastosbot — brought to you by **OKE BAKLA**

A Discord bot built to publicly track, roast, and gamble on Joseph's mining habits — powered by Supabase, voice moderation, and the unmatched chaos energy of **OKE BAKLA**.

> **OKE BAKLA** logs in, **OKE BAKLA** registers the commands, **OKE BAKLA** watches the server 24/7. This is the **OKE BAKLA** cinematic universe.

---

## ✨ Features

### ✋ MINE Tracker
**OKE BAKLA** keeps a running no-mine streak timer for Joseph.
- `/timer` — check how long it's been since Joseph last typed "mine"
- `/mine` — log a new mine (category + reason), **OKE BAKLA** announces it in the channel
- `/scream` — manually re-announce the latest mine from the website
- Also listens for a Supabase webhook (`/webhook`) so **OKE BAKLA** screams the moment the *website's* mine button gets pressed

### 🎲 Betting Pool
- `/bet` — place a bet on when Joseph mines next
- `/bets` — **OKE BAKLA** shows the live leaderboard and current pot

### 🐔 Sabong
- `/sabong` — **OKE BAKLA** starts a Meron o Wala betting game with interactive buttons

### 🔇 Voice Moderation
- `/modjoin` / `/modleave` — **OKE BAKLA** joins your VC and listens for flagged words, disconnecting offenders
- `/modleaderboard` — who's been yeeted out the most
- `/badwords` — see the current flagged word list

### 🔔 Join Sound
- `/joinsound` — toggle whether **OKE BAKLA** plays a sound whenever someone joins a voice channel

### 🎯 Apex Legends Presence Roast
The moment someone in the server opens Apex Legends, **OKE BAKLA** knows — and **OKE BAKLA** will not let it slide. Pings a role, tags the user, and drops a roast in the designated channel.

### 🛠️ AI-Generated Patch Notes
Every push to this repo triggers a GitHub webhook → **OKE BAKLA** feeds the commit log to Gemini → posts corny, video-game-style "patch notes" to Discord. No dev jargon, no commit hashes — just vibes, courtesy of **OKE BAKLA**.

---

## 🛠️ Setup

### 1. Install dependencies
Railway runs this automatically on deploy — no local `npm install` required unless you're running it yourself.

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` (or set these directly in Railway → Variables) and fill in real values. **OKE BAKLA** refuses to boot without them.

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application (client) ID |
| `GUILD_ID` | The server (guild) ID **OKE BAKLA** operates in |
| `CHANNEL_ID` | Main channel for mine announcements |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase publishable/anon key |
| `APEX_CHANNEL_ID` | Channel where **OKE BAKLA** posts Apex roasts |
| `GITHUB_WEBHOOK_SECRET` | Shared secret to verify GitHub webhook requests |
| `PATCHNOTES_CHANNEL_ID` | Channel where **OKE BAKLA** posts AI patch notes |
| `GEMINI_API_KEY` | Google Gemini API key (used to generate patch notes) |
| `WEBHOOK_PORT` | Optional — Railway sets `PORT` automatically, this is just a fallback |

### 3. GitHub webhook (for patch notes)

- Repo → **Settings** → **Webhooks** → **Add webhook**
- Payload URL: `https://<your-railway-domain>/github-webhook`
- Content type: `application/json`
- Secret: same value as `GITHUB_WEBHOOK_SECRET`
- Events: **Just the push event**

### 4. Deploy

Push to this repo — Railway auto-builds and redeploys **OKE BAKLA** on every commit.

```bash
npm start
```

---

## 📦 Tech Stack

- [discord.js](https://discord.js.org/) v14
- [Supabase](https://supabase.com/) for persistent state
- [Express](https://expressjs.com/) for incoming webhooks
- [Google Gemini API](https://ai.google.dev/) for AI-generated patch notes
- Deployed on [Railway](https://railway.app/)

---

<p align="center"><i>All hail OKE BAKLA. 🫡</i></p>
