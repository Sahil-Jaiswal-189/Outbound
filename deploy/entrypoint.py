import os
from pathlib import Path
import pwd


def configure_environment(environment):
    env = dict(environment)
    data = env.get("DATA_DIR") or "/var/data"
    defaults = {
        "HOST": "0.0.0.0", "PORT": "10000", "DB_PATH": f"{data}/outbound.db",
        "OLLAMA_MODELS": f"{data}/ollama", "OLLAMA_MODEL": "qwen2.5:3b",
        "TABPFN_MODEL_CACHE_DIR": f"{data}/tabpfn", "HF_HOME": f"{data}/huggingface",
        "MPLCONFIGDIR": f"{data}/matplotlib", "XDG_CACHE_HOME": f"{data}/cache",
        "BOOTSTRAP_STATUS_PATH": "/tmp/outbound-models.json", "MODEL_BOOTSTRAP": "1",
    }
    for key, value in defaults.items():
        if not env.get(key):
            env[key] = value
    # In the all-in-one image, inference must stay on the container's loopback interface.
    env.update({"OLLAMA_HOST": "127.0.0.1:11434", "OLLAMA_URL": "http://127.0.0.1:11434",
                "TABPFN_URL": "http://127.0.0.1:8008", "DATA_DIR": data,
                "HOME": "/home/outbound"})
    return env


def prepare_directories(env, uid, gid):
    directories = {Path(env[key]) for key in (
        "DATA_DIR", "OLLAMA_MODELS", "TABPFN_MODEL_CACHE_DIR", "HF_HOME", "MPLCONFIGDIR", "XDG_CACHE_HOME")}
    directories.add(Path(env["DB_PATH"]).parent)
    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)
        if os.geteuid() == 0:
            os.chown(directory, uid, gid)
    if os.geteuid() == 0:
        for suffix in ("", "-wal", "-shm"):
            database = Path(env["DB_PATH"] + suffix)
            if database.exists():
                os.chown(database, uid, gid)


def main():
    env = configure_environment(os.environ)
    account = pwd.getpwnam("outbound")
    prepare_directories(env, account.pw_uid, account.pw_gid)
    os.environ.update(env)
    os.execvp("/usr/bin/supervisord", ["supervisord", "-n", "-c", "/app/deploy/supervisord.conf"])


if __name__ == "__main__":
    main()
