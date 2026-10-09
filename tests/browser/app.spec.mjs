import { test, expect } from "@playwright/test";
import { createStore } from "../../backend/store.mjs";
import { createRecommender } from "../../backend/recommender.mjs";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/location/conditions", route => route.fulfill({ json: {
    weather: { condition: "clear", temperature: 24, daylight: true, rainProbability: 5 }, airQuality: { aqi: 96, pm25: 36.3 },
    sources: [{ source: "open-meteo", status: "live" }, { source: "open-meteo-air", status: "live" }]
  } }));
});

test("destination quests and lab show actual activity-place matches and timing", async ({ page }, testInfo) => {
  const store = createStore(":memory:", { consoleLogs: false });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const facts = { weather: { daylight: true, condition: "clear", temperature: 24, rainProbability: 5 }, airQuality: { aqi: 96, pm25: 36.3 }, sources: [
      { source: "open-meteo", status: "live" }, { source: "open-meteo-air", status: "live" },
      { source: "openrouteservice", status: "live", placeId: "way/1" },
      { source: "openrouteservice", status: "cached", placeId: "node/2" }
    ], places: [
      { id: "way/1", kind: "park", name: "Neighbourhood Green", latitude: 12.97, longitude: 77.59,
        openingHours: null, route: { status: "live", data: { travelMinutes: 6 } } },
      { id: "node/2", kind: "library", name: "Neighbourhood Library", latitude: 12.972, longitude: 77.593,
        openingHours: null, route: { status: "cached", data: { travelMinutes: 8 } } }
    ] };
    const engine = createRecommender(store, { gather: async () => facts }, {
      env: {}, random: () => 0.4, fetchImpl: async () => { throw new Error("offline writer"); }
    });
    const result = await engine.recommend("visual-fixture", { minutes: 30, energy: "medium", goal: "creativity", weather: "clear",
      location: { latitude: 12.97, longitude: 77.59, label: "Sample place", area: "Sampangiram Nagar, Bengaluru, India" } },
      { preferredTemplate: "outdoor-sketch" });
    await page.route("**/api/generate", route => route.fulfill({ json: result }));
    await page.route("**/api/lab?*", route => route.fulfill({ json: { ...store.inspect("visual-fixture"), workspace: "demo" } }));
    await page.goto("/");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Generate 3 quests", exact: true }).click();
    await expect(page.locator(".quest-card")).toHaveCount(3);
    await expect(page.locator(".quest-card").first().locator(".quest-destination")).toContainText("Neighbourhood Green");
    await expect(page.locator(".quest-card").first().locator(".quest-destination")).toContainText("6m walking round trip");
    await expect(page.locator(".quest-card").first().locator(".quest-destination")).toContainText("Access and opening hours unverified");
    await page.locator(".quest-card").first().getByText("Why this quest", { exact: true }).click();
    await expect(page.locator(".quest-card").first().locator(".quest-rationale")).toContainText("Modeled US AQI 96");
    await expect(page.locator(".quest-card").first().locator(".quest-rationale")).toContainText("creativity direction");
    await page.locator(".quest-card").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("destination-quest.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Recommendation lab", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Place-to-activity matches", exact: true })).toBeVisible();
    await expect(page.locator(".lab-view")).toContainText("outdoor-sketch");
    await expect(page.locator(".run-summary")).toContainText("Sampangiram Nagar");
    await expect(page.locator(".run-summary")).not.toContainText("Sample place");
    await expect(page.getByLabel("Mood", { exact: true })).toBeVisible();
    await page.getByRole("heading", { name: "Destination candidates", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("destination-lab.png") });
    await page.getByRole("heading", { name: "Data sources", exact: true }).scrollIntoViewIfNeeded();
    const sourceTable = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Place / facts", exact: true }) });
    await expect(sourceTable).toContainText("Neighbourhood Green / 6m walking round trip");
    await expect(sourceTable).toContainText("Neighbourhood Library / 8m walking round trip");
    await expect(sourceTable).toContainText("Modeled US AQI 96");
    await page.screenshot({ path: testInfo.outputPath("source-evidence.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { store.close(); }
});

test("GPS shows pending feedback, then a persistent timeout if the browser never responds", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = () => {}; });
  await page.goto("/");
  await page.clock.runFor(400);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await expect(page.locator(".location-status")).toContainText("Locating...");
  await page.clock.fastForward(16050);
  await expect(page.locator(".location-error")).toContainText("Location lookup timed out");
  await expect(page.getByRole("button", { name: "Use current location", exact: true })).toBeEnabled();
});

test("GPS coordinates are saved immediately even if area naming fails, and conditions are visible", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = success => success({ coords: { latitude: 12.98, longitude: 77.6, accuracy: 100 } });
  });
  await page.route("**/api/location/reverse", route => route.fulfill({ json: { status: "unavailable", area: null } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await expect(page.locator(".location-status")).toContainText("12.98000, 77.60000");
  await expect(page.locator(".location-conditions")).toContainText("Modeled US AQI 96");
  await expect(page.locator(".location-conditions")).toContainText("24 C");
  await page.getByRole("button", { name: "Recommendation lab", exact: true }).click();
  await expect(page.locator(".location-conditions")).toContainText("Modeled US AQI 96");
});

test("fresh UI has no inert integration pills and voice controls preserve setup", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your quest profile", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("profile.png") });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".hook-pill, .integration-pills")).toHaveCount(0);
  await expect(page.locator(".outing-banner img")).toBeVisible();
  await expect.poll(() => page.locator(".outing-banner img").evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole("radio", { name: "30m", exact: true }).check();
  await page.locator("#context-note").fill("Bring an umbrella");
  await page.getByRole("checkbox", { name: "ElevenLabs voice", exact: true }).check();
  await expect(page.getByRole("radio", { name: "30m", exact: true })).toBeChecked();
  await expect(page.locator("#context-note")).toHaveValue("Bring an umbrella");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "ElevenLabs voice", exact: true })).toBeChecked();
  await page.getByRole("checkbox", { name: "ElevenLabs voice", exact: true }).uncheck();
  await page.screenshot({ path: testInfo.outputPath("fresh-home.png"), fullPage: true });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("newer map area lookup wins over stale results and keeps the chosen nickname", async ({ page }, testInfo) => {
  let releaseFirst, calls = 0;
  await page.route("**/api/location/reverse", async route => {
    calls++;
    if (calls === 1) {
      await new Promise(resolve => { releaseFirst = resolve; });
      await route.fulfill({ json: { status: "live", area: "Old area" } });
    } else await route.fulfill({ json: { status: "live", area: "Vasanth Nagar, Bengaluru, India" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Set starting point", exact: true }).click();
  await page.getByLabel("Latitude", { exact: true }).fill("12.97");
  await page.getByLabel("Longitude", { exact: true }).fill("77.59");
  await page.getByLabel("Place name", { exact: true }).fill("My gate");
  await expect.poll(() => calls).toBe(1);
  await page.getByLabel("Latitude", { exact: true }).fill("12.98");
  await page.getByLabel("Place name", { exact: true }).focus();
  await expect(page.locator(".map-area")).toContainText("Vasanth Nagar");
  const response = page.waitForResponse(response => response.url().endsWith("/api/location/reverse"));
  releaseFirst(); await response;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator(".map-area")).not.toContainText("Old area");
  await expect(page.getByLabel("Place name", { exact: true })).toHaveValue("My gate");
  await page.screenshot({ path: testInfo.outputPath("map-area.png") });
  await page.getByRole("button", { name: "Use starting point", exact: true }).click();
  await expect(page.locator(".location-status")).toContainText("My gate / Vasanth Nagar");
  await page.getByRole("button", { name: "Recommendation lab", exact: true }).click();
  await expect(page.locator(".location-status")).toContainText("My gate / Vasanth Nagar");
  await page.reload();
  await expect(page.locator(".location-status")).toContainText("My gate / Vasanth Nagar");
});

test("unavailable area lookup uses coordinates, not a sample place", async ({ page }) => {
  await page.route("**/api/location/reverse", route => route.fulfill({ json: { status: "unavailable", reason: "timeout", area: null } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Set starting point", exact: true }).click();
  await page.getByLabel("Latitude", { exact: true }).fill("12.98");
  await page.getByLabel("Longitude", { exact: true }).fill("77.6");
  await page.getByRole("button", { name: "Use starting point", exact: true }).click();
  await expect(page.locator(".location-status")).toContainText("12.98000, 77.60000");
  await expect(page.locator(".location-status")).not.toContainText("My starting point");
});

test("all 120 activities are browsable, searchable and selectable", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator('.choice-tile:has(input[name="minutes"][value="5"])').click();
  await expect(page.getByRole("radio", { name: "5m", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Browse activities", exact: true }).click();
  await expect(page.locator(".library-count")).toHaveText("120 of 120 activities");
  await expect(page.locator(".library-item")).toHaveCount(12);
  await page.screenshot({ path: testInfo.outputPath("activity-library-full.png") });
  await page.getByRole("button", { name: "Next activities", exact: true }).click();
  await expect(page.locator(".library-pagination")).toContainText("2 / 10");
  await page.getByLabel("Activity category", { exact: true }).selectOption("nature");
  await expect(page.locator(".library-count")).toHaveText("20 of 120 activities");
  await page.getByLabel("Within my time", { exact: true }).check();
  expect(await page.locator(".library-item").count()).toBeGreaterThan(0);
  await page.getByLabel("Activity category", { exact: true }).selectOption("");
  await page.getByRole("searchbox", { name: "Search activities", exact: true }).fill("three textures");
  await expect(page.locator(".library-item")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("activity-library.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Choose Three Textures", exact: true }).click();
  await expect(page.locator(".chosen-activity")).toContainText("Three Textures");
  await page.getByRole("button", { name: "Generate 3 quests", exact: true }).click();
  await expect(page.locator(".quest-card")).toHaveCount(3);
  const run = await page.request.get("/api/lab?scope=live").then(r => r.json());
  expect(run.latestRecommendation.quests[0].template_id).toBe("texture-hunt");
  expect(run.latestRecommendation.decisions[0].decision).toBe("user_pick");
  await expect(page.locator(".chosen-activity")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("demo lab and personal quest feedback stay separate", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.speechSynthesis.speak = utterance => setTimeout(() => utterance.onend?.(), 0);
    window.speechSynthesis.cancel = () => {};
  });
  await page.route("**/api/reward", route => route.fulfill({ json: { message: "Nice work getting outside." } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your quest profile" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate 3 quests" })).toBeEnabled();
  await expect(page.getByLabel("Use current location")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("quests.png"), fullPage: true });
  await page.getByRole("button", { name: "Recommendation lab", exact: true }).click();
  await expect(page.getByRole("button", { name: "Seed demo data" })).toBeEnabled();
  await page.getByRole("button", { name: "Seed demo data" }).click();
  await expect(page.getByText("60 synthetic rows saved to SQLite.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run demo recommendation" })).toBeEnabled();
  await page.getByRole("button", { name: "Run demo recommendation" }).click();
  await expect(page.getByRole("heading", { name: "Candidate scores", exact: true })).toBeVisible();
  await expect(page.locator(".lab-selected li")).toHaveCount(3);
  const summary = await page.request.get("/api/lab?scope=demo").then(response => response.json());
  expect(summary.stats.total).toBe(60);
  expect(summary.latestRecommendation.ranker).toBe("baseline");
  expect(summary.events.some(event => event.stage === "selection")).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("lab.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Quests", exact: true }).click();
  await page.getByRole("button", { name: "Generate 3 quests" }).click();
  await expect(page.locator(".quest-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Start", exact: true }).first().click();
  await expect(page.locator(".field-mode")).toBeVisible();
  expect(await page.locator(".field-card").evaluate(card => card.getBoundingClientRect().top >= 0 && card.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("field-timer.png") });
  await page.getByRole("button", { name: "I'm back" }).click();
  await page.screenshot({ path: testInfo.outputPath("reflection.png") });
  await page.getByLabel("Result", { exact: true }).selectOption("partial");
  await page.getByLabel("Did it feel worth it?").selectOption("true");
  await page.getByLabel("Benefit score").selectOption("4");
  await page.locator("#note").fill("Bring water next time.");
  await page.getByRole("button", { name: "Save and reward" }).click();
  await expect(page.locator(".timeline-item")).toHaveCount(1);
  const personal = await page.request.get("/api/lab?scope=live").then(response => response.json());
  expect(personal.stats.total).toBe(1);
  expect(personal.stats.partial).toBe(1);
  expect(personal.stats.synthetic).toBe(0);
  expect(personal.attempts[0].note).toBe("Bring water next time.");
  await page.reload();
  await expect(page.locator(".timeline-item")).toHaveCount(1);
  expect(errors).toEqual([]);
});

for (const [code, message] of [[1, "permission was denied"], [2, "could not determine your position"], [3, "lookup timed out"]]) {
  test(`GPS error ${code} has a specific persistent message`, async ({ page }) => {
    await page.addInitScript(code => {
      navigator.geolocation.getCurrentPosition = (_success, error) => error({ code });
    }, code);
    await page.goto("/");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Use current location", exact: true }).click();
    await expect(page.locator(".location-error")).toContainText(message);
    await expect(page.getByRole("button", { name: "Use current location", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Set starting point", exact: true })).toBeVisible();
  });
}

test("manual starting point works without map tiles and cannot be overwritten by late GPS", async ({ page }, testInfo) => {
  await page.route("**/api/location/reverse", route => route.fulfill({ json: { status: "live", area: "Vasanth Nagar, Bengaluru, India" } }));
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = success => { window.lateGps = success; };
  });
  await page.route("https://tile.openstreetmap.org/**", route => route.abort());
  await page.route("**/api/location", route => route.fulfill({ json: { locations: [
    { latitude: 12.97, longitude: 77.59, label: "Bengaluru", approximate: true }
  ] } }));
  const requests = [];
  await page.route("**/api/demo/recommend", route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await page.getByRole("button", { name: "Set starting point", exact: true }).click();
  await page.getByLabel("Find area", { exact: true }).fill("Bengaluru");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Bengaluru", exact: true }).click();
  await expect(page.getByLabel("Latitude", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Longitude", { exact: true })).toHaveValue("");
  await page.locator(".location-map").click({ position: { x: 130, y: 100 } });
  await expect(page.locator(".leaflet-marker-icon")).toBeVisible();
  await expect.poll(() => page.locator(".leaflet-marker-icon").evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByLabel("Latitude", { exact: true }).fill("12.981");
  await page.getByLabel("Longitude", { exact: true }).fill("77.601");
  await page.getByLabel("Place name", { exact: true }).fill("My park gate");
  await page.screenshot({ path: testInfo.outputPath("starting-point.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Use starting point", exact: true }).click();
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  await page.evaluate(() => window.lateGps({ coords: { latitude: 1, longitude: 2 } }));
  await expect(page.locator(".location-status")).toContainText("My park gate");
  await expect(page.locator(".location-status")).toContainText("Vasanth Nagar");
  await page.getByRole("button", { name: "Recommendation lab", exact: true }).click();
  await page.getByRole("button", { name: "Run demo recommendation" }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].context.location).toMatchObject({ latitude: 12.981, longitude: 77.601, approximate: false, method: "manual", area: "Vasanth Nagar, Bengaluru, India", alias: "My park gate" });
  await page.reload();
  await expect(page.locator(".location-status")).toContainText("My park gate");
});

test("lab location selection, sharing, and removal reach the demo request", async ({ page }) => {
  await page.route("**/api/location/reverse", route => route.fulfill({ json: { status: "live", area: "Vasanth Nagar, Bengaluru, India" } }));
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = success => success({ coords: { latitude: 12.98, longitude: 77.6 } });
  });
  await page.route("**/api/location", route => route.fulfill({ json: { status: "live", locations: [
    { latitude: 12.97, longitude: 77.59, label: "Bengaluru, Karnataka, India", approximate: true }
  ] } }));
  const requests = [];
  await page.route("**/api/demo/recommend", route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your quest profile" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Recommendation lab", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run demo recommendation" })).toBeEnabled();
  await page.getByRole("button", { name: "Choose area", exact: true }).click();
  await page.getByRole("textbox", { name: "Town or city" }).fill("Bengaluru");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Bengaluru, Karnataka, India", exact: true }).click();
  await expect(page.locator(".location-status")).toContainText("Bengaluru");
  await page.getByRole("button", { name: "Run demo recommendation" }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].context.location.approximate).toBe(true);
  await expect(page.getByRole("button", { name: "Run demo recommendation" })).toBeEnabled();
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await expect(page.locator(".location-status")).toContainText("Vasanth Nagar");
  await page.getByRole("button", { name: "Run demo recommendation" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].context.location).toMatchObject({ latitude: 12.98, longitude: 77.6, approximate: false });
  await expect(page.getByRole("button", { name: "Run demo recommendation" })).toBeEnabled();
  await page.getByRole("button", { name: "Remove location", exact: true }).click();
  await expect(page.locator(".location-status")).toContainText("Not shared");
  await page.getByRole("button", { name: "Run demo recommendation" }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2].context.location).toBeNull();
});
