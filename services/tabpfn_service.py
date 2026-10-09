from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from collections import OrderedDict
from typing import Any

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

load_dotenv()
os.environ.setdefault("TABPFN_NO_BROWSER", "1")

try:
    from tabpfn import TabPFNClassifier
    from tabpfn.constants import ModelVersion
    IMPORT_ERROR = None
except Exception as error:
    TabPFNClassifier = None
    IMPORT_ERROR = type(error).__name__

app = FastAPI(title="Outbound outcome predictor")
logger = logging.getLogger("outbound.tabpfn")
FEATURES = ["minutes_available", "mood_before", "energy_before", "goal_type", "locality_type", "weather",
            "temperature", "rain_probability", "quest_type", "quest_duration", "travel_minutes",
            "physical_effort", "social_effort"]
NUMERIC = {"minutes_available", "temperature", "rain_probability", "quest_duration", "travel_minutes"}
MIN_ROWS = max(10, int(os.environ.get("TABPFN_MIN_ROWS", "30")))
CACHE_SIZE = min(8, max(1, int(os.environ.get("TABPFN_CACHE_SIZE", "4"))))
CACHE: OrderedDict[str, Any] = OrderedDict()
LOCK = threading.Lock()
LAST_STATUS: dict[str, Any] = {"mode": "not_run"}


class RankRequest(BaseModel):
    context: dict[str, Any] = Field(default_factory=dict)
    history: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    quests: list[dict[str, Any]] = Field(default_factory=list, max_length=256)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "tabpfn_available": TabPFNClassifier is not None, "import_error": IMPORT_ERROR,
            "checkpoint": "v2", "min_rows": MIN_ROWS, "cache_limit": CACHE_SIZE,
            "cached_estimators": len(CACHE), "last_prediction": LAST_STATUS}


@app.post("/rank")
def rank(payload: RankRequest) -> dict[str, Any]:
    if not payload.quests:
        return {"ranker": "baseline", "quests": [], "targets": {}}
    if len({q.get("id") for q in payload.quests}) != len(payload.quests) or any(not q.get("id") for q in payload.quests):
        raise HTTPException(400, "Each candidate needs a unique id.")
    rows = [candidate_features(payload.context, q) for q in payload.quests]
    with LOCK:
        completion, completion_status = predict_probability(payload.history, rows, "completed")
        enjoyment, enjoyment_status = predict_probability(payload.history, rows, "liked")
        modes = [completion_status["mode"], enjoyment_status["mode"]]
        mode = "tabpfn" if modes == ["tabpfn", "tabpfn"] else "hybrid" if "tabpfn" in modes else "baseline"
        targets = {"completed": completion_status, "liked": enjoyment_status}
        LAST_STATUS.update({"mode": mode, "targets": targets})
    logger.info(json.dumps({"stage": "prediction", "mode": mode, "targets": targets}))
    return {"ranker": mode, "targets": targets, "quests": [
        {"id": q["id"], "completion_probability": round(float(cp), 4), "liked_probability": round(float(lp), 4)}
        for q, cp, lp in zip(payload.quests, completion, enjoyment)
    ]}


def candidate_features(context: dict[str, Any], quest: dict[str, Any]) -> dict[str, Any]:
    return {"minutes_available": context.get("minutes", 15), "mood_before": context.get("mood", "unknown"),
            "energy_before": context.get("energy", "unknown"), "goal_type": context.get("goal", "unknown"),
            "locality_type": context.get("locality", "unknown"), "weather": context.get("weather", "unknown"),
            "temperature": context.get("temperature"), "rain_probability": context.get("rain_probability"),
            "quest_type": quest.get("quest_type", "movement"), "quest_duration": quest.get("duration", 15),
            "travel_minutes": quest.get("travel_minutes", 0), "physical_effort": quest.get("physical_effort", "low"),
            "social_effort": quest.get("social_effort", "none")}


def frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    result = pd.DataFrame([{key: row.get(key) for key in FEATURES} for row in rows], columns=FEATURES)
    for key in FEATURES:
        if key in NUMERIC:
            result[key] = pd.to_numeric(result[key], errors="coerce")
        else:
            result[key] = result[key].fillna("unknown").astype(str).astype("category")
    return result


def predict_probability(history: list[dict[str, Any]], candidates: list[dict[str, Any]], target: str):
    # Only explicit labels are evidence. Unrated and unselected activities are not negative examples.
    rows = [row for row in history if isinstance(row.get(target), bool)]
    baseline = baseline_probability(rows, candidates, target)
    positives = sum(row[target] for row in rows)
    status = {"mode": "baseline", "rows": len(rows), "positive_labels": positives,
              "negative_labels": len(rows) - positives}
    if TabPFNClassifier is None:
        return baseline, {**status, "reason": "dependency_unavailable"}
    if len(rows) < MIN_ROWS:
        return baseline, {**status, "reason": "insufficient_history"}
    if min(positives, len(rows) - positives) < 3:
        return baseline, {**status, "reason": "insufficient_label_variation"}
    try:
        holdout_size = max(8, len(rows) // 5)
        training, holdout = rows[:-holdout_size], rows[-holdout_size:]
        if len(training) < MIN_ROWS or len({row[target] for row in training}) < 2:
            return baseline, {**status, "reason": "collecting_validation_history"}
        validation_model, _ = fitted_model(training, target)
        labels = np.array([int(row[target]) for row in holdout])
        model_brier = float(np.mean((model_probabilities(validation_model, holdout) - labels) ** 2))
        baseline_brier = float(np.mean((baseline_probability(training, holdout, target) - labels) ** 2))
        evaluation = {"method": "chronological_holdout", "training_rows": len(training), "holdout_rows": len(holdout),
                      "tabpfn_brier": round(model_brier, 4), "baseline_brier": round(baseline_brier, 4),
                      "promoted": model_brier < baseline_brier}
        if not evaluation["promoted"]:
            return baseline, {**status, "reason": "baseline_wins_validation", "evaluation": evaluation}
        model, cache_hit = fitted_model(rows, target)
        values = model_probabilities(model, candidates)
        if not np.all(np.isfinite(values)):
            raise ValueError("Non-finite predictions")
        return values, {**status, "mode": "tabpfn", "checkpoint": "v2", "cache_hit": cache_hit, "evaluation": evaluation}
    except Exception as error:
        # Report failure honestly without logging user rows or credentials.
        logger.warning(json.dumps({"stage": "model_failure", "target": target, "error_type": type(error).__name__}))
        return baseline, {**status, "reason": "model_failed", "error_type": type(error).__name__}


def fitted_model(rows: list[dict[str, Any]], target: str):
    fingerprint = hashlib.sha256(json.dumps({"target": target, "rows": rows}, sort_keys=True).encode()).hexdigest()
    model = CACHE.get(fingerprint)
    cache_hit = model is not None
    if model is None:
        while len(CACHE) >= CACHE_SIZE:
            CACHE.popitem(last=False)
        model = TabPFNClassifier.create_default_for_version(ModelVersion.V2,
                    device=os.environ.get("TABPFN_DEVICE", "cpu"), n_estimators=2)
        model.fit(frame(rows), np.array([int(row[target]) for row in rows]))
        CACHE[fingerprint] = model
    else:
        CACHE.move_to_end(fingerprint)
    return model, cache_hit


def model_probabilities(model, rows):
    return model.predict_proba(frame(rows))[:, list(model.classes_).index(1)]


def baseline_probability(history: list[dict[str, Any]], candidates: list[dict[str, Any]], target: str) -> np.ndarray:
    probabilities = []
    for candidate in candidates:
        similar = [row for row in history if row.get("quest_type") == candidate.get("quest_type")]
        probabilities.append((sum(bool(row[target]) for row in similar) + 2) / (len(similar) + 4))
    return np.array(probabilities, dtype=np.float32)
