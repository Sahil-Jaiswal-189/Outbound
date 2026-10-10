import test from "node:test";
import assert from "node:assert/strict";
import { createStore, DEFAULT_PROFILE } from "../backend/store.mjs";
import { createSources } from "../backend/sources.mjs";
import { ACTIVITY_CATALOG } from "../backend/catalog.mjs";
import { placeGroup, activityPlaceGroups, matchPlaceActivities, selectRouteDestinations } from "../backend/place-matching.mjs";
import { buildCandidates, filterCandidates, baselinePredictions, scoreCandidates, selectSlate, createRecommender } from "../backend/recommender.mjs";

const context = { minutes: 45, energy: "high", goal: "creativity", weather: "clear", note: "Need to buy milk and return my library book." };
const place = (id, kind, travelMinutes = 6, extra = {}) => ({ id, kind, name: `${kind} ${id}`, latitude: 12.97, longitude: 77.59,
  distanceMeters: 100, openingHours: null, route: { status: "live", data: { travelMinutes } }, ...extra });
const facts = { places: [place("park", "park"), place("books", "library", 8), place("court", "pitch", 10, { sport: "basketball" }),
  place("shop", "shop", 9)], weather: { daylight: true }, airQuality: null, sources: [] };

test("catalog-place rules attach actual activities to four kinds of mapped opportunities", () => {
  for (const id of ACTIVITY_CATALOG.map(a => a.id)) {
    assert.ok(activityPlaceGroups(id).every(group => ["green", "library", "sports", "errands"].includes(group)));
  }
  assert.equal(placeGroup(place("garden", "garden")), "green");
  assert.equal(placeGroup(place("market", "marketplace")), "errands");
  assert.equal(placeGroup(place("unknown", "community_centre")), null);
  const catalogIds = new Set(ACTIVITY_CATALOG.map(a => a.id));
  const candidates = buildCandidates(DEFAULT_PROFILE, context, facts);
  const local = candidates.filter(q => q.destination);
  assert.ok(local.length >= 15);
  assert.ok(local.length <= 48);
  assert.ok(local.every(q => catalogIds.has(q.template_id) && q.place_match.activityId === q.template_id));
  assert.ok(local.some(q => q.template_id === "outdoor-sketch" && q.destination.group === "green"));
  assert.ok(local.some(q => q.template_id === "library-return" && q.destination.kind === "library"));
  assert.ok(local.some(q => q.template_id === "ball-practice" && q.destination.kind === "pitch"));
  assert.ok(local.some(q => q.template_id === "essential-top-up" && q.destination.kind === "shop"));
  for (const q of local) {
    assert.equal(q.duration, q.travel_minutes + q.activity_minutes + q.buffer_minutes);
    assert.ok(q.duration <= context.minutes);
    assert.equal(q.buffer_minutes, 2);
    assert.equal(q.destination.accessVerified, false);
    assert.equal(q.destination.openingHoursVerified, false);
    assert.equal(q.place_match.facilitiesVerified, false);
    assert.ok(q.steps.join(" ").includes(q.destination.name));
    assert.ok(q.steps.join(" ").includes("unverified"));
  }
});

test("matching gates shopping, book returns and sports facilities instead of inventing needs", () => {
  const shop = [place("shop", "shop")], library = [place("books", "library")];
  const ids = (places, note) => matchPlaceActivities(places, { ...context, note }).matches.map(m => m.activity.id);
  assert.ok(!ids(shop, "Just want some fresh air.").includes("essential-top-up"));
  assert.ok(ids(shop, "Need to buy milk.").includes("essential-top-up"));
  assert.ok(!ids(shop, "No spending; do not buy milk.").includes("essential-top-up"));
  assert.ok(!ids(library, "I like reading.").includes("library-return"));
  assert.ok(ids(library, "Return my library book.").includes("library-return"));
  assert.ok(!ids(library, "Do not return my library book.").includes("library-return"));
  assert.ok(ids(library, "I like reading.").includes("outdoor-reading"));
  assert.ok(!ids([place("court", "pitch")], "").includes("ball-practice"));
  assert.ok(ids([place("court", "pitch", 6, { sport: "volleyball;soccer" })], "").includes("ball-practice"));
  const reading = buildCandidates(DEFAULT_PROFILE, context, { ...facts, places: library }).find(q => q.destination && q.template_id === "outdoor-reading");
  assert.ok(reading.steps[1].includes("outdoor"));
  assert.ok(reading.steps[1].includes("seating is not verified"));
});

test("unroutable, restricted and too-distant places fall back without fabricated travel or shortened activities", () => {
  const badPlaces = [
    place("unrouted", "park", 6, { route: { status: "not_configured", data: null } }),
    place("failed", "park", 6, { route: { status: "unavailable", data: null } }),
    place("private", "park", 6, { access: "private" }),
    place("closed", "shop", 6, { openingHours: "off" }),
    place("far", "library", 39),
    place("invalid", "park", -1),
  ];
  const result = matchPlaceActivities(badPlaces, context);
  assert.equal(result.matches.length, 0);
  assert.ok(result.diagnostics.some(p => p.skipped.includes("insufficient_time_at_destination")));
  assert.ok(result.diagnostics.some(p => p.skipped.includes("no_verified_walking_route")));
  assert.ok(result.diagnostics.some(p => p.skipped.includes("restricted_access")));
  assert.equal(buildCandidates(DEFAULT_PROFILE, context, { ...facts, places: badPlaces }).length, 120);
  const boundary = matchPlaceActivities([place("park", "park", 8)], { ...context, minutes: 15 });
  assert.ok(boundary.matches.length > 0);
  assert.ok(boundary.matches.every(m => m.activity.minMinutes <= 5 && m.activityMinutes === 5));
  assert.equal(matchPlaceActivities([place("park", "park", 9)], { ...context, minutes: 15 }).matches.length, 0);
});

test("route budget covers different place groups and respects the goal and a manual activity pick", () => {
  const places = [place("park-1", "park", 6, { distanceMeters: 10 }), place("park-2", "park", 6, { distanceMeters: 20 }),
    place("park-3", "park", 6, { distanceMeters: 30 }), place("books", "library", 6, { distanceMeters: 50 }),
    place("court", "pitch", 6, { distanceMeters: 60 }), place("shop", "shop", 6, { distanceMeters: 80 })];
  const selected = selectRouteDestinations(places, { ...context, goal: "errands" });
  assert.equal(selected.length, 3);
  assert.equal(selected[0].kind, "shop");
  assert.equal(new Set(selected.map(placeGroup)).size, 3);
  const preferred = selectRouteDestinations(places, context, { limit: 1, preferredTemplate: "library-return" });
  assert.equal(preferred[0].kind, "library");
});

test("source gathering routes the selected groups, retains sport tags, and reports their actual route status", async () => {
  const store = createStore(":memory:", { consoleLogs: false });
  const routedIds = [], events = [];
  const elements = ["park", "park", "park", "library", "pitch", "shop"].map((kind, i) => ({
    type: "node", id: i + 1, lat: 12.97 + i / 10000, lon: 77.59,
    tags: { name: `${kind}-${i}`, ...(kind === "shop" ? { shop: "supermarket" } : kind === "library" ? { amenity: kind } : { leisure: kind }), sport: kind === "pitch" ? "soccer" : undefined }
  }));
  try {
    const sources = createSources(store, { env: { ORS_API_KEY: "test" }, fetchImpl: async (url, options) => {
      if (String(url).includes("overpass")) return Response.json({ elements });
      if (String(url).includes("openrouteservice")) {
        routedIds.push(JSON.parse(options.body).coordinates[1]);
        return Response.json({ routes: [{ summary: { duration: 360, distance: 400 } }] });
      }
      if (String(url).includes("air-quality")) return Response.json({ current: { us_aqi: 42 } });
      return Response.json({ current: { weather_code: 1, is_day: 1 }, hourly: { time: [] } });
    } });
    const result = await sources.gather({ ...context, location: { latitude: 12.97, longitude: 77.59 } }, (stage, data) => events.push({ stage, data }),
      { preferredTemplate: "library-return" });
    assert.equal(routedIds.length, 3);
    const routed = result.places.filter(p => p.route.status === "live");
    assert.equal(new Set(routed.map(placeGroup)).size, 3);
    assert.ok(routed.some(p => p.kind === "library"));
    assert.equal(result.places.find(p => p.kind === "pitch").sport, "soccer");
    assert.equal(result.places.find(p => p.kind === "shop").shopType, "supermarket");
    assert.ok(events.some(e => e.stage === "route_selection"));
    assert.equal(result.sources.filter(s => s.source === "openrouteservice").length, 3);
    assert.ok(result.sources.filter(s => s.source === "openrouteservice").every(s => s.placeName && Number.isFinite(s.travelMinutes)));
  } finally { store.close(); }
});

test("selection ranks local opportunities but never repeats an activity or destination within a deck", () => {
  const candidates = buildCandidates(DEFAULT_PROFILE, context, facts);
  const filtered = filterCandidates(candidates, DEFAULT_PROFILE, context, facts);
  const scored = scoreCandidates(baselinePredictions(filtered.eligible, [], context), [], context, DEFAULT_PROFILE);
  assert.ok(scored.some(q => q.destination));
  assert.ok(scored.every(q => !Object.hasOwn(q.components, "placeFit")));
  const slate = selectSlate(scored, [], { random: () => 0.4 });
  assert.equal(slate.selected.length, 3);
  assert.equal(new Set(slate.selected.map(q => q.template_id)).size, 3);
  const destinations = slate.selected.filter(q => q.destination).map(q => q.destination.id);
  assert.ok(destinations.length > 0);
  assert.equal(new Set(destinations).size, destinations.length);
  const dark = filterCandidates(candidates, DEFAULT_PROFILE, context, { ...facts, weather: { daylight: false } });
  assert.ok(!dark.eligible.some(q => q.destination));
  const noWalk = filterCandidates(candidates, DEFAULT_PROFILE, { ...context, note: "No walking." }, facts);
  assert.ok(!noWalk.eligible.some(q => q.destination));
});

test("place matching is persisted and traced, and Qwen cannot replace location facts", async () => {
  const store = createStore(":memory:", { consoleLogs: false });
  try {
    const engine = createRecommender(store, { gather: async () => facts }, { env: {}, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const quests = JSON.parse(body.prompt.split("Selected activities: ")[1]);
      return Response.json({ response: JSON.stringify(quests.map(q => ({ id: q.id, title: "A Small Outdoor Quest",
        why: "Fits your day.", field_prompt: "What did you notice?", destination: { name: "Invented" }, travel_minutes: 999 }))) });
    } });
    const result = await engine.recommend("local", context, { preferredTemplate: "outdoor-sketch" });
    assert.ok(result.quests[0].destination);
    assert.equal(result.quests[0].template_id, "outdoor-sketch");
    assert.ok(result.placeMatching.matchedActivities > 0);
    const original = result.candidates.find(q => q.id === result.quests[0].id);
    assert.deepEqual(result.quests[0].destination, original.destination);
    assert.equal(result.quests[0].travel_minutes, original.travel_minutes);
    assert.deepEqual(result.quests[0].steps, original.steps);
    assert.ok(store.inspect("local").events.some(e => e.stage === "place_matching"));
    assert.ok(store.recommendation("local", result.id).placeMatching.places.length > 0);
  } finally { store.close(); }
});
