from __future__ import annotations

import os
from typing import Any

import numpy as np
import pandas as pd
from fastapi import FastAPI, Request
from dotenv import load_dotenv

load_dotenv()

try:
    from tabpfn import TabPFNClassifier
except Exception:  # pragma: no cover - optional dependency
    TabPFNClassifier = None


app = FastAPI(title="Touch Grass TabPFN Ranker")

FEATURES = [
    "minutes_available",
    "mood_before",
    "energy_before",
    "goal_type",
    "locality_type",
    "weather",
    "quest_type",
    "quest_duration",
    "physical_effort",
    "social_effort",
]


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "tabpfn_available": TabPFNClassifier is not None,
        "token_configured": bool(os.environ.get("TABPFN_TOKEN")),
        "mode": "tabpfn" if TabPFNClassifier is not None else "heuristic",
    }


@app.post("/rank")
async def rank(request: Request) -> dict[str, Any]:
    payload = await request.json()
    history = payload.get("history") or []
    context = payload.get("context") or {}
    quests = payload.get("quests") or []

    if not quests:
        return {"ranker": "empty", "quests": []}

    candidate_rows = [candidate_features(context, quest) for quest in quests]
    completion_scores = predict_probability(history, candidate_rows, "completed")
    liked_scores = predict_probability(history, candidate_rows, "liked")
    true_tabpfn_ready = bool(os.environ.get("TABPFN_TOKEN")) and can_use_tabpfn(history, "completed") and can_use_tabpfn(history, "liked")

    ranked = []
    for quest, complete_p, liked_p in zip(quests, completion_scores, liked_scores):
        benefit = heuristic_benefit(context, quest)
        score = 0.5 * complete_p + 0.35 * liked_p + 0.15 * benefit
        ranked.append(
            {
                **quest,
                "score": round(float(score), 3),
                "completion_probability": round(float(complete_p), 3),
                "liked_probability": round(float(liked_p), 3),
                "benefit_signal": round(float(benefit), 3),
                "ranker": "TabPFN" if true_tabpfn_ready else "TabPFN-ready fallback",
            }
        )

    ranked.sort(key=lambda item: item["score"], reverse=True)
    return {"ranker": ranked[0]["ranker"], "quests": ranked[:3]}


def candidate_features(context: dict[str, Any], quest: dict[str, Any]) -> dict[str, Any]:
    return {
        "minutes_available": to_number(context.get("minutes"), quest.get("duration", 15)),
        "mood_before": context.get("mood", "unknown"),
        "energy_before": context.get("energy", "unknown"),
        "goal_type": context.get("goal", quest.get("quest_type", "action")),
        "locality_type": context.get("locality", "unknown"),
        "weather": context.get("weather", "unknown"),
        "quest_type": quest.get("quest_type", "action"),
        "quest_duration": to_number(quest.get("duration"), 15),
        "physical_effort": quest.get("physical_effort", "unknown"),
        "social_effort": quest.get("social_effort", "unknown"),
    }


def predict_probability(history: list[dict[str, Any]], candidates: list[dict[str, Any]], target: str) -> np.ndarray:
    if not can_use_tabpfn(history, target):
        return heuristic_probability(history, candidates, target)

    try:
        train = pd.DataFrame([{feature: row.get(feature, "unknown") for feature in FEATURES} for row in history])
        test = pd.DataFrame([{feature: row.get(feature, "unknown") for feature in FEATURES} for row in candidates])
        y = np.array([int(bool(row.get(target))) for row in history])

        combined = pd.concat([train, test], axis=0, ignore_index=True)
        encoded = pd.get_dummies(combined, columns=categorical_columns(combined), dummy_na=True)
        X_train = encoded.iloc[: len(train)].to_numpy(dtype=np.float32)
        X_test = encoded.iloc[len(train) :].to_numpy(dtype=np.float32)

        model = TabPFNClassifier()
        model.fit(X_train, y)
        probabilities = model.predict_proba(X_test)

        class_list = list(getattr(model, "classes_", [0, 1]))
        positive_index = class_list.index(1) if 1 in class_list else len(class_list) - 1
        return probabilities[:, positive_index]
    except Exception:
        return heuristic_probability(history, candidates, target)


def can_use_tabpfn(history: list[dict[str, Any]], target: str) -> bool:
    if TabPFNClassifier is None or len(history) < 4:
        return False
    labels = {bool(row.get(target)) for row in history}
    return len(labels) >= 2


def heuristic_probability(history: list[dict[str, Any]], candidates: list[dict[str, Any]], target: str) -> np.ndarray:
    scores = []
    for candidate in candidates:
        similar = [
            row
            for row in history
            if row.get("quest_type") == candidate.get("quest_type")
            or row.get("goal_type") == candidate.get("goal_type")
        ]
        if similar:
            score = sum(1 for row in similar if bool(row.get(target))) / len(similar)
        else:
            score = 0.58 if target == "completed" else 0.55

        if candidate.get("quest_duration", 15) <= candidate.get("minutes_available", 15):
            score += 0.08
        if candidate.get("physical_effort") == "low" and candidate.get("energy_before") == "low":
            score += 0.08
        if candidate.get("social_effort") in {"none", "low"}:
            score += 0.04
        scores.append(max(0.05, min(0.95, score)))
    return np.array(scores, dtype=np.float32)


def heuristic_benefit(context: dict[str, Any], quest: dict[str, Any]) -> float:
    score = 0.5
    goal = str(context.get("goal", "")).lower()
    quest_type = str(quest.get("quest_type", "")).lower()
    title = str(quest.get("title", "")).lower()

    if goal and (goal in quest_type or goal in title):
        score += 0.22
    if quest_type in {"errand", "movement", "curiosity"}:
        score += 0.1
    if to_number(quest.get("duration"), 15) <= to_number(context.get("minutes"), 15):
        score += 0.08
    return max(0.05, min(0.95, score))


def categorical_columns(frame: pd.DataFrame) -> list[str]:
    return [column for column in frame.columns if not pd.api.types.is_numeric_dtype(frame[column])]


def to_number(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)
