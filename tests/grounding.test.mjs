import test from "node:test";
import assert from "node:assert/strict";
import { createStore, DEFAULT_PROFILE } from "../backend/store.mjs";
import { createSources } from "../backend/sources.mjs";
import { createRecommender, buildCandidates, filterCandidates, scoreCandidates, baselinePredictions } from "../backend/recommender.mjs";
import { sourceDetail } from "../public/source-display.js";
import { rememberedPreparation } from "../backend/explanations.mjs";

const context = { minutes: 30, mood: "tired", energy: "low", goal: "nature", weather: "clear",
  location: { latitude: 12, longitude: 77 }, note: "" };
const facts = { weather: { condition: "clear", temperature: 24, rainProbability: 45, daylight: true },
  airQuality: { aqi: 114, pm25: 35 }, sources: [], places: [{ id: "way/1", name: "Actual Garden", kind: "garden",
    latitude: 12.001, longitude: 77, route: { status: "live", data: { travelMinutes: 6 } } }] };

test("air quality retries only transient failures, coalesces requests and reports modeled values", async () => {
  const store = createStore(":memory:", { consoleLogs: false });
  let calls = 0;
  try {
    const sources = createSources(store, { env: {}, fetchImpl: async () => {
      if (++calls === 1) throw new DOMException("deadline", "TimeoutError");
      return Response.json({ current: { us_aqi: 96, pm2_5: 36.3, time: "2026-10-09T16:00" } });
    } });
    const [air, concurrent] = await Promise.all([sources.airQuality(context.location), sources.airQuality(context.location)]);
    assert.equal(calls, 2);
    assert.equal(air.status, "live");
    assert.equal(air.data.modeled, true);
    assert.equal(air.data.validAt, "2026-10-09T16:00Z");
    assert.equal(air.attempts[0].reason, "timeout");
    assert.deepEqual(concurrent.data, air.data);
    assert.equal((await sources.airQuality(context.location)).status, "cached");
    assert.equal(calls, 2);
    let limitedCalls = 0;
    const limited = createSources(store, { env: {}, fetchImpl: async () => { limitedCalls++; return new Response("limited", { status: 429 }); } });
    assert.equal((await limited.airQuality({ latitude: 13, longitude: 77 })).reason, "upstream_http_429");
    assert.equal(limitedCalls, 1);
  } finally { store.close(); }
});

test("mood is not added again during scoring and unsupported errands are excluded", () => {
  const candidates = buildCandidates(DEFAULT_PROFILE, context, facts);
  const eligible = filterCandidates(candidates, DEFAULT_PROFILE, context, facts).eligible;
  assert.ok(!eligible.some(q => ["library-return", "essential-top-up", "recycling-drop"].includes(q.template_id)));
  const score = mood => scoreCandidates(baselinePredictions(eligible, [], context), [], { ...context, mood }, DEFAULT_PROFILE);
  assert.deepEqual(score("restless"), score("curious"));
  assert.ok(score("curious").every(q => !Object.hasOwn(q.components, "moodFit")));
  const rejects = filterCandidates(candidates, DEFAULT_PROFILE, context, facts).rejected;
  assert.ok(rejects.some(q => q.template_id === "library-return" && q.reasons.includes("book_return_not_requested")));
});

test("named quests retain factual reasons, history, notes and place names despite invented model copy", async () => {
  const store = createStore(":memory:", { consoleLogs: false });
  try {
    store.migrate("user", { profile: { ...DEFAULT_PROFILE, hobbies: ["plants"] }, attempts: Array.from({ length: 4 }, (_, i) => ({
      id: `a-${i}`, quest: { title: "Nature pause", quest_type: "nature", duration: 5 }, context,
      status: "completed", liked: true, minutes: 5, note: "Bring my umbrella next time.", completedAt: new Date().toISOString()
    })) });
    const engine = createRecommender(store, { gather: async () => facts }, { env: {}, random: () => 0,
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body), selected = JSON.parse(body.prompt.split("Selected activities: ")[1]);
        return Response.json({ response: JSON.stringify(selected.map(q => ({ id: q.id, title: "Invented Venue",
          why: "Guaranteed clean air and mood improvement.", field_prompt: "How did it feel?" }))) });
      } });
    const result = await engine.recommend("user", context);
    const q = result.quests[0];
    assert.equal(q.destination.name, "Actual Garden");
    assert.ok(q.title.includes("Actual Garden"));
    assert.ok(!q.why.includes("Guaranteed"));
    assert.ok(q.evidence.reasons.some(r => r.kind === "history" && r.text.includes("4/4")));
    assert.ok(q.evidence.reasons.some(r => r.kind === "interest" && r.text.includes("plants")));
    assert.ok(q.evidence.reasons.some(r => r.kind === "note" && r.text.includes("umbrella")));
    assert.ok(q.evidence.reasons.some(r => r.kind === "air" && r.text.includes("114")));
    assert.ok(q.prep.some(p => p.includes("umbrella")));
    assert.ok(result.decisions[0].locationPreferred);
    assert.ok(store.inspect("user").events.some(e => e.stage === "explanation" && e.data.grounded));
  } finally { store.close(); }
});

test("successful routes do not override darkness checks and missing AQI is not called clean", async () => {
  const store = createStore(":memory:", { consoleLogs: false });
  try {
    const dark = { ...facts, weather: { ...facts.weather, daylight: false }, airQuality: null };
    const engine = createRecommender(store, { gather: async () => dark }, { env: {}, random: () => 0,
      fetchImpl: async () => { throw new Error("offline"); } });
    const result = await engine.recommend("night", context);
    assert.equal(result.destinations.eligible, 0);
    assert.ok(result.destinations.reasons.includes("destination_after_dark"));
    assert.ok(result.quests.every(q => !q.destination));
    assert.ok(result.quests.every(q => q.evidence.reasons.some(r => r.kind === "air" && r.text.includes("unavailable"))));
  } finally { store.close(); }
});

test("route display identifies each destination, including previously saved source rows", () => {
  assert.equal(sourceDetail({ source: "openrouteservice", placeId: "way/1", status: "live" }, facts), "Actual Garden / 6m walking round trip");
  assert.ok(sourceDetail({ source: "open-meteo-air" }, facts).includes("Modeled US AQI 114"));
});

test("personal preparation only uses the latest relevant note and respects explicit negatives", () => {
  const quest = { quest_type: "nature" };
  const attempts = [{ completedAt: "2026-10-09", quest, note: "Bring an umbrella and carry water." },
    { completedAt: "2026-10-10", quest, note: "Don't bring an umbrella; bring a snack." }];
  assert.deepEqual(rememberedPreparation(quest, attempts), ["Bring snack (from your previous note)."]);
  assert.deepEqual(rememberedPreparation({ quest_type: "social" }, attempts), []);
});
