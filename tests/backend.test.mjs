import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, DEFAULT_PROFILE } from "../backend/store.mjs";
import { createSources, validateContext } from "../backend/sources.mjs";
import { buildCandidates, filterCandidates, scoreCandidates, selectSlate, baselinePredictions, createRecommender } from "../backend/recommender.mjs";
import { ACTIVITY_CATALOG } from "../backend/catalog.mjs";

const context = { minutes: 20, mood: "tired", energy: "low", goal: "fitness", locality: "residential", weather: "clear" };
const facts = { weather: null, airQuality: null, places: [], sources: [] };

test("area lookup validates coordinates, authenticates without URL secrets, coalesces and caches", async () => {
  const store = createStore(":memory:", { consoleLogs: false });
  const point = { latitude: 12.98, longitude: 77.6 };
  let calls = 0;
  try {
    const sources = createSources(store, { env: { ORS_API_KEY: "secret-test-key" }, fetchImpl: async (url, options) => {
      calls++;
      assert.equal(options.headers.Authorization, "secret-test-key");
      assert.ok(!String(url).includes("secret-test-key"));
      assert.equal(new URL(url).searchParams.get("point.lat"), "12.98");
      return Response.json({ features: [{ properties: { label: "Vasanth Nagar, Bengaluru, India", layer: "neighbourhood" } }] });
    } });
    const results = await Promise.all([sources.reverseGeocode(point), sources.reverseGeocode(point)]);
    assert.equal(calls, 1);
    assert.equal(results[0].data.area, "Vasanth Nagar, Bengaluru, India");
    assert.equal((await sources.reverseGeocode(point)).status, "cached");
    await assert.rejects(sources.reverseGeocode({ latitude: 91, longitude: 0 }), /coordinates/);
    await assert.rejects(sources.reverseGeocode(null), /coordinates/);
    assert.equal((await createSources(store, { env: {} }).reverseGeocode(point)).reason, "missing_api_key");
    for (const [fetchImpl, reason] of [
      [async () => { throw new DOMException("deadline", "TimeoutError"); }, "timeout"],
      [async () => Response.json({ features: [] }), "invalid_geocoding_response"],
      [async () => new Response("limited", { status: 429 }), "upstream_http_429"]
    ]) {
      const failed = await createSources(store, { env: { ORS_API_KEY: "test" }, fetchImpl }).reverseGeocode({ latitude: 13, longitude: 78 });
      assert.equal(failed.status, "unavailable");
      assert.equal(failed.reason, reason);
      assert.equal(failed.data, null);
    }
  } finally { store.close(); }
});

test("SQLite persists migration once and demo seeds never change personal attempts", () => {
  const folder = mkdtempSync(join(tmpdir(), "outbound-test-"));
  const path = join(folder, "test.db");
  let store = createStore(path, { consoleLogs: false });
  try {
    const attempt = { id: "old", quest: { title: "Walk", quest_type: "movement", duration: 10 },
      status: "partial", liked: null, minutes: 5, completedAt: new Date().toISOString() };
    store.migrate("personal", { profile: DEFAULT_PROFILE, attempts: [attempt] });
    store.migrate("personal", { attempts: [{ ...attempt, id: "duplicate" }] });
    store.seed("personal-demo", 60, DEFAULT_PROFILE);
    assert.equal(store.attempts("personal").length, 1);
    assert.equal(store.history("personal")[0].liked, null);
    assert.deepEqual(store.attempts("personal")[0].context, {});
    assert.equal(store.inspect("personal-demo").stats.synthetic, 60);
    store.seed("personal-demo", 40, DEFAULT_PROFILE);
    assert.equal(store.inspect("personal-demo").stats.total, 40);
    store.close(); store = createStore(path, { consoleLogs: false });
    assert.equal(store.attempts("personal")[0].status, "partial");
    assert.equal(store.inspect("personal-demo").stats.total, 40);
  } finally { store.close(); rmSync(folder, { recursive: true }); }
});

test("recommendation ownership and idempotent feedback preserve missing labels and server facts", () => {
  const store = createStore(":memory:", { consoleLogs: false });
  try {
    store.profile("one"); store.profile("two");
    store.saveRecommendation("one", { id: "rec", context, quests: [{ id: "q", title: "Walk", quest_type: "movement", duration: 10 }] });
    assert.throws(() => store.startAttempt("two", "rec", "q"), /saved recommendation/);
    const attempt = store.startAttempt("one", "rec", "q");
    assert.equal(store.history("one").length, 0);
    const feedback = { id: attempt.id, status: "partial", liked: null, benefit: null, minutes: 5, note: "Bring water", quest: { title: "Forged" } };
    store.feedback("one", feedback); store.feedback("one", feedback);
    assert.equal(store.attempts("one").length, 1);
    assert.equal(store.attempts("one")[0].quest.title, "Walk");
    assert.equal(store.history("one")[0].liked, null);
    assert.equal(store.history("one")[0].completed, false);
    assert.throws(() => store.feedback("two", feedback), /Start this quest/);
  } finally { store.close(); }
});

test("candidate constraints account for travel, effort, dislikes, and severe weather", () => {
  const withPlace = { ...facts, places: [{ id: "way/1", name: "Park", kind: "park", latitude: 1, longitude: 1,
    route: { status: "live", data: { travelMinutes: 10 } } }] };
  const all = buildCandidates(DEFAULT_PROFILE, context, withPlace);
  assert.ok(all.some(q => q.destination));
  assert.ok(all.every(q => q.duration <= context.minutes));
  const filtered = filterCandidates(all, { ...DEFAULT_PROFILE, hates: ["awkward social tasks"] }, context, withPlace);
  assert.ok(filtered.rejected.some(q => q.reasons.includes("low_energy")));
  assert.ok(filtered.rejected.some(q => q.reasons.includes("disliked_social_activity")));
  assert.ok(filtered.eligible.every(q => q.physical_effort === "low"));
  assert.equal(filterCandidates(all, DEFAULT_PROFILE, context, { ...facts, weather: { thunderstorm: true } }).eligible.length, 0);
  assert.equal(filterCandidates(all, DEFAULT_PROFILE, { ...context, weather: "thunderstorm" }, facts).eligible.length, 0);
  assert.ok(!buildCandidates(DEFAULT_PROFILE, context, { ...withPlace, places: [{ ...withPlace.places[0], route: { data: null } }] }).some(q => q.destination));
  assert.throws(() => validateContext({ ...context, location: { latitude: 99, longitude: 0 } }), /coordinates/);
});

test("selection is diverse and logs the conditional probability for exploration", () => {
  const candidates = buildCandidates(DEFAULT_PROFILE, context, facts);
  const history = [{ quest_type: "movement", completed: true, liked: null }];
  const scores = scoreCandidates(baselinePredictions(candidates, history, context), history, context, DEFAULT_PROFILE);
  const slate = selectSlate(scores, history, { random: () => 0 });
  assert.equal(slate.selected.length, 3);
  assert.equal(new Set(slate.selected.map(q => q.quest_type)).size, 3);
  assert.equal(slate.decisions[2].decision, "explore");
  const third = slate.decisions[2];
  assert.ok(third.selectionProbability > 0 && third.selectionProbability <= 1);
  assert.equal(third.selectionProbability, (third.exploitationCandidateIds.includes(third.candidateId) ? 0.85 / third.exploitationCandidateIds.length : 0)
    + 0.15 / third.explorationCandidateIds.length);
  const probabilityMass = third.eligibleCandidateIds.reduce((sum, id) => sum
    + (third.exploitationCandidateIds.includes(id) ? 0.85 / third.exploitationCandidateIds.length : 0)
    + (third.explorationCandidateIds.includes(id) ? 0.15 / third.explorationCandidateIds.length : 0), 0);
  assert.ok(Math.abs(probabilityMass - 1) < 1e-10);
  assert.equal(baselinePredictions(candidates.slice(0, 1), history, context)[0].liked_probability, 0.5);
});

test("catalog has 120 distinct activities and respects real minimum time, daylight and dry-ground constraints", () => {
  assert.equal(ACTIVITY_CATALOG.length, 120);
  for (const key of ["id", "title", "action"]) assert.equal(new Set(ACTIVITY_CATALOG.map(a => a[key])).size, 120);
  for (const type of ["movement", "nature", "curiosity", "creativity", "social", "errand"]) {
    assert.equal(ACTIVITY_CATALOG.filter(a => a.type === type).length, 20);
  }
  const short = { ...context, minutes: 5 };
  const candidates = buildCandidates(DEFAULT_PROFILE, short, facts);
  assert.equal(candidates.length, 120);
  const filtered = filterCandidates(candidates, DEFAULT_PROFILE, short, facts);
  assert.ok(filtered.eligible.length > 30);
  assert.ok(filtered.eligible.every(q => q.duration <= 5));
  assert.ok(filtered.rejected.some(q => q.reasons.includes("time_budget")));
  const darkWet = filterCandidates(buildCandidates(DEFAULT_PROFILE, context, facts), DEFAULT_PROFILE,
    { ...context, weather: "rainy" }, { ...facts, weather: { daylight: false, precipitation: 1 } });
  assert.ok(darkWet.rejected.some(q => q.reasons.includes("needs_daylight")));
  assert.ok(darkWet.rejected.some(q => q.reasons.includes("needs_dry_ground")));
});

test("offered quests rotate even without completed history and remain scoped to their workspace", async () => {
  const store = createStore(":memory:", { consoleLogs: false });
  try {
    const engine = createRecommender(store, { gather: async () => facts }, {
      env: {}, random: () => 0, fetchImpl: async () => { throw new Error("offline"); }
    });
    const seen = new Set();
    for (let i = 0; i < 10; i++) {
      const recent = store.recentOffers("rotating");
      const result = await engine.recommend("rotating", context);
      assert.equal(result.quests.length, 3);
      assert.ok(result.quests.every(q => !recent.includes(q.template_id)));
      result.quests.forEach(q => seen.add(q.template_id));
      assert.ok(result.decisions.every(d => d.noveltyPreferred));
    }
    assert.ok(seen.size >= 27);
    assert.equal(store.history("rotating").length, 0);
    assert.deepEqual(store.recentOffers("other"), []);
    const preferred = await engine.recommend("rotating", context, { preferredTemplate: "texture-hunt" });
    assert.equal(preferred.quests[0].template_id, "texture-hunt");
    assert.equal(preferred.decisions[0].selectionProbability, 1);
    assert.equal(preferred.decisions[0].decision, "user_pick");
    await assert.rejects(engine.recommend("rotating", { ...context, minutes: 5 }, { preferredTemplate: "jog-walk" }), /does not fit/);
    await assert.rejects(engine.recommend("rotating", context, { preferredTemplate: "made-up" }), /Unknown activity/);
  } finally { store.close(); }
});

test("Overpass has bounded failover, cache reuse, request coalescing and a failure cooldown", async () => {
  const store = createStore(":memory:", { consoleLogs: false });
  const location = { latitude: 12, longitude: 77 };
  const calls = [];
  try {
    const sources = createSources(store, { env: {}, fetchImpl: async url => {
      calls.push(String(url));
      if (String(url).includes("overpass-api.de")) throw new DOMException("deadline", "TimeoutError");
      return Response.json({ elements: [{ type: "node", id: 1, lat: 12, lon: 77, tags: { name: "Garden", leisure: "garden" } }] });
    } });
    const [first, concurrent] = await Promise.all([sources.places(location, 200), sources.places(location, 200)]);
    assert.equal(first.status, "live");
    assert.equal(concurrent.data.places.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(first.data.attempts[0].reason, "timeout");
    assert.ok(calls[1].includes("private.coffee"));
    assert.equal((await sources.places(location, 200)).status, "cached");
    assert.equal(calls.length, 2);

    let failedCalls = 0;
    const custom = createSources(store, { env: { OVERPASS_URL: "https://private.example/api/interpreter" }, fetchImpl: async () => {
      failedCalls++; throw new DOMException("deadline", "TimeoutError");
    } });
    assert.equal((await custom.places(location, 300)).status, "unavailable");
    assert.ok((await custom.places(location, 300)).retryAfterSeconds > 0);
    assert.equal(failedCalls, 1);
    const limited = createSources(store, { env: {}, fetchImpl: async () => { failedCalls++; return new Response("limited", { status: 429 }); } });
    assert.equal((await limited.places(location, 400)).reason, "upstream_http_429");
    assert.equal(failedCalls, 2);
  } finally { store.close(); }
});

test("Overpass allows queueing time on both endpoints with a bounded query execution limit", async t => {
  const store = createStore(":memory:", { consoleLogs: false });
  const deadlines = [], queries = [];
  t.mock.method(AbortSignal, "timeout", milliseconds => {
    deadlines.push(milliseconds);
    return new AbortController().signal;
  });
  try {
    const sources = createSources(store, { env: {}, fetchImpl: async (url, options) => {
      queries.push(new URLSearchParams(options.body).get("data"));
      if (queries.length === 1) throw new DOMException("deadline", "TimeoutError");
      return Response.json({ elements: [{ type: "node", id: 1, lat: 12, lon: 77,
        tags: { name: "Neighbourhood Garden", leisure: "garden" } }] });
    } });
    const result = await sources.places({ latitude: 12, longitude: 77 }, 200);
    assert.equal(result.status, "live");
    assert.equal(result.data.places[0].name, "Neighbourhood Garden");
    assert.deepEqual(deadlines, [35000, 35000]);
    assert.equal(queries.length, 2);
    assert.ok(queries.every(query => query.startsWith("[out:json][timeout:15];")));
  } finally { store.close(); }
});

test("routing diagnoses missing configuration independently of failed place discovery", async () => {
  const store = createStore(":memory:", { consoleLogs: false });
  try {
    const mockFetch = async url => {
      if (String(url).includes("overpass")) throw new DOMException("deadline", "TimeoutError");
      if (String(url).includes("air-quality")) return Response.json({ current: { us_aqi: 42 } });
      return Response.json({ current: { weather_code: 1 }, hourly: { time: [] } });
    };
    const ctx = { ...context, location: { latitude: 12, longitude: 77 } };
    for (const [env, reason] of [[{}, "missing_api_key"], [{ ORS_API_KEY: "test" }, "places_unavailable"]]) {
      const gathered = await createSources(store, { env, fetchImpl: mockFetch }).gather(ctx, () => {});
      assert.equal(gathered.sources.find(s => s.source === "openrouteservice").reason, reason);
    }
  } finally { store.close(); }
});

test("source adapters cache facts, exclude private places, and use round-trip pedestrian routing", async () => {
  const store = createStore(":memory:", { consoleLogs: false });
  const calls = [];
  const mockFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    let data;
    if (String(url).includes("overpass")) data = { elements: [
      { type: "node", id: 1, lat: 12, lon: 77, tags: { name: "Public Garden", leisure: "garden" } },
      { type: "node", id: 2, lat: 12, lon: 77, tags: { name: "Private Garden", leisure: "garden", access: "private" } }
    ] };
    else if (String(url).includes("openrouteservice")) data = { routes: [{ summary: { duration: 420, distance: 500 } }] };
    else if (String(url).includes("air-quality")) data = { current: { us_aqi: 42, pm2_5: 8 } };
    else data = { current: { weather_code: 1, temperature_2m: 22, apparent_temperature: 22, is_day: 1, wind_speed_10m: 5 },
      hourly: { time: [], precipitation_probability: [] }, daily: { sunset: ["2026-10-09T18:00"] } };
    return Response.json(data);
  };
  try {
    const sources = createSources(store, { fetchImpl: mockFetch, env: { ORS_API_KEY: "test-key" } });
    const ctx = { ...context, location: { latitude: 12, longitude: 77 } };
    const first = await sources.gather(ctx, () => {});
    assert.equal(first.places.length, 1);
    assert.equal(first.places[0].route.data.travelMinutes, 7);
    const route = calls.find(call => call.url.includes("openrouteservice"));
    assert.deepEqual(JSON.parse(route.options.body).coordinates, [[77, 12], [77, 12], [77, 12]]);
    const second = await sources.gather(ctx, () => {});
    assert.equal(calls.length, 4);
    assert.ok(second.sources.every(source => source.status === "cached"));
    const area = await sources.gather({ ...ctx, location: { ...ctx.location, approximate: true } }, () => {});
    assert.equal(area.places.length, 0);
    assert.ok(area.sources.some(source => source.reason === "area_location_only"));
  } finally { store.close(); }
});

test("recommender reports fallback honestly, preserves candidate identity, and logs persisted decisions", async () => {
  const store = createStore(":memory:", { consoleLogs: false });
  const mockFetch = async (url, options) => {
    if (String(url).includes("/rank")) {
      const payload = JSON.parse(options.body);
      return Response.json({ ranker: "baseline", targets: { liked: { mode: "baseline", reason: "insufficient_history" } },
        quests: payload.quests.map(q => ({ id: q.id, completion_probability: 0.7, liked_probability: 0.6 })) });
    }
    throw new Error("Writer unavailable");
  };
  try {
    const engine = createRecommender(store, { gather: async () => facts }, { fetchImpl: mockFetch, env: { TABPFN_URL: "http://ranker" }, random: () => 1 });
    const result = await engine.recommend("user", context);
    assert.equal(result.ranker, "baseline");
    assert.equal(result.source, "templates");
    assert.equal(result.quests.length, 3);
    assert.ok(result.quests.every(q => result.candidates.some(c => c.id === q.id)));
    assert.equal(store.recommendation("user", result.id).decisions.length, 3);
    assert.ok(store.inspect("user").events.some(event => event.stage === "prediction" && event.data.mode === "baseline"));
  } finally { store.close(); }
});

test("Qwen copy cannot change the selected facts or replace candidate ids", async () => {
  const store = createStore(":memory:", { consoleLogs: false });
  let corrupt = false;
  const mockFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.ok(body.format.items.properties.id);
    const activities = JSON.parse(body.prompt.split("Selected activities: ")[1]);
    return Response.json({ response: JSON.stringify(activities.map(q => ({
      id: corrupt ? "wrong-id" : q.id, title: "A Personal Outdoor Break", why: "A gentle activity for your day.",
      field_prompt: "What did you enjoy?", duration: 999, steps: ["Invented activity"]
    }))) });
  };
  try {
    const engine = createRecommender(store, { gather: async () => facts }, { fetchImpl: mockFetch, env: {}, random: () => 1 });
    const result = await engine.recommend("copy-user", context);
    assert.equal(result.source, "ollama");
    for (const quest of result.quests) {
      const original = result.candidates.find(q => q.id === quest.id);
      assert.equal(quest.duration, original.duration);
      assert.deepEqual(quest.steps, original.steps);
      assert.equal(quest.title, "A Personal Outdoor Break");
    }
    corrupt = true;
    assert.equal((await engine.recommend("copy-user", context)).source, "templates");
  } finally { store.close(); }
});
