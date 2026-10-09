from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import Request, urlopen


def emit(**event):
    print(json.dumps({"stage": "model_bootstrap", **event}), flush=True)


def save_status(path, models):
    state = {"updatedAt": datetime.now(timezone.utc).isoformat(), "models": models}
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state), encoding="utf8")
    temporary.replace(path)


def prepare_ollama(env):
    base, model = env["OLLAMA_URL"], env["OLLAMA_MODEL"]
    with urlopen(base + "/api/tags", timeout=5) as response:
        available = json.load(response).get("models", [])
    canonical = model if ":" in model else model + ":latest"
    if not any(item.get("name") == canonical for item in available):
        request = Request(base + "/api/pull", data=json.dumps({"name": model, "stream": True}).encode(),
                          headers={"content-type": "application/json"})
        last_report = 0
        with urlopen(request, timeout=60) as response:
            for line in response:
                event = json.loads(line)
                if event.get("error"):
                    raise RuntimeError("Model pull failed")
                if time.monotonic() - last_report > 10:
                    emit(model="ollama", status="downloading", completed=event.get("completed"), total=event.get("total"))
                    last_report = time.monotonic()
    # Load Qwen before the first user request; do not generate a synthetic quest.
    request = Request(base + "/api/generate", data=json.dumps({"model": model, "prompt": "", "stream": False,
                      "keep_alive": "5m"}).encode(), headers={"content-type": "application/json"})
    with urlopen(request, timeout=180) as response:
        result = json.load(response)
    if result.get("error") or not result.get("done"):
        raise RuntimeError("Model warmup failed")


def prepare_tabpfn(env):
    subprocess.run([sys.executable, "-m", "deploy.prefetch_tabpfn"], env=env, check=True, timeout=1800)


def bootstrap(env, *, ollama=prepare_ollama, tabpfn=prepare_tabpfn, sleep=time.sleep):
    path = Path(env["BOOTSTRAP_STATUS_PATH"])
    models = {name: {"status": "pending"} for name in ("ollama", "tabpfn")}
    if env.get("MODEL_BOOTSTRAP") == "0":
        save_status(path, {name: {"status": "disabled"} for name in models})
        return
    while True:
        for name, prepare in (("ollama", ollama), ("tabpfn", tabpfn)):
            if models[name]["status"] == "ready":
                continue
            attempts = models[name].get("attempts", 0) + 1
            models[name] = {"status": "initializing", "attempts": attempts}
            save_status(path, models)
            emit(model=name, **models[name])
            try:
                prepare(env)
                models[name] = {"status": "ready", "attempts": attempts,
                                "detail": "model_loaded" if name == "ollama" else "checkpoint_cached"}
            except Exception as error:
                models[name] = {"status": "retrying", "attempts": attempts, "errorType": type(error).__name__}
            save_status(path, models)
            emit(model=name, **models[name])
        if all(value["status"] == "ready" for value in models.values()):
            return
        sleep(30)


if __name__ == "__main__":
    bootstrap(dict(os.environ))
