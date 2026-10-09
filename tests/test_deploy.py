import configparser
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from deploy.bootstrap import bootstrap, prepare_ollama
from deploy.entrypoint import configure_environment, prepare_directories


class DeploymentTests(unittest.TestCase):
    def test_internal_endpoints_are_forced_but_disk_paths_remain_configurable(self):
        env = configure_environment({"DATA_DIR": "/custom", "PORT": "12345", "DB_PATH": "/custom/other.db",
                                     "OLLAMA_URL": "https://external", "OLLAMA_HOST": "0.0.0.0:11434"})
        self.assertEqual(env["DB_PATH"], "/custom/other.db")
        self.assertEqual(env["OLLAMA_MODELS"], "/custom/ollama")
        self.assertEqual(env["TABPFN_MODEL_CACHE_DIR"], "/custom/tabpfn")
        self.assertEqual(env["PORT"], "12345")
        self.assertEqual(env["OLLAMA_HOST"], "127.0.0.1:11434")
        self.assertEqual(env["OLLAMA_URL"], "http://127.0.0.1:11434")
        self.assertEqual(env["TABPFN_URL"], "http://127.0.0.1:8008")

    def test_disk_directories_are_created_without_destroying_existing_history(self):
        with tempfile.TemporaryDirectory() as folder:
            env = configure_environment({"DATA_DIR": folder})
            database = Path(env["DB_PATH"])
            database.write_bytes(b"existing history")
            with patch("deploy.entrypoint.os.geteuid", return_value=10001):
                prepare_directories(env, 10001, 10001)
            self.assertEqual(database.read_bytes(), b"existing history")
            self.assertTrue(Path(env["OLLAMA_MODELS"]).is_dir())
            self.assertTrue(Path(env["TABPFN_MODEL_CACHE_DIR"]).is_dir())

    def test_bootstrap_retries_only_failed_models_and_logs_no_exception_messages(self):
        with tempfile.TemporaryDirectory() as folder:
            env = {"BOOTSTRAP_STATUS_PATH": str(Path(folder) / "status.json")}
            ollama = Mock(side_effect=[RuntimeError("secret-value"), None])
            tabpfn, sleep, output = Mock(), Mock(), io.StringIO()
            with redirect_stdout(output):
                bootstrap(env, ollama=ollama, tabpfn=tabpfn, sleep=sleep)
            state = json.loads(Path(env["BOOTSTRAP_STATUS_PATH"]).read_text())
            self.assertEqual(state["models"]["ollama"]["status"], "ready")
            self.assertEqual(state["models"]["ollama"]["attempts"], 2)
            tabpfn.assert_called_once()
            sleep.assert_called_once_with(30)
            self.assertNotIn("secret-value", output.getvalue())
            self.assertFalse(Path(folder, "status.tmp").exists())

    def test_disabling_bootstrap_does_not_claim_models_are_ready(self):
        with tempfile.TemporaryDirectory() as folder:
            env = {"BOOTSTRAP_STATUS_PATH": str(Path(folder) / "status.json"), "MODEL_BOOTSTRAP": "0"}
            ollama, tabpfn = Mock(), Mock()
            bootstrap(env, ollama=ollama, tabpfn=tabpfn)
            state = json.loads(Path(env["BOOTSTRAP_STATUS_PATH"]).read_text())
            self.assertEqual(state["models"]["ollama"]["status"], "disabled")
            ollama.assert_not_called()
            tabpfn.assert_not_called()

    def test_cached_qwen_is_warmed_without_downloading_again(self):
        responses = [io.BytesIO(json.dumps({"models": [{"name": "qwen2.5:3b"}]}).encode()),
                     io.BytesIO(b'{"done": true}')]
        with patch("deploy.bootstrap.urlopen", side_effect=responses) as request:
            prepare_ollama({"OLLAMA_URL": "http://127.0.0.1:11434", "OLLAMA_MODEL": "qwen2.5:3b"})
        self.assertEqual(request.call_count, 2)
        warmup = request.call_args.args[0]
        self.assertTrue(warmup.full_url.endswith("/api/generate"))
        self.assertEqual(json.loads(warmup.data)["prompt"], "")

    def test_missing_qwen_is_pulled_and_download_errors_are_not_ignored(self):
        responses = [io.BytesIO(b'{"models": []}'), io.BytesIO(b'{"error": "failed"}\n')]
        with patch("deploy.bootstrap.urlopen", side_effect=responses) as request:
            with self.assertRaises(RuntimeError):
                prepare_ollama({"OLLAMA_URL": "http://127.0.0.1:11434", "OLLAMA_MODEL": "qwen2.5:3b"})
        self.assertTrue(request.call_args.args[0].full_url.endswith("/api/pull"))

    def test_supervisor_manages_processes_as_nonroot_with_group_shutdown(self):
        configuration = configparser.ConfigParser()
        configuration.read(Path(__file__).resolve().parents[1] / "deploy/supervisord.conf")
        for process in ("ollama", "tabpfn", "models", "web"):
            options = configuration[f"program:{process}"]
            self.assertEqual(options["user"], "outbound")
            self.assertTrue(options.getboolean("stopasgroup"))
            self.assertTrue(options.getboolean("killasgroup"))
        self.assertIn("--host 127.0.0.1", configuration["program:tabpfn"]["command"])
        self.assertEqual(configuration["program:models"]["autorestart"], "unexpected")


if __name__ == "__main__":
    unittest.main()
