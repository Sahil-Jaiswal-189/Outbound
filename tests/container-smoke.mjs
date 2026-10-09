import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const image = process.argv[2] || "outbound:single-service-verified";
const volume = "outbound-single-service-test";
const containers = [];
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 180000, maxBuffer: 4_000_000 }).trim();
const inspect = name => JSON.parse(docker("inspect", name))[0];

async function waitFor(check, milliseconds = 300000) {
  const deadline = Date.now() + milliseconds;
  let error;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; }
    catch (caught) { error = caught; }
    await sleep(2000);
  }
  throw new Error("Container check timed out", { cause: error });
}

function launch(suffix) {
  const name = `outbound-check-${process.pid}-${suffix}`;
  docker("run", "-d", "--platform", "linux/amd64", "--name", name,
    "--mount", `source=${volume},target=/var/data`, "-e", "PORT=11000",
    "-e", "ORS_API_KEY=", "-e", "ELEVENLABS_API_KEY=", "-e", "SERPAPI_KEY=",
    "-p", "127.0.0.1::11000", image);
  containers.push(name);
  return { name, base: "http://" + docker("port", name, "11000/tcp") };
}

async function api(base, path, body, cookie) {
  const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  assert.equal(response.status, 200, `${path} status`);
  return { data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
}

async function ready(container) {
  await waitFor(async () => (await fetch(container.base + "/healthz", { signal: AbortSignal.timeout(5000) })).ok);
  let previous = "";
  return waitFor(async () => {
    const { data } = await api(container.base, "/api/status");
    const states = data.startup?.models || {};
    const current = `${states.ollama?.status}/${states.tabpfn?.status}`;
    if (current !== previous) { console.log(`Model initialization: ${current}`); previous = current; }
    assert.equal(data.elevenlabs.configured, false);
    assert.equal(data.sources.routingConfigured, false);
    return states.ollama?.status === "ready" && states.tabpfn?.status === "ready"
      && data.ollama.reachable && data.ollama.modelAvailable && data.tabpfn.reachable && data.tabpfn.health.tabpfn_available
      ? data : null;
  }, 1800000);
}

function inside(name, code) { return JSON.parse(docker("exec", name, "python", "-c", code)); }

function verifyIsolation(name) {
  const result = inside(name, `
import json, socket, subprocess
from pathlib import Path
host = socket.gethostbyname(socket.gethostname())
def reachable(address, port):
    with socket.socket() as connection:
        connection.settimeout(2)
        return connection.connect_ex((address, port)) == 0
uids = {}
for process in ('web', 'ollama', 'tabpfn'):
    pid = subprocess.check_output(['supervisorctl', '-c', '/app/deploy/supervisord.conf', 'pid', process], text=True).strip()
    uid = next(line.split()[1] for line in Path('/proc/' + pid + '/status').read_text().splitlines() if line.startswith('Uid:'))
    uids[process] = int(uid)
print(json.dumps({'uids': uids, 'internal': [reachable('127.0.0.1', port) for port in (8008, 11434)],
    'externalModels': [reachable(host, port) for port in (8008, 11434)], 'web': reachable(host, 11000),
    'secretsAbsent': not Path('/app/.env').exists() and not Path('/app/.git').exists()}))
`);
  assert.deepEqual(result.uids, { web: 10001, ollama: 10001, tabpfn: 10001 });
  assert.deepEqual(result.internal, [true, true]);
  assert.deepEqual(result.externalModels, [false, false]);
  assert.equal(result.web, true);
  assert.equal(result.secretsAbsent, true);
  const exposed = JSON.parse(docker("image", "inspect", "--format", "{{json .Config.ExposedPorts}}", image));
  assert.deepEqual(Object.keys(exposed), ["10000/tcp"]);
  assert.equal(inspect(name).NetworkSettings.Ports["11000/tcp"][0].HostIp, "127.0.0.1");
  console.log("PASS: non-root processes, internal-only model ports, no copied secrets, injected public PORT");
}

try {
  const first = launch("first");
  await ready(first);
  verifyIsolation(first.name);
  const qwen = inside(first.name, `
import json
from urllib.request import Request, urlopen
request = Request('http://127.0.0.1:11434/api/generate', data=json.dumps({'model': 'qwen2.5:3b',
    'prompt': 'Say hello in one short sentence.', 'stream': False, 'options': {'num_predict': 20}}).encode(),
    headers={'content-type': 'application/json'})
with urlopen(request, timeout=120) as response:
    result = json.load(response)
print(json.dumps({'done': result.get('done'), 'tokens': result.get('eval_count'), 'hasResponse': bool(result.get('response', '').strip())}))
`);
  assert.equal(qwen.done, true);
  assert.equal(qwen.hasResponse, true);
  assert.ok(qwen.tokens > 0);
  console.log("PASS: real Qwen CPU generation", qwen);

  const initial = await api(first.base, "/api/bootstrap", {});
  const cookie = initial.cookie;
  const profile = { ...initial.data.profile, name: "Docker verification", hobbies: ["walking"] };
  await api(first.base, "/api/profile", { profile }, cookie);
  await api(first.base, "/api/demo/seed", { count: 60 }, cookie);
  const { data: run } = await api(first.base, "/api/demo/recommend", { context: {
    minutes: 15, energy: "low", goal: "fitness", mood: "tired" } }, cookie);
  assert.equal(run.quests.length, 3);
  assert.ok(["ollama", "templates"].includes(run.source));
  if (run.source === "templates") console.warn("WARN: quest copy used the explicit template fallback; standalone Qwen generation passed.");
  for (const target of ["completed", "liked"]) {
    const detail = run.prediction.targets[target];
    assert.ok(Number.isFinite(detail.evaluation?.tabpfn_brier), `${target}: real TabPFN holdout evaluation required`);
  }
  console.log("PASS: real recommendation pipeline", { writer: run.source, ranker: run.ranker, elapsedMs: run.elapsedMs });

  const oldPid = docker("exec", first.name, "supervisorctl", "-c", "/app/deploy/supervisord.conf", "pid", "ollama");
  docker("exec", first.name, "python", "-c", `import os, signal; os.kill(${Number(oldPid)}, signal.SIGKILL)`);
  await waitFor(() => {
    const pid = docker("exec", first.name, "supervisorctl", "-c", "/app/deploy/supervisord.conf", "pid", "ollama");
    return Number(pid) > 0 && pid !== oldPid;
  }, 30000);
  console.log("PASS: Supervisor restarts a crashed Ollama worker");

  docker("stop", "-t", "45", first.name);
  assert.equal(inspect(first.name).State.ExitCode, 0, "graceful supervisor shutdown");
  const second = launch("redeploy");
  await ready(second);
  const persisted = await api(second.base, "/api/bootstrap", {}, cookie);
  assert.equal(persisted.data.profile.name, "Docker verification");
  const lab = await api(second.base, "/api/lab?scope=demo", undefined, cookie);
  assert.equal(lab.data.stats.synthetic, 60);
  assert.ok(lab.data.latestRecommendation, "saved run survives fresh-container redeploy");
  console.log("PASS: SQLite and cached checkpoints survive a fresh-container redeploy");
  console.log("Container checks complete.");
} catch (error) {
  console.error(error);
  for (const name of containers) console.error(docker("logs", "--tail", "35", name));
  process.exitCode = 1;
} finally {
  for (const name of containers) {
    try { if (inspect(name).State.Running) docker("stop", "-t", "45", name); }
    finally { docker("rm", name); }
  }
  console.log(`Verification containers removed; public model caches retained in ${volume}.`);
}
