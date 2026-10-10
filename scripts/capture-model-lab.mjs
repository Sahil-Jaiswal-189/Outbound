import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { createStore } from "../backend/store.mjs";
import { createRecommender } from "../backend/recommender.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const store = createStore(":memory:", { consoleLogs: false });
const user = "publication-model-demo";
const python = process.env.LAB_PYTHON || join(root, ".venv/bin/python");
const modelEnv = { ...process.env, TABPFN_DEVICE: "cpu", TABPFN_DISABLE_TELEMETRY: "1",
  TABPFN_MODEL_CACHE_DIR: process.env.TABPFN_MODEL_CACHE_DIR || "/tmp/outbound-figure6-models",
  HF_HOME: process.env.HF_HOME || "/tmp/outbound-figure6-huggingface",
  MPLCONFIGDIR: "/tmp/outbound-figure6-matplotlib", OMP_NUM_THREADS: "2", MKL_NUM_THREADS: "2" };
let browser, server;

try {
  store.seed(user, 120, store.profile(user));
  const engine = createRecommender(store, {
    gather: async () => ({ weather: null, airQuality: null, sources: [], places: [] })
  }, { env: { TABPFN_URL: "http://local-python" }, random: () => 0,
    fetchImpl: async (url, options) => {
      if (!String(url).endsWith("/rank")) throw new Error("Publication capture uses template wording.");
      console.log("Running real TabPFN v2 evaluation and prediction on 120 synthetic outings...");
      const result = spawnSync(python, ["-c", [
        "import json, sys, torch",
        "torch.set_num_threads(2)",
        "from services.tabpfn_service import rank, RankRequest",
        "print(json.dumps(rank(RankRequest(**json.load(sys.stdin)))))"
      ].join("\n")], { cwd: root, env: modelEnv, input: options.body, encoding: "utf8",
        timeout: 300000, maxBuffer: 4_000_000 });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      const prediction = JSON.parse(result.stdout.trim());
      assert.ok(["tabpfn", "hybrid"].includes(prediction.ranker),
        "Refuse to publish a model screenshot when neither target passes validation.");
      return Response.json(prediction);
    }
  });
  const run = await engine.recommend(user, { minutes: 20, mood: "restless", energy: "low", goal: "fitness", weather: "clear" });
  assert.ok(["tabpfn", "hybrid"].includes(run.ranker), "Model failure must not silently become a publication screenshot.");
  assert.ok(new Set(run.candidates.slice(0, 8).map(q => q.score)).size > 1, "Visible scores should demonstrate variation.");
  for (const q of run.candidates) {
    assert.ok(Math.abs(q.score - (0.5 * q.completion_probability + 0.5 * q.liked_probability
      - q.components.repetitionPenalty)) < 0.0001, "Published scores must match the outcome formula.");
  }
  const snapshot = { ...store.inspect(user), workspace: "demo" };

  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["server.mjs"], { cwd: root, stdio: "ignore",
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DB_PATH: ":memory:",
      TABPFN_URL: "", ORS_API_KEY: "", ELEVENLABS_API_KEY: "", SERPAPI_KEY: "", OLLAMA_URL: "http://127.0.0.1:1",
      PUBLIC_ORIGIN: base, RENDER_EXTERNAL_URL: "" } });
  server.on("error", error => console.error(error));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null, "Temporary screenshot server exited.");
    try { ready = (await fetch(`${base}/healthz`)).ok; } catch {}
    if (ready) break;
    await sleep(100);
  }
  assert.ok(ready, "Temporary screenshot server did not start.");
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1350 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/lab?*", route => route.fulfill({ json: snapshot }));
  await page.goto(base);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Recommendation lab", exact: true }).click();
  await page.getByLabel("Available minutes", { exact: true }).selectOption("20");
  const section = page.locator(".lab-section").filter({ has: page.getByRole("heading", { name: "Latest recommendation", exact: true }) });
  const scores = section.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Scoring", exact: true }) });
  await scores.getByText("Outcome average", { exact: true }).first().waitFor();
  await section.evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 24));
  const bounds = await section.boundingBox();
  const lastRow = await scores.getByRole("row").nth(8).boundingBox();
  assert.ok(bounds && lastRow && bounds.y >= 0 && lastRow.y + lastRow.height < 1350);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(root, "docs/assets/lab-model.png"), clip: {
    x: bounds.x - 24, y: bounds.y - 16, width: bounds.width + 48,
    height: lastRow.y + lastRow.height - bounds.y + 32
  } });
  const evidence = { synthetic: true, realModelInference: true, checkpoint: "v2", historyRows: run.historyRows,
    context: run.context, ranker: run.ranker, targets: run.prediction.targets, policyVersion: run.policyVersion,
    sources: "No external sources used in this capture.", writer: run.source,
    visibleCandidates: run.candidates.slice(0, 8).map(q => ({ title: q.title, type: q.quest_type,
      completion: q.completion_probability, liking: q.liked_probability, score: q.score,
      repetitionPenalty: q.components.repetitionPenalty, scoringMode: q.scoring_mode })) };
  await writeFile(join(root, "docs/assets/lab-model.evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ screenshot: "docs/assets/lab-model.png", historyRows: run.historyRows,
    ranker: run.ranker, targets: run.prediction.targets }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill("SIGTERM");
    await stopped;
  }
  store.close();
}
