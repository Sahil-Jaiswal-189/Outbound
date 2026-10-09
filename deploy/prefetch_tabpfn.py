import json


def main():
    from tabpfn.constants import ModelVersion
    from tabpfn.model_loading import download_model, resolve_model_path

    paths, _, names, _ = resolve_model_path(None, "classifier", version="v2")
    result = download_model(paths[0], version=ModelVersion.V2, which="classifier", model_name=names[0])
    if result != "ok" or not paths[0].is_file() or paths[0].stat().st_size == 0:
        raise RuntimeError("Checkpoint download failed")
    print(json.dumps({"stage": "model_bootstrap", "model": "tabpfn", "status": "checkpoint_cached"}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"stage": "model_bootstrap", "model": "tabpfn", "status": "failed",
                          "errorType": type(error).__name__}), flush=True)
        raise SystemExit(1) from None
