# Touch Grass: Outbound

Touch Grass: Outbound is an anti-feed quest app. Instead of recommending posts, videos, or more screen time, it recommends small real-world actions the user can actually do.

The app asks for a lightweight profile, then uses the user's current context and past quest history to generate three possible quests:

- **Easy Win**: the lowest-friction action
- **Useful Quest**: something practical that helps future-you
- **Stretch Quest**: a slightly more novel action that still feels doable

The user picks one, leaves the screen, returns with a note, and the system learns from the outcome.

## Why This Exists

Most recommendation systems optimize for attention. Outbound flips that objective:

```text
Instead of: what keeps this person scrolling?
Ask: what gets this person moving?
```

The project is designed around short app sessions and real-world follow-through. The screen is a launcher, not the destination.

## Core Features

- Profile onboarding for hobbies, goals, dislikes, reminders, social comfort, and effort comfort
- Quick-tap home screen for minutes available, mood, energy, goal, place vibe, and weather feel
- Qwen/Ollama quest generation with local fallback
- TabPFN ranker service hook for structured quest recommendation
- Optional SerpAPI live context for grounded local outing ideas
- Local quest history, badges, streaks, and notes
- Field mode timer with a minimal screen
- Typed or recorded reflection notes
- ElevenLabs reward voice and transcription hooks
- Local arcade reward sound and fast UI click sound
- Browser/local fallbacks when optional services are unavailable

## Open AI Approach

Outbound is built to keep personal behavior data close to the user. The app can run locally, and the main AI path uses open-weight/local tooling:

- **Ollama + Qwen 2.5 3B** for quest generation and reward copy
- **TabPFN** as the optional tabular ranker for completion/enjoyment prediction
- **Local storage** for the first version of user memory

ElevenLabs is optional and used only for voice experience. The app still works without it.
SerpAPI is also optional; it adds fresh local context when configured, but the app can still generate quests offline.

## Architecture

```text
User profile
  hobbies, goals, dislikes, reminders

Current context
  minutes, mood, energy, place vibe, weather, constraint

Memory retrieval
  local notes and structured quest history

Quest generation
  Qwen through Ollama if available
  offline generator otherwise

Quest ranking
  TabPFN service if configured
  local structured scorer otherwise

Field mode
  timer, quest, no feed

Reflection
  completed / partial / skipped
  liked, benefit score, note

Reward
  arcade sound
  optional ElevenLabs voice
  badges after reward voice completes
```

The current data flow is intentionally simple: browser local storage plus optional local services. A future version can move memory into SQLite with vector search.

## Tech Stack

- Frontend: vanilla HTML, CSS, JavaScript
- Server: Node.js built-in HTTP server
- Local model runtime: Ollama
- Default model: `qwen2.5:3b`
- Optional tabular AI: TabPFN service with FastAPI
- Optional live grounding: SerpAPI
- Optional voice: ElevenLabs Text to Speech and Speech to Text
- Storage: browser `localStorage`

## Prerequisites

Required:

- Node.js 20+
- npm

Recommended:

- Ollama for local Qwen generation
- Python 3.11+ for the TabPFN service
- ElevenLabs API key for reward voice and transcription

This project was developed on macOS with Apple Silicon, but the base app only needs Node.

## Setup

Install nothing for the base server; it uses Node built-ins.

Create your local env file:

```bash
cp .env.example .env
```

Edit `.env` as needed. Do not commit `.env`.

## Run The App

```bash
npm start
```

Open:

```text
http://localhost:5177
```

## Run With Qwen Through Ollama

Start Ollama:

```bash
ollama serve
```

Pull the default model:

```bash
ollama pull qwen2.5:3b
```

Set this in `.env`:

```bash
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
```

Then run:

```bash
npm start
```

If Ollama is not running, the app falls back to its offline quest generator.

## Optional Live Context

Set this in `.env` if you want the app to use SerpAPI for fresh local context:

```bash
SERPAPI_KEY=your_key
```

The app uses this only as grounding material. Qwen still makes the final quest decision from the user's profile, current context, past quest history, and any available live context.

## Run The TabPFN Ranker

Create a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r services/requirements-tabpfn.txt
```

Start the ranker:

```bash
npm run tabpfn
```

In another terminal, run the app:

```bash
npm start
```

Set this in `.env`:

```bash
TABPFN_URL=http://127.0.0.1:8008
```

For true local TabPFN model inference, Prior Labs requires one-time license acceptance and a token:

```bash
TABPFN_TOKEN=your_token_here
```

Without `TABPFN_TOKEN`, the service still runs and returns a TabPFN-ready fallback ranking so the app remains usable.

## ElevenLabs Voice

Set these in `.env`:

```bash
ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=your_voice_id
ELEVENLABS_MODEL=eleven_multilingual_v2
ELEVENLABS_STT_MODEL=scribe_v2
```

ElevenLabs is used for:

- reward voice after completing a quest
- quest read-aloud when Eleven voice mode is enabled
- optional recorded-note transcription

If ElevenLabs fails or is not configured, the app falls back to browser speech and typed notes.

## Environment Variables

See [.env.example](./.env.example).

Important:

- `.env` is ignored by git
- `.env.example` is safe to commit
- do not commit API keys or local tokens

## Project Structure

```text
public/
  index.html
  styles.css
  app.js
  audio/
    arcade-reward.wav
    eleven-ui-click.wav

services/
  tabpfn_service.py
  requirements-tabpfn.txt

server.mjs
package.json
ARCHITECTURE.md
```

## Development Notes

Useful checks:

```bash
node --check server.mjs
node --check public/app.js
python3 -m py_compile services/tabpfn_service.py
```

Useful endpoints:

```text
GET  /api/status
POST /api/generate
POST /api/context
POST /api/reward
POST /api/speak
POST /api/transcribe
```

## Philosophy

Outbound should feel like a game launcher for life, not a game that traps you inside it.

The ideal session is short:

1. Open the app.
2. Pick one quest.
3. Leave the screen.
4. Come back with one sentence.
