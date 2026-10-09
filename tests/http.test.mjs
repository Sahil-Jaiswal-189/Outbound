import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("HTTP workflow persists profiles, isolates demo rows, and records feedback from saved quests", { timeout: 15000 }, async () => {
  const folder = mkdtempSync(join(tmpdir(), "outbound-http-"));
  const child = spawn(process.execPath, ["server.mjs"], { cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: "0", HOST: "0.0.0.0", PUBLIC_ORIGIN: "", RENDER_EXTERNAL_URL: "", DB_PATH: join(folder, "test.db"), TABPFN_URL: "", ORS_API_KEY: "", OLLAMA_URL: "http://127.0.0.1:1" },
    stdio: ["ignore", "pipe", "pipe"] });
  let cookie = "";
  try {
    const base = await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", chunk => {
        output += chunk;
        const match = output.match(/running at (http:\/\/localhost:\d+) \(bind: 0\.0\.0\.0\)/);
        if (match) resolve(match[1]);
      });
      child.once("exit", code => reject(new Error(`Server exited ${code}`)));
    });
    async function request(path, body, session = cookie) {
      const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: {
        "content-type": "application/json", ...(session ? { cookie: session } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
      return { status: response.status, data: await response.json() };
    }
    const initial = await request("/api/bootstrap", {});
    assert.equal(initial.status, 200);
    for (const asset of ["leaflet.js", "leaflet.css", "images/marker-icon.png"]) {
      const response = await fetch(base + "/vendor/leaflet/" + asset);
      assert.equal(response.status, 200);
      assert.ok((await response.arrayBuffer()).byteLength > 100);
    }
    assert.equal((await fetch(base + "/vendor/leaflet/package.json")).status, 404);
    const photo = await fetch(base + "/outbound-path.jpg");
    assert.equal(photo.headers.get("content-type"), "image/jpeg");
    assert.ok((await photo.arrayBuffer()).byteLength > 1000);
    assert.equal((await request("/api/location/reverse", { latitude: 95, longitude: 0 })).status, 400);
    assert.equal((await request("/api/location/reverse", null)).status, 400);
    const reverse = await request("/api/location/reverse", { latitude: 12.98, longitude: 77.6 });
    assert.equal(reverse.data.status, "not_configured");
    assert.equal(reverse.data.area, null);
    assert.equal((await request("/api/location/conditions", { minutes: 15 })).status, 400);
    assert.equal((await request("/api/location/conditions", { minutes: 15, location: { latitude: 91, longitude: 0 } })).status, 400);
    const catalog = (await request("/api/activities")).data.activities;
    assert.equal(catalog.length, 120);
    const ownerCookie = cookie;
    assert.equal((await request("/api/demo/seed", { count: 60 })).data.stats.synthetic, 60);
    assert.equal((await request("/api/lab?scope=live")).data.stats.total, 0);
    assert.equal((await request("/api/demo/seed", { count: 500 })).status, 400);
    const context = { minutes: 15, energy: "low", goal: "fitness", mood: "tired" };
    const generated = await request("/api/generate", { context });
    assert.equal(generated.status, 200);
    assert.equal(generated.data.quests.length, 3);
    assert.equal(generated.data.ranker, "baseline");
    assert.equal(generated.data.candidates.length + generated.data.rejected.length, 120);
    const chosen = await request("/api/generate", { context, preferredTemplate: "texture-hunt" });
    assert.equal(chosen.data.quests[0].template_id, "texture-hunt");
    assert.equal((await request("/api/generate", { context, preferredTemplate: "not-real" })).status, 400);
    const start = await request("/api/attempts/start", { recommendationId: generated.data.id, candidateId: generated.data.quests[0].id });
    assert.equal(start.status, 201);
    assert.equal((await request("/api/lab?scope=live")).data.stats.started, 1);
    const feedback = { id: start.data.attempt.id, status: "partial", liked: null, benefit: 4, minutes: 5, note: "Bring water." };
    assert.equal((await request("/api/feedback", feedback)).status, 200);
    const inspect = (await request("/api/lab?scope=live")).data;
    assert.equal(inspect.stats.partial, 1);
    assert.equal(inspect.stats.enjoymentLabels, 0);
    assert.ok(inspect.events.some(event => event.stage === "feedback_saved"));
    cookie = "";
    assert.equal((await request("/api/bootstrap", {}, "")).data.attempts.length, 0);
    assert.equal((await request("/api/feedback", feedback)).status, 400);
    cookie = ownerCookie;
    assert.equal((await request("/api/bootstrap", {})).data.attempts[0].note, "Bring water.");
    assert.equal((await request("/api/generate", { context: { minutes: -2 } })).status, 400);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
    }
    rmSync(folder, { recursive: true });
  }
});

for (const configuration of [
  { name: "Render HTTPS origin", PUBLIC_ORIGIN: "", RENDER_EXTERNAL_URL: "https://outbound.onrender.com", origin: "https://outbound.onrender.com" },
  { name: "custom domain override", PUBLIC_ORIGIN: "https://outbound.example.com/", RENDER_EXTERNAL_URL: "https://outbound.onrender.com", origin: "https://outbound.example.com" }
]) {
  test(`${configuration.name} permits same-origin writes, rejects other origins and sets secure cookies`, { timeout: 15000 }, async () => {
    const folder = mkdtempSync(join(tmpdir(), "outbound-origin-"));
    const child = spawn(process.execPath, ["server.mjs"], { cwd: new URL("..", import.meta.url),
      env: { ...process.env, PORT: "0", HOST: "0.0.0.0", PUBLIC_ORIGIN: configuration.PUBLIC_ORIGIN,
        RENDER_EXTERNAL_URL: configuration.RENDER_EXTERNAL_URL, DB_PATH: join(folder, "test.db") },
      stdio: ["ignore", "pipe", "pipe"] });
    try {
      const base = await new Promise((resolve, reject) => {
        let output = "";
        child.stdout.on("data", chunk => {
          output += chunk;
          const match = output.match(/running at (http:\/\/localhost:\d+)/);
          if (match) resolve(match[1]);
        });
        child.once("exit", code => reject(new Error(`Server exited ${code}`)));
      });
      const request = origin => fetch(base + "/api/bootstrap", { method: "POST",
        headers: { "content-type": "application/json", origin }, body: "{}" });
      const allowed = await request(configuration.origin);
      assert.equal(allowed.status, 200);
      assert.match(allowed.headers.get("set-cookie"), /; Secure(?:;|$)/);
      for (const rejectedOrigin of [base, "https://evil.example", configuration.origin + ".evil.example"]) {
        assert.equal((await request(rejectedOrigin)).status, 403);
      }
      if (configuration.PUBLIC_ORIGIN) assert.equal((await request(configuration.RENDER_EXTERNAL_URL)).status, 403);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
      }
      rmSync(folder, { recursive: true });
    }
  });
}
