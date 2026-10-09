import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createStore, inputError } from "./backend/store.mjs";
import { createSources, validateContext } from "./backend/sources.mjs";
import { createRecommender } from "./backend/recommender.mjs";
import { ACTIVITY_CATALOG } from "./backend/catalog.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
loadDotEnv();
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 5177);
const host = process.env.HOST || "127.0.0.1";
const externalUrl = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
const publicOrigin = externalUrl ? new URL(externalUrl).origin : "";
const store = createStore(process.env.DB_PATH || join(root, "data", "outbound.db"));
const sources = createSources(store);
const recommender = createRecommender(store, sources);

function session(req, res) {
  const cookie = (req.headers.cookie || "").split(";").map(item => item.trim()).find(item => item.startsWith("outbound_session="));
  let id = cookie?.slice("outbound_session=".length);
  if (!/^[a-f0-9-]{36}$/.test(id || "")) {
    id = randomUUID();
    const secure = publicOrigin.startsWith("https://") || req.socket.encrypted ? "; Secure" : "";
    res.setHeader("set-cookie", `outbound_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}`);
  }
  store.profile(id);
  return id;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4"
};

function loadDotEnv() {
  try {
    const text = readFileSync(join(root, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const rawValue = trimmed.slice(eq + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env is optional for local demos.
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2_000_000) throw Object.assign(new Error("Request body too large."), { status: 413 });
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  try {
    const value = body ? JSON.parse(body) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object");
    return value;
  }
  catch { throw inputError("Invalid JSON."); }
}


async function generateRewardWithOllama(payload) {
  const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL || "qwen2.5:3b";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  const prompt = `Write one short enthusiastic friend-like reward message for this completed real-world quest.
Rules:
- 1 sentence only.
- Under 24 words.
- Warm, not cringe.
- No emojis.
- Mention the specific win if possible.
- Avoid shame or productivity pressure.

User profile:
${JSON.stringify(payload.profile || {}, null, 2)}

Quest attempt:
${JSON.stringify(payload.attempt || {}, null, 2)}

Return only the sentence.`;

  try {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.85 } }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Ollama ${response.status}`);
    const data = await response.json();
    const message = String(data.response || "").replace(/^["'\s]+|["'\s]+$/g, "").split(/\n+/)[0];
    return message.length > 8 ? message.slice(0, 180) : null;
  } finally {
    clearTimeout(timeout);
  }
}


async function liveContext(query) {
  if (!process.env.SERPAPI_KEY || !query) {
    return { available: false, source: "offline", summary: "Live local context is off." };
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", process.env.SERPAPI_KEY);
  url.searchParams.set("num", "5");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`SerpApi ${response.status}`);
  const data = await response.json();
  const snippets = (data.organic_results || [])
    .slice(0, 3)
    .map((item) => [item.title, item.snippet].filter(Boolean).join(": "));

  return {
    available: true,
    source: "serpapi",
    summary: snippets.join(" ") || "Live context found, but no clear snippet was returned."
  };
}

async function integrationStatus() {
  const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const status = {
    ollama: {
      configured: true,
      model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
      reachable: false
    },
    serpapi: {
      configured: Boolean(process.env.SERPAPI_KEY),
      reachable: Boolean(process.env.SERPAPI_KEY)
    },
    elevenlabs: {
      configured: Boolean(process.env.ELEVENLABS_API_KEY),
      reachable: Boolean(process.env.ELEVENLABS_API_KEY)
    },
    tabpfn: {
      configured: Boolean(process.env.TABPFN_URL),
      url: process.env.TABPFN_URL || "",
      reachable: false
    },
    database: { engine: "sqlite", persistent: true },
    sources: { weather: "open-meteo", places: "overpass", routing: "openrouteservice", routingConfigured: Boolean(process.env.ORS_API_KEY) }
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 900);
    const response = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    status.ollama.reachable = response.ok;
  } catch {
    status.ollama.reachable = false;
  }

  if (process.env.TABPFN_URL) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 900);
      const response = await fetch(`${process.env.TABPFN_URL.replace(/\/$/, "")}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      status.tabpfn.reachable = response.ok;
      if (response.ok) status.tabpfn.health = await response.json();
    } catch {
      status.tabpfn.reachable = false;
    }
  }

  return status;
}

async function elevenLabsSpeech(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  if (!apiKey || !text) return null;

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "xi-api-key": apiKey
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      voice_settings: { stability: 0.55, similarity_boost: 0.75 }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ElevenLabs ${response.status}: ${detail}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:audio/mpeg;base64,${buffer.toString("base64")}`;
}

async function elevenLabsTranscribe({ audio, mimeType }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !audio) return null;

  const match = String(audio).match(/^data:(.*?);base64,(.*)$/);
  const type = mimeType || match?.[1] || "audio/webm";
  const base64 = match?.[2] || audio;
  const buffer = Buffer.from(base64, "base64");
  const extension = type.includes("mp4") ? "mp4" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : "webm";

  const form = new FormData();
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v2");
  form.append("file", new Blob([buffer], { type }), `field-note.${extension}`);

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form
  });

  if (!response.ok) throw new Error(`ElevenLabs STT ${response.status}`);
  const data = await response.json();
  return data.text || data.transcript || "";
}

function fallbackReward({ profile = {}, attempt = {} }) {
  const name = profile.name || "Explorer";
  if (attempt.status === "completed") {
    return `Nice, ${name}. You chose the real world for ${attempt.minutes || "a few"} minutes, and that counts.`;
  }
  if (attempt.status === "partial") {
    return `Partial counts, ${name}. You interrupted the scroll loop, and that is a real rep.`;
  }
  return `Good data, ${name}. Now the next quest can fit you better.`;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      res.setHeader("cache-control", "no-store");
      const expectedOrigin = publicOrigin || `http://${req.headers.host}`;
      if (req.method === "POST" && req.headers.origin && req.headers.origin !== expectedOrigin) {
        return sendJson(res, 403, { error: "Cross-origin writes are not allowed." });
      }
    }
    const userId = url.pathname.startsWith("/api/") ? session(req, res) : null;

    if (req.method === "POST" && url.pathname === "/api/bootstrap") {
      store.migrate(userId, await readJson(req));
      return sendJson(res, 200, { profile: store.profile(userId), attempts: store.attempts(userId, 1000) });
    }
    if (req.method === "POST" && url.pathname === "/api/profile") {
      const { profile } = await readJson(req);
      const saved = store.saveProfile(userId, profile);
      store.log(userId, null, "profile_saved", { hobbies: saved.hobbies.length, goals: saved.goals.length });
      return sendJson(res, 200, { profile: saved });
    }
    if (req.method === "POST" && url.pathname === "/api/attempts/start") {
      const { recommendationId, candidateId } = await readJson(req);
      return sendJson(res, 201, { attempt: store.startAttempt(userId, recommendationId, candidateId) });
    }
    if (req.method === "POST" && url.pathname === "/api/feedback") {
      return sendJson(res, 200, { attempt: store.feedback(userId, await readJson(req)) });
    }
    if (req.method === "GET" && url.pathname === "/api/lab") {
      const scope = url.searchParams.get("scope") === "live" ? userId : `${userId}-demo`;
      store.profile(scope);
      const page = Math.min(100, Math.max(0, Math.floor(Number(url.searchParams.get("page")) || 0)));
      return sendJson(res, 200, { ...store.inspect(scope, page), workspace: scope === userId ? "live" : "demo" });
    }
    if (req.method === "POST" && url.pathname === "/api/demo/seed") {
      const { count = 60 } = await readJson(req);
      return sendJson(res, 200, { ...store.seed(`${userId}-demo`, count, store.profile(userId)), workspace: "demo" });
    }
    if (req.method === "POST" && url.pathname === "/api/demo/recommend") {
      const scope = `${userId}-demo`;
      store.saveProfile(scope, store.profile(userId));
      const { context } = await readJson(req);
      return sendJson(res, 200, await recommender.recommend(scope, context));
    }
    if (req.method === "POST" && url.pathname === "/api/location/reverse") {
      const result = await sources.reverseGeocode(await readJson(req));
      return sendJson(res, 200, { status: result.status, reason: result.reason, area: result.data?.area || null,
        attribution: result.data?.attribution || null });
    }
    if (req.method === "POST" && url.pathname === "/api/location/conditions") {
      const context = validateContext(await readJson(req));
      if (!context.location) throw inputError("Select a location first.");
      const [weather, air] = await Promise.all([sources.weather(context.location, context.minutes), sources.airQuality(context.location)]);
      store.log(userId, null, "conditions_preview", { sources: [weather, air].map(({ data, ...status }) => status) });
      return sendJson(res, 200, { weather: weather.data, airQuality: air.data,
        sources: [weather, air].map(({ data, ...status }) => status) });
    }
    if (req.method === "POST" && url.pathname === "/api/location") {
      const { query } = await readJson(req);
      const result = await sources.geocode(query);
      return sendJson(res, 200, { status: result.status, locations: result.data?.locations || [] });
    }

    if (req.method === "GET" && url.pathname === "/api/activities") {
      return sendJson(res, 200, { activities: ACTIVITY_CATALOG });
    }
    if (req.method === "POST" && url.pathname === "/api/generate") {
      const payload = await readJson(req);
      return sendJson(res, 200, await recommender.recommend(userId, payload.context, { preferredTemplate: payload.preferredTemplate }));
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      return sendJson(res, 200, await integrationStatus());
    }

    if (req.method === "POST" && url.pathname === "/api/context") {
      const { query } = await readJson(req);
      try {
        return sendJson(res, 200, await liveContext(query));
      } catch (error) {
        return sendJson(res, 200, {
          available: false,
          source: "offline",
          summary: "Live context could not be fetched. The offline quest engine is still ready.",
          error: error.message
        });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/speak") {
      const { text } = await readJson(req);
      try {
        const audio = await elevenLabsSpeech(text);
        return sendJson(res, 200, { source: audio ? "elevenlabs" : "browser", audio });
      } catch (error) {
        return sendJson(res, 200, { source: "browser", audio: null, error: error.message });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/reward") {
      const payload = await readJson(req);
      let message = null;
      try {
        message = await generateRewardWithOllama(payload);
      } catch {
        // A generated message is nice, but reward delivery must be reliable.
      }
      return sendJson(res, 200, {
        source: message ? "ollama" : "local-fallback",
        message: message || fallbackReward(payload)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/transcribe") {
      const payload = await readJson(req);
      try {
        const text = await elevenLabsTranscribe(payload);
        return sendJson(res, 200, { source: text ? "elevenlabs" : "unavailable", text: text || "" });
      } catch (error) {
        return sendJson(res, 200, { source: "unavailable", text: "", error: error.message });
      }
    }

    if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Unknown API endpoint." });
    if (url.pathname === "/vendor/lucide.js") {
      const file = await readFile(join(root, "node_modules/lucide/dist/umd/lucide.js"));
      res.writeHead(200, { "content-type": mimeTypes[".js"] });
      return res.end(file);
    }
    const leafletFiles = new Set(["leaflet.js", "leaflet.css", "images/marker-icon.png", "images/marker-icon-2x.png",
      "images/marker-shadow.png", "images/layers.png", "images/layers-2x.png"]);
    if (url.pathname.startsWith("/vendor/leaflet/")) {
      const name = url.pathname.slice("/vendor/leaflet/".length);
      if (!leafletFiles.has(name)) return sendJson(res, 404, { error: "Unknown map asset." });
      const file = await readFile(join(root, "node_modules/leaflet/dist", name));
      res.writeHead(200, { "content-type": mimeTypes[extname(name)] });
      return res.end(file);
    }
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(publicDir, safePath);
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    const file = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404);
      return res.end("Not found");
    }
    sendJson(res, error.status || 500, { error: error.status ? error.message : "The request could not be completed." });
  }
});

server.listen(port, host, () => {
  console.log(`Touch Grass: Outbound running at http://localhost:${server.address().port} (bind: ${host})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
