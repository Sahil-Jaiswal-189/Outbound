# Architecture

Touch Grass: Outbound is a small app with a recommender-system idea underneath:

> Recommend real-world actions instead of content.

## Runtime Flow

```text
User profile
  hobbies, goals, dislikes, reminders

Current context
  minutes, mood, energy, locality, weather, constraint

Memory retrieval
  relevant notes from past attempts

Quest generation
  Ollama/Qwen if available, offline generator otherwise

Quest ranking
  TabPFN service if configured, local structured scorer otherwise

Field mode
  timer, quest, no feed

Reflection
  completed / partial / skipped, liked, benefit, note

Reward
  sound, badge, streak, Qwen/Gemma reward line, optional ElevenLabs voice
```

## Model Responsibilities

### Open LLM

Local Qwen through Ollama writes the three quest candidates. It is optional at runtime, but it is the intended open-weight AI core.

### Semantic Memory

The current MVP uses keyword retrieval over local notes. The natural next upgrade is an open embedding model such as `nomic-embed-text`, `bge-small-en`, or `all-MiniLM-L6-v2` to retrieve memories by meaning.

### TabPFN

TabPFN ranks candidate quests from structured history:

```text
minutes_available
mood_before
energy_before
goal_type
locality_type
weather
quest_type
quest_duration
physical_effort
social_effort
completed
liked
benefit_score
```

The app captures these fields or their equivalents. The Node server calls `TABPFN_URL/rank` when configured. The Python service uses `TabPFNClassifier` when enough history and both target classes exist; otherwise it returns a compatible heuristic ranking so the hook can still be exercised during early demos.

### SerpApi

SerpApi adds live grounding when configured: weather snippets, nearby places, seasonal context, or local events. It should enrich quests, not become the core dependency.

### ElevenLabs

ElevenLabs is used for the short reward message after the user returns and for optional dictated reflection notes. Without it, the browser speech synthesis API speaks the same generated message and the user can type notes manually.

## Data Ownership

The MVP stores all profile and quest history in `localStorage`. That keeps the first version local-first and easy to run. A production version can move history to Postgres/Tiger Data with `pgvector`, but the product idea does not require cloud storage to be useful.
