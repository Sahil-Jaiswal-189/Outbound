# Outbound

**Touch Grass: a small quest, a real place, a reason to put the screen away.**

Outbound recommends small real-world activities instead of a feed. Set your interests, goals, dislikes and available time, choose one of three quests, go outside, and return with a short reflection.

[Live demo](https://outbound-taqn.onrender.com/) | [Challenge submission draft](./docs/SUBMISSION.md) | [Detailed architecture](./ARCHITECTURE.md)

![Outbound's desktop interface](./docs/assets/home.png)

Screenshots use automated demo data. Named places and source readings in the visual fixtures are illustrative, not a record of a real outdoor visit.

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

## Architecture at a Glance

For a plain-language overview, see [how Outbound chooses an outing](./docs/assets/how-it-works-visual.png) and the [submission narrative](./docs/SUBMISSION.md). The diagram below is the more detailed runtime view.

![Outbound architecture: one self-hosted container, structured external facts and a feedback loop](./docs/assets/architecture.png)

| Component | Responsibility |
| --- | --- |
| Browser: plain JavaScript, Lucide, Leaflet | Profile/context controls, three-quest deck, field timer, reflections and badges |
| Node HTTP API | Validate input, discover/filter candidates, combine scores, select the slate and persist authoritative facts |
| SQLite | Profiles, source cache, saved runs, attempts and structured events; never model weights |
| Python / TabPFN v2 | Separate probabilities for completion and enjoyment from labeled tabular history |
| Constrained epsilon-greedy policy | Diversity, recent-offer avoidance and limited exploration after feasibility checks |
| Ollama / Qwen2.5:3b | Friendly quest titles, reflection prompts and optional reward copy, not routing or selection |
| Open-Meteo / Overpass / openrouteservice | Weather/AQI, mapped places, and walking estimates respectively |
| Optional ElevenLabs | Quest/reward speech and dictated notes; not required for recommendations |

The flow is **context + history -> structured facts -> feasible catalog/place matches -> outcome predictions -> constrained selection -> Qwen wording -> saved quests -> feedback**. A user-selected catalog activity still passes the same feasibility checks. TabPFN and the selection policy are different components; new feedback conditions the predictor but does not fine-tune either model's weights.

### Clear Recommendation Responsibilities

1. **Filter first:** source adapters and the backend establish feasible activities using time, travel, physical/social comfort, supported dislikes/current constraints, daylight, weather and air quality.
2. **Predict:** TabPFN receives 13 structured pre-outing features and labeled history, then estimates completion and liking. It does not discover places or choose the final deck.
3. **Score and select:** when at least one target uses validated TabPFN (`tabpfn` or `hybrid`), `score = 0.5 * completion_probability + 0.5 * liked_probability - repetition_penalty`. Hybrid keeps the other target's baseline estimate. No additional goal, mood or place bonuses are added to these predictions.
4. **Cold-start fallback:** when neither target uses TabPFN (`baseline`, including model failure), ranking instead uses explicit preference fit: 1 for a current-goal match, 0.75 for a supported hobby match, otherwise 0.4, minus the same repetition penalty. Provisional category-baseline probabilities remain visible but do not determine fallback ranking. This is a rule-based fallback, not learned personalization.
5. **Write last:** Qwen personalizes wording after selection; factual steps, timings and destinations remain backend-owned.

Repetition subtracts 0.15 for a template attempted within the last 12 feedback rows and 0.08 for one displayed in the last eight decks. Selection avoids duplicate activities/destinations, prefers different categories and recent-offer novelty, and explores on the third slot with probability 0.15. Existing first-slot low-effort and feasible named-place preferences remain selection constraints, not score bonuses. Scores are not probabilities; the equal weights and exploration rate are product settings, not measured optima.

| Data | Backend use | TabPFN feature use |
| --- | --- | --- |
| Profile hobbies, dislikes, comfort, reminders | Filtering, fallback preferences, preparation and Qwen context | Not direct prediction features |
| Minutes, mood, energy, goal, locality type | Outing settings; time/energy checks; goal-based fallback | All five are features |
| Weather, temperature, rain probability | Conditions checks and preparation | All three are features |
| Air quality | Conditions checks and preparation | Not a feature |
| Mapped places and walking routes | Named candidate construction, compatibility and time checks | Travel minutes only; no place names/coordinates |
| Candidate type, total duration, physical/social effort | Feasibility and selection | All four are features |
| Past completion/liking and outing features | Repetition tracking and baseline estimates | Labeled historical examples |
| Notes and recently offered activities | Supported intent, remembered preparation, Qwen context and novelty | Not prediction features |

Hobbies and place categories are not yet TabPFN inputs. Removing their model-run bonuses is deliberate: no claim is made that they are learned indirectly. Adding reliable structured features and evaluating them against the chronological baseline is future work. Mood is already a TabPFN input, but is never added again as a scoring bonus. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the exact flow and limitations.

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

Deploy the **whole self-hosted stack as one Docker Web Service**: Node serves the frontend/API, Ollama runs Qwen, Python runs TabPFN, and SQLite stores history. A supervisor starts/restarts the processes and forwards their logs. Node is the only public listener; model services bind to loopback.

1. Create a Web Service from [Sahil-Jaiswal-189/Outbound](https://github.com/Sahil-Jaiswal-189/Outbound), using branch `main`.
2. Choose **Language: Docker**, not Node or Python. If an existing service uses Node, create a replacement Docker service rather than keeping `npm start` as its only process.
3. Leave **Root Directory** empty; use Dockerfile path `./Dockerfile`.
4. Leave the **Docker Command** override empty. The image's entrypoint starts the supervisor; there are no separate npm build/start commands to enter.
5. Attach a persistent disk with mount path **`/var/data`**. Start with enough space for both checkpoints and history (10 GB is a planning estimate, not measured long-term usage).
6. Set **Health Check Path** to **`/healthz`** and add your API credentials below.

Node, Ollama and CPU-only Torch versions are pinned in the image. Only production npm dependencies are installed. `.dockerignore` uses an allowlist, so local `.env`, personal databases, virtual environments, model files, Git metadata and test artifacts are not sent into the image. Runtime processes run as the `outbound` user; the root entrypoint only prepares writable storage and starts the supervisor.

Configure these environment variables in Render's dashboard, not in a committed `.env` file:

| Variable | Value / purpose |
| --- | --- |
| `ORS_API_KEY` | Your openrouteservice key for walking routes and area labels |
| `ELEVENLABS_API_KEY` | Your key, if enabling voice/transcription |
| `ELEVENLABS_VOICE_ID` | Your chosen voice ID |
| `ELEVENLABS_MODEL` | `eleven_multilingual_v2` (optional; already the default) |
| `ELEVENLABS_STT_MODEL` | `scribe_v2` (optional; already the default) |
| `PUBLIC_ORIGIN` | Optional custom-domain origin, e.g. `https://outbound.example.com`; otherwise Render's `RENDER_EXTERNAL_URL` is used automatically |

The following values are already configured by Docker/the entrypoint. They can be entered explicitly for visibility but are not required dashboard entries:

```dotenv
HOST=0.0.0.0
DATA_DIR=/var/data
DB_PATH=/var/data/outbound.db
OLLAMA_MODEL=qwen2.5:3b
TABPFN_DEVICE=cpu
TABPFN_MIN_ROWS=30
TABPFN_CACHE_SIZE=2
TABPFN_TIMEOUT_MS=90000
OLLAMA_TIMEOUT_MS=60000
```

The entrypoint sets `OLLAMA_URL=http://127.0.0.1:11434` and `TABPFN_URL=http://127.0.0.1:8008` automatically and keeps both model servers internal. Do not configure external model URLs for this deployment. Leave **`PORT` and `NODE_VERSION` unset**: Render supplies the public port, and Docker selects Node. `NODE_ENV=production` is already set in the image. A ready-to-review variable list is in [deploy/render.env.example](./deploy/render.env.example).

Open-Meteo weather/air and public Overpass require no keys. `OVERPASS_URL` and `OVERPASS_FALLBACK_URL` are optional overrides; the defaults work without adding them. `SERPAPI_KEY` is not needed by the current recommendation pipeline. There is no implemented `TABPFN_TOKEN` authentication setting.

The configured public origin is used for same-origin write checks and secure HTTPS session cookies, even though Render forwards traffic internally over HTTP. Do not set it to localhost on Render. If you choose a custom domain, use that domain consistently: only the configured origin is allowed for browser writes.

**Database and checkpoint persistence:** `/var/data/outbound.db` stores SQLite; `/var/data/ollama`, `/var/data/tabpfn` and `/var/data/huggingface` store model/cache files. Keep the disk when redeploying. Render filesystems are ephemeral without a disk, so both history and downloaded weights would otherwise be lost on restart/redeploy. Persistent disks require a paid service, and this SQLite deployment stays at one instance. Local history is not automatically copied to Render. [Render persistent disks](https://render.com/docs/disks).

**First startup:** the app starts while a background job checks Ollama, pulls the configured Qwen model, warms it, and prefetches TabPFN's **v2 classifier checkpoint**. Cached files are reused. Failed initialization is retried every 30 seconds and emits structured `model_bootstrap` logs. Ollama cloud features are disabled. `/api/status` reports current service reachability, Qwen model availability and the initialization snapshot. `tabpfn: ready / checkpoint_cached` means weights have been downloaded, not that a user's model passed evaluation. TabPFN still needs sufficient labeled history and must beat the baseline on the chronological holdout. Until initialization succeeds, recommendations honestly report baseline/template fallbacks.

`/healthz` is a fast **web-process liveness check**, not a claim that every model is ready or that inference quality is validated. This lets Render finish the web deployment while checkpoints download. Inspect `/api/status` and logs for model failures; do not infer model readiness from Render's green deployment indicator alone.

**Compute requirements:** one container still needs enough RAM and CPU for Qwen, TabPFN and their inference overhead. An 8 GB RAM instance is a preliminary starting point for benchmarking, not a guaranteed minimum or a measured Render sizing result. Tiny/free instances are not a realistic target for this combined workload. Ollama allows one concurrent request/model and uses a 4096-token context; TabPFN has one worker, serialized ranking and a two-estimator cache limit. Cold validation can be slow on CPU. Requests have bounded, configurable model deadlines; timeout means a reported fallback, not a successful model prediction. This is a low-concurrency prototype, not a production multi-user inference service.

Weather/place/routing calls and optional ElevenLabs voice still use external APIs. Qwen, TabPFN and SQLite stay in the container; that does not make the entire outing workflow offline. Downloaded models remain subject to their respective licenses.

The public app still has browser workspaces, not account authentication or API rate limits. Protect access before advertising a public deployment with paid voice credentials. Hosting it moves SQLite history from your laptop to the Render server you control.

See [Render Docker deployment](https://render.com/docs/docker) and [web services](https://render.com/docs/web-services).

### Run the Same Container Locally

```bash
docker build --platform linux/amd64 -t outbound .
docker run --name outbound --env-file .env -p 127.0.0.1:5177:10000 \
  -e PORT=10000 -e HOST=0.0.0.0 -e TABPFN_CACHE_SIZE=2 \
  -v outbound-data:/var/data outbound
```

Open **http://localhost:5177**. The explicit port overrides the local `.env` value; the entrypoint always uses local model URLs inside the container. Stop with `docker stop outbound`. Do not also run local Ollama/Python for this container: it includes both. Apple Silicon runs this Linux/amd64 image through emulation, so timings there are not a native Render benchmark. Plain `npm start` remains a supported Node-only local workflow with separately started local model processes.

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

Named destination titles and **Why this quest** evidence are preserved independently of Qwen's wording. Reasons report time/energy fit, supported goal and hobby matches, recorded completion/enjoyment counts, a recent relevant note, source facts and the selection decision. They identify outcome-average versus preference-fallback ranking. A goal/hobby match is factual context, not proof of an extra model-run bonus or an inferred causal benefit. Simple bring/carry reminders for water, an umbrella, a snack or a reusable bag can be carried forward from the latest relevant note; arbitrary notes are not fully interpreted.

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

Overpass tries the standard public endpoint, then Private.coffee on a network/server failure (at most two requests, **35 seconds each**). Queries allow **15 seconds of server execution**; the longer HTTP deadline leaves room for queueing and network delay. Place discovery can therefore take up to about 70 seconds when both endpoints are slow, before routing and model inference. Rate-limit responses are not retried. Concurrent duplicate queries share a request; failures have a 30-second per-query cooldown. Set `OVERPASS_URL` to self-host; custom endpoints have no automatic public fallback unless `OVERPASS_FALLBACK_URL` is explicitly set. An empty fallback variable disables failover. Missing routing credentials are shown independently of place-fetch failures. Only unexpired cached facts are reused: there is no stale-place fallback or cross-area cache reuse in this version.

The optional SerpAPI endpoint remains available when configured, but it is **not called by the recommendation pipeline**.

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

Every destination candidate includes **round-trip walking time + on-site activity time + a two-minute reserve**. The catalog minimum is conservatively required as on-site time. Activities without enough time or a successful route are not attached to named destinations. Live conditions and profile constraints still apply before TabPFN ranking. Places supply feasible opportunities, not an extra scoring bonus. A deck does not repeat the same activity or destination.

Quest cards display the destination and time breakdown. In the lab, inspect **Place-to-activity matches**, **Destination candidates**, the **Scoring / Base score / Repeat penalty** columns and the `route_selection` / `place_matching` events. Access, stock, seating, facilities and opening hours remain unverified. Without precise coordinates or `ORS_API_KEY`, the general catalog remains available without invented destination travel times.

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

The test suite includes **34 backend, 13 Python and 28 desktop/mobile browser tests**, including score separation, hybrid/fallback behavior, saved-record display, repetition and source-to-predictor flow. A passing synthetic evaluation proves that the pipeline executes, not that users become more active.

For a real single-container smoke check (Docker running, internet on first model download, sufficient RAM):

```bash
docker build --platform linux/amd64 -t outbound:single-service-verified .
node tests/container-smoke.mjs outbound:single-service-verified
```

This creates disposable containers and uses the separate `outbound-single-service-test` volume, never the personal database or `.env` credentials. It checks real Qwen generation, TabPFN evaluation, worker restart, internal model ports, a custom public port, graceful shutdown and persistence across a fresh-container redeploy. Test containers are removed; public model caches and synthetic test data remain in that volume for repeat runs. Timings under Apple Silicon emulation are not Render benchmarks.

To rebuild the publication figures from the browser test artifacts:

```bash
npm run test:browser
node scripts/build-post-assets.mjs
```

The script copies verified UI screenshots and renders the architecture SVG and mobile workflow figure into `docs/assets/`; it does not alter application data.

Figure 6 in the submission uses a separate real-model capture: `node scripts/capture-model-lab.mjs`. It runs CPU TabPFN v2 on 120 synthetic outings in an in-memory workspace and saves the screenshot plus validation/score evidence. Local Python dependencies and Chromium are required; the first run downloads the checkpoint. It does not modify personal history or prove real-world effectiveness. See [publishing instructions](./docs/PUBLISHING.md) for details.

## Open Components and Limits

Qwen runs through the open-source Ollama runtime; TabPFN inference runs in a local Python service, with no hosted LLM or predictor API required. In laptop mode, SQLite history and inference inputs stay on the laptop. In Docker/Render mode, they reside on that server, not on a third-party inference provider.

**Open weights are not the same as unrestricted open-source licensing.** Qwen2.5-3B-Instruct uses the [Qwen Research license](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct); TabPFN's v2 checkpoint uses the [Prior Labs License with attribution requirements](https://huggingface.co/Prior-Labs/TabPFN-v2-clf). Respect checkpoint-specific terms. This repository currently has no application `LICENSE` file, so public source availability is not a grant of unrestricted reuse.

Fresh weather, place queries, routes and map tiles require internet. Optional ElevenLabs is a hosted, proprietary service and may incur charges. Coordinates are sent to location providers; speech text/audio is sent to ElevenLabs when used. Local inference avoids per-request hosted-model fees, not hardware, electricity, hosting or optional API costs. The prototype has no account authentication, API rate limits or prospective evidence of behavior change.

Gemma, Tinker, MongoDB Atlas and Tiger Data are not implemented. SerpAPI remains an optional endpoint, not part of quest recommendations. Background music is not implemented. We use deterministic source adapters rather than an autonomous tool-calling agent.

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
  container-smoke.mjs     Real single-container inference and redeploy checks
deploy/                  Supervisor, model bootstrap, health check and Render env reference
docs/
  SUBMISSION.md          Visual DEV submission draft
  PUBLISHING.md          Image/demo/session publication checklist
  assets/                Architecture source and generated screenshots
scripts/
  build-post-assets.mjs   Rebuild publication figures from browser test artifacts
Dockerfile               Node + CPU Ollama + Python/TabPFN runtime
server.mjs               HTTP API and local session
ARCHITECTURE.md
```

Personal databases, model caches, `.env`, dependencies and browser artifacts are gitignored. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the data contracts and implementation boundaries.
