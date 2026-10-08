import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
loadDotEnv();
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 5177);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
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
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function extractJson(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function fallbackQuests({ profile = {}, context = {}, memories = [] }) {
  const minutes = Number(context.minutes || 15);
  const mood = context.mood || "restless";
  const goal = context.goal || profile.goals?.[0] || "reset";
  const hates = (profile.hates || []).join(", ") || "doomscrolling";
  const hobby = profile.hobbies?.[0] || "noticing small details";
  const reminder = profile.reminders?.[0] || "keep it light";
  const memoryLine = memories[0]?.text ? `Remember: ${memories[0].text}` : reminder;
  const liveHint = context.liveContext && !String(context.liveContext).includes("off.") ? context.liveContext : "";

  const easyDuration = Math.max(5, Math.min(minutes, 12));
  const usefulDuration = Math.max(8, Math.min(minutes, 20));
  const stretchDuration = Math.max(12, Math.min(minutes, 35));

  return [
    {
      lane: "Easy Win",
      title: "Two-Block Reset",
      quest_type: "movement",
      duration: easyDuration,
      physical_effort: "low",
      social_effort: "none",
      why: `Built for a ${mood} moment: simple movement before the feed can win.`,
      steps: [
        `Walk outside for ${easyDuration} minutes with no destination pressure.`,
        liveHint ? "Use the current outdoor conditions as part of the quest." : "Find three signs that the day is still happening without you refreshing it.",
        "Come back with one sentence."
      ],
      field_prompt: "What did you notice that you would have missed indoors?",
      prep: [reminder]
    },
    {
      lane: "Useful Quest",
      title: "Future-You Errand",
      quest_type: "errand",
      duration: usefulDuration,
      physical_effort: "low",
      social_effort: "low",
      why: `Connects ${goal} with a tiny practical win, while avoiding ${hates}.`,
      steps: [
        "Pick one small thing tomorrow-you will thank you for.",
        `Walk to do it, buy it, prepare it, or place it within ${usefulDuration} minutes.`,
        "Take the longer route back by one turn."
      ],
      field_prompt: "What became easier because you left the screen?",
      prep: [memoryLine]
    },
    {
      lane: "Stretch Quest",
      title: "Hobby in the Wild",
      quest_type: "curiosity",
      duration: stretchDuration,
      physical_effort: "medium",
      social_effort: "optional",
      why: `Turns ${hobby} into a real-world hunt instead of another saved post.`,
      steps: [
        `Go outside for ${stretchDuration} minutes.`,
        `Find one real-world detail connected to ${hobby}.`,
        "Give it a name like it belongs in a collection."
      ],
      field_prompt: "What would you call the thing you found?",
      prep: ["Bring water if you are going farther than usual."]
    }
  ];
}

async function generateWithOllama(payload) {
  const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL || "qwen2.5:3b";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  const prompt = `You are the quest designer for Touch Grass: Outbound, an anti-feed app.
Generate exactly 3 outdoor or out-of-home quests as a JSON array. No markdown.
Each quest must get the user away from the screen and fit one lane: Easy Win, Useful Quest, Stretch Quest.
Use short warm language. Avoid shame. Avoid dangerous tasks.
Do not suggest indoor cleaning unless the user's goal is home.
Prefer short quests that can be started today.
Use numeric duration in minutes.
Use quest_type from: movement, errand, nature, curiosity, social, creativity, home.
Use physical_effort and social_effort from: none, low, medium, high.

User profile:
${JSON.stringify(payload.profile || {}, null, 2)}

Current context:
${JSON.stringify(payload.context || {}, null, 2)}

Relevant memories:
${JSON.stringify(payload.memories || [], null, 2)}

Return objects with:
lane, title, quest_type, duration, physical_effort, social_effort, why, steps, field_prompt, prep.`;

  try {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.75 } }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Ollama ${response.status}`);
    const data = await response.json();
    const parsed = extractJson(data.response || "");
    return Array.isArray(parsed) && parsed.length ? parsed.slice(0, 3) : null;
  } finally {
    clearTimeout(timeout);
  }
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

async function rankWithTabpfn(payload, quests) {
  const tabpfnUrl = process.env.TABPFN_URL;
  if (!tabpfnUrl || !quests?.length) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(`${tabpfnUrl.replace(/\/$/, "")}/rank`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: payload.profile || {},
        context: payload.context || {},
        memories: payload.memories || [],
        history: payload.history || [],
        quests
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`TabPFN ${response.status}`);
    const data = await response.json();
    return Array.isArray(data.quests) && data.quests.length ? data.quests.slice(0, 3) : null;
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
    }
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

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const payload = await readJson(req);
      let quests = null;
      let source = "local-fallback";
      try {
        quests = await generateWithOllama(payload);
        if (quests) source = "ollama";
      } catch {
        // The local model is optional; the app remains useful without it.
      }
      if (!quests) quests = fallbackQuests(payload);

      try {
        const ranked = await rankWithTabpfn(payload, quests);
        if (ranked) return sendJson(res, 200, { source, ranker: "tabpfn", quests: ranked });
      } catch {
        // TabPFN is optional; client-side ranking remains the fallback.
      }

      return sendJson(res, 200, { source, ranker: "local", quests });
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
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Touch Grass: Outbound running at http://localhost:${port}`);
});
