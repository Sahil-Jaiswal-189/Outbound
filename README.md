# Touch Grass: Outbound

Outbound recommends small real-world activities instead of a feed. Set your interests, goals, dislikes and available time, choose one of three quests, go outside, and return with a short reflection.

## Features

- Editable profile and quick context selection.
- Local SQLite storage for profiles, attempts, feedback and recommendation traces.
- Weather and air quality from Open-Meteo; nearby places from OpenStreetMap/Overpass; pedestrian round-trip estimates from openrouteservice.
- TabPFN predicts completion and enjoyment from structured history.
- A constrained epsilon-greedy selection policy balances relevance, variety and exploration.
- Local Qwen writes friendly titles, reflection prompts and reward messages; recommendation reasons are built from actual saved evidence.
- Field timer, badges, streaks, typed notes and optional ElevenLabs voice/transcription.
- A Recommendation lab tab with isolated synthetic data, candidate scores, validation results, source status and structured logs.
- Honest baseline/template fallbacks when data, models or network services are unavailable.

## Prerequisites

- Node.js **22.13+** (native `node:sqlite`) and npm. Developed with Node 25.3.
- Python 3.11+ for the optional local TabPFN service.
- Ollama and `qwen2.5:3b` for local quest copy.
- Optional: an openrouteservice API key for destination-based walking-time estimates.
- Optional: ElevenLabs credentials for voice and dictated notes.

## Setup and Run

```bash
npm install
cp .env.example .env
npm start
```

Open **http://localhost:5177**. The database is created automatically at `data/outbound.db`; set `DB_PATH` to change it. Existing browser history is imported once when that browser connects. Browser localStorage subsequently holds a UI cache; SQLite is authoritative.

The app binds to localhost by default; `HOST` changes the bind address. A persistent, HttpOnly browser cookie identifies the local workspace. This is a prototype, not an account/login system. Keep the cookie and database when restarting to retain access to the same workspace.

## Deploy on Render

Create a **Node Web Service** from [Sahil-Jaiswal-189/Outbound](https://github.com/Sahil-Jaiswal-189/Outbound), using branch `main`. Leave **Root Directory** empty: `package.json` is at the repository root. Set **Build Command** to `npm ci --omit=dev`, **Start Command** to `npm start`, and **Health Check Path** to `/`. There is no separate frontend build.

Configure these environment variables in Render's dashboard, not in a committed `.env` file:

| Variable | Value / purpose |
| --- | --- |
| `NODE_VERSION` | `24.21.0`; pin a supported Node version with native SQLite |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0`; required for Render to reach the server |
| `PUBLIC_ORIGIN` | Optional custom-domain origin, e.g. `https://outbound.example.com`; otherwise Render's `RENDER_EXTERNAL_URL` is used automatically |
| `DB_PATH` | `/var/data/outbound.db`, **only after attaching a disk at `/var/data`** |
| `ORS_API_KEY` | Your openrouteservice key for walking routes and area labels |
| `ELEVENLABS_API_KEY` | Your key, if enabling voice/transcription |
| `ELEVENLABS_VOICE_ID` | Your chosen voice ID |
| `ELEVENLABS_MODEL` | `eleven_multilingual_v2` (optional; already the default) |
| `ELEVENLABS_STT_MODEL` | `scribe_v2` (optional; already the default) |
| `OLLAMA_URL` | Base URL of a separately running, reachable Ollama service |
| `OLLAMA_MODEL` | `qwen2.5:3b`; must be pulled on that Ollama service |
| `TABPFN_URL` | Base URL of a separately running instance of `services/tabpfn_service.py` |

Leave `PORT` unset: Render supplies it. Open-Meteo weather/air and public Overpass require no keys. `OVERPASS_URL` and `OVERPASS_FALLBACK_URL` are optional overrides; the defaults work without adding them. `SERPAPI_KEY` is not needed by the current recommendation pipeline. There is no implemented `TABPFN_TOKEN` authentication setting.

The configured public origin is used for same-origin write checks and secure HTTPS session cookies, even though Render forwards traffic internally over HTTP. Do not set it to localhost on Render. If you choose a custom domain, use that domain consistently: only the configured origin is allowed for browser writes.

**Database persistence:** Render filesystems are ephemeral unless you attach a persistent disk. Use a paid service with a disk mounted at `/var/data` to retain SQLite history across restarts/deploys. A free demo can omit `DB_PATH` and use the default local database, but its data will be lost when the instance restarts or redeploys. Keep this SQLite deployment to one instance. [Render persistent disks](https://render.com/docs/disks).

**Model services are separate:** `npm start` starts only the Node application, not Ollama or Python. A localhost URL on Render points to the Render container, **not your laptop**. Without reachable model services, the app works with explicitly reported baseline ranking and template copy; it is not doing open-model inference in that mode. `OLLAMA_URL` must support Ollama's native `/api/generate` and `/api/tags` routes, not an arbitrary OpenAI-compatible API.

For TabPFN, create a separate **Python private service** in the same Render region, with build command `pip install -r services/requirements-tabpfn.txt` and start command `python -m uvicorn services.tabpfn_service:app --host 0.0.0.0 --port 8008`. Set `TABPFN_MIN_ROWS=30` and `TABPFN_DEVICE=cpu` **on that Python service**. Set the Node service's `TABPFN_URL` to `http://<actual-private-service-hostname>:8008`. First inference needs checkpoint download access and sufficient memory; this is not included in the Node service's build. For a model-cache disk mounted at `/var/data`, set `TABPFN_MODEL_CACHE_DIR=/var/data/tabpfn` and `HF_HOME=/var/data/huggingface` on the Python service.

Ollama also needs its own runtime with Qwen downloaded and sufficient compute/memory. Prefer private networking for both model services: the app's current model clients do not send authentication headers, and these inference endpoints must not be exposed unprotected to the public internet. [Render private networking](https://render.com/docs/private-network).

The public app is still a prototype: it has browser workspaces, not account authentication or API rate limits. Protect access before advertising a public deployment with paid voice credentials. Hosting it also moves SQLite history to your Render server; notes sent to Qwen/TabPFN travel to whichever model service you configure.

See [Render web services](https://render.com/docs/web-services) for port binding and [Node version configuration](https://render.com/docs/node-version) for runtime pinning.

## Local Qwen

```bash
ollama serve
```

In another terminal:

```bash
ollama pull qwen2.5:3b
```

The default configuration is:

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
```

Qwen customizes the selected activities' short copy. The backend preserves factual steps, destinations, duration and preparation. If generation fails or times out, the selected template quests remain usable.

Named destination titles and **Why this quest** evidence are preserved independently of Qwen's wording. Reasons report the current time/energy/mood settings, supported goal and hobby matches, recorded completion/enjoyment counts, a recent relevant note, source facts and the selection decision. Mood fit is an explicit product rule, not a mental-health prediction. Simple bring/carry reminders for water, an umbrella, a snack or a reusable bag can be carried forward from the latest relevant note; arbitrary notes are not fully interpreted.

## Local TabPFN

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r services/requirements-tabpfn.txt
npm run tabpfn
```

Keep the Python service running alongside `npm start`. Configuration:

```dotenv
TABPFN_URL=http://127.0.0.1:8008
TABPFN_MIN_ROWS=30
TABPFN_DEVICE=cpu
```

The package is pinned to 9.1.0 and the service explicitly uses the **v2 checkpoint**, avoiding changes to the package's default model. The first fit downloads weights; after those are cached, inference can run locally. If checkpoint access or inference fails, the lab reports the failure and the baseline remains active.

Completion and enjoyment have separate labeled datasets. Missing enjoyment is excluded, rather than converted to a dislike. At least 30 labeled training rows, outcome variation, and a later holdout of at least eight rows are required before a target can use TabPFN. Each target is promoted only when its holdout Brier score is lower than the baseline's. This small chronological check is preliminary evidence, not proof of generalization or causal benefit.

The service reports `baseline`, `hybrid`, or `tabpfn` honestly. It caches fitted estimators and predicts all candidates in a batch. Feedback adds examples to its context; we do not fine-tune Qwen or TabPFN weights after each attempt.

See the [TabPFN repository](https://github.com/PriorLabs/TabPFN) for model-specific licenses. The v2 weights use the Prior Labs License with an attribution requirement; newer checkpoints have different terms.

## Structured Data Sources

- [Open-Meteo](https://open-meteo.com/en/docs): weather during the outing; its air-quality endpoint provides modeled AQI. The hosted free service is for noncommercial use.
- [OpenStreetMap/Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API): nearby named parks, gardens, sports grounds, selected shops, libraries, markets and community centres. Attribute OpenStreetMap contributors; data uses ODbL. Public instances are shared resources.
- [openrouteservice](https://openrouteservice.org/services/): walking routes, distance, estimated round-trip travel time and Pelias reverse geocoding for area names. Set `ORS_API_KEY` in `.env` for the hosted API.

Share current location or use **Set starting point** to select a map pin or enter coordinates for nearby places. If GPS fails, the app distinguishes denied permission, an unavailable position, and a timeout. The map uses Leaflet and OpenStreetMap tiles (internet required); coordinate entry still works if tiles cannot load. Choosing a town or city only enables area weather: a city centre is not treated as your exact starting point. Without a verified routing response, the backend offers location-independent activities rather than inventing travel times.

Selecting a pin or sharing GPS resolves its reported neighbourhood/locality through ORS. The picker, homepage and lab show that area; a custom place nickname is kept separately. When lookup is unavailable, coordinates replace generic placeholder names. Reverse lookup sends the selected coordinates to ORS, is debounced in the picker, has a five-second server deadline and uses a seven-day cache. Keys stay on the server. The lab's saved run location remains the location used for that run, not a newly selected point.

Weather is cached for 10 minutes, air quality for 30 minutes, places/routes for 24 hours, and geocoding for seven days. Provider calls have deadlines and independent fallbacks. Opening hours and accessibility remain unverified. Severe modeled outdoor conditions suppress quests rather than forcing an outing.

Overpass tries the standard public endpoint, then Private.coffee on a network/server failure (at most two requests, ten seconds each). Rate-limit responses are not retried. Concurrent duplicate queries share a request; failures have a 30-second cooldown. Set `OVERPASS_URL` to self-host; custom endpoints have no automatic public fallback unless `OVERPASS_FALLBACK_URL` is explicitly set. An empty fallback variable disables failover. Missing routing credentials are shown independently of place-fetch failures.

The legacy SerpAPI endpoint remains available when configured, but it is **not called by the recommendation pipeline**.

Selecting a starting point previews weather and modeled air quality on both the homepage and lab. AQI is a regional CAMS estimate, not a neighbourhood sensor reading. Transient AQI failures receive one bounded retry (five-second first deadline, eight-second retry); rate limits and invalid responses are not retried. Persistent failure is displayed as unknown, never clean air. Location requests visibly enter a pending state and have a watchdog; browser/system permissions or an embedded preview can still prevent GPS access.

The lab's **Data sources** table identifies each routed place and its round-trip duration. Multiple ORS rows are separate destination requests, not duplicate recommendations. A successful route does not guarantee a feasible quest: insufficient time, darkness and your constraints can still exclude it. Named destination options are preferred in the first slot when they pass the low-effort and feasibility checks; the app does not invent an open garden when none qualifies.

## Activity Variety

The backend considers **120 different activities**, 20 each for movement, nature, curiosity, creativity, social activities and errands, plus verified nearby-destination activities. They are actual activities, not generated title variants. Each includes a real time minimum, effort, preparation and relevant outdoor constraints.

On the homepage, **Browse activities** provides search, category/time filters and pagination over the full catalog. Choose an activity to reserve it in your next deck; the backend still checks your profile, available time and live conditions. The choice applies to one deck only. Automatic recommendations avoid the last eight offered decks where alternatives remain and vary among similarly scored activities. Completion history and offered-history remain separate, so ignoring a suggestion is not trained as a dislike.

### Matching Activities to Nearby Places

`backend/place-matching.mjs` combines the catalog with real mapped opportunities:

- Parks/gardens: suitable movement, observation, curiosity and creative activities.
- Libraries: reading your own book outdoors if a permitted spot exists; a book return only when your current note states that need and this library accepts it.
- Sports grounds: suitable movement; ball practice requires a matching mapped sport and permission on arrival.
- Shops/markets: practical checks; shopping-related activities require an explicit need in your current note, not just an errands goal.

The three-route budget prioritizes your goal or chosen activity and covers different place groups before additional similar venues. Each routed place contributes at most 12 feasible matches balanced across activity categories. When the same activity fits multiple places, the shorter verified round trip is retained. The original activity ID is preserved for history and repetition checks.

Every destination candidate includes **round-trip walking time + on-site activity time + a two-minute reserve**. The catalog minimum is conservatively required as on-site time. Activities without enough time or a successful route are not attached to named destinations. Live conditions and profile constraints still apply before TabPFN ranking. A small rules-based place-fit bonus applies only to matches aligned with your goal or supported hobby; it is not a learned estimate of benefit. A deck does not repeat the same activity or destination.

Quest cards display the destination and time breakdown. In the lab, inspect **Place-to-activity matches**, **Destination candidates**, the **Place fit** score component and the `route_selection` / `place_matching` events. Access, stock, seating, facilities and opening hours remain unverified. Without precise coordinates or `ORS_API_KEY`, the general catalog remains available without invented destination travel times.

## Recommendation Lab

1. Open the **Recommendation lab** tab.
2. Choose **20-200 demo rows**, then select **Seed demo data**.
3. Adjust the simulation's minutes, energy, goal and reported weather.
4. Select **Run demo recommendation**.
5. Inspect saved rows, target engines, chronological validation, candidate score components, rejected activities, selection probabilities and source status.
6. Expand a structured event to inspect its JSON, or switch to **Personal** to inspect real records.

Demo rows and runs belong to a separate workspace. Re-seeding replaces synthetic attempts there and leaves personal history, badges and streaks untouched. Synthetic scores demonstrate mechanics; they are not evidence of real-world effectiveness.

Backend events are also printed as JSON lines in the Node terminal. Python emits model status/failure logs. Notes, credentials and exact coordinates are not printed in structured terminal events.

## ElevenLabs

```dotenv
ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=your_voice_id
ELEVENLABS_MODEL=eleven_multilingual_v2
ELEVENLABS_STT_MODEL=scribe_v2
```

Use the homepage voice toggle to enable ElevenLabs quest read-aloud and reward voice. The stop control interrupts quest playback. Browser speech and typed notes remain fallbacks. Local WAV sounds provide button/reward feedback; badge reveals follow reward speech with a three-second delay.

## Verification

```bash
npm test
npm run test:python
npx playwright install chromium
npm run test:browser
```

Backend tests cover persistence, ownership, missing labels, demo isolation, source caching, constraints and exploration. Python tests cover chronological evaluation and truthful fallbacks. Browser tests cover desktop/mobile seeding, recommendations and saved feedback without spending voice API credits.

## Visual Credits

The local park-path photograph is by [Tina Devidze on Unsplash](https://unsplash.com/photos/a-path-winds-through-a-sunny-green-park-lh_MesNhkbI), used under the [Unsplash License](https://unsplash.com/license). Icons are Lucide; the interactive map uses Leaflet with visible OpenStreetMap attribution.

## Project Structure

```text
backend/
  store.mjs              SQLite schema, migrations, feedback, traces
  sources.mjs            Cached specialist adapters
  recommender.mjs        Candidates, filters, prediction, selection, Qwen copy
public/
  app.js                 Quest/profile/feedback UI
  lab.js                 Structured database and recommendation inspector
  styles.css
  index.html
  audio/
services/
  tabpfn_service.py       Local outcome prediction and validation
  requirements-tabpfn.txt
tests/
  backend.test.mjs
  http.test.mjs
  test_tabpfn.py
  browser/
server.mjs               HTTP API and local session
ARCHITECTURE.md
```

Personal databases, model caches, `.env`, dependencies and browser artifacts are gitignored. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the data contracts and implementation boundaries.
