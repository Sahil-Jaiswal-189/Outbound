import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_PROFILE = {
  name: "Explorer", hobbies: ["walking", "music", "food"], goals: ["fitness", "errands"],
  hates: ["crowds", "doomscrolling"], reminders: ["bring water"], socialComfort: "low", effortComfort: "medium"
};

export function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function validateProfile(value) {
  if (!value || typeof value !== "object") throw inputError("A profile is required.");
  const profile = { ...DEFAULT_PROFILE, name: String(value.name || "Explorer").slice(0, 80) };
  for (const key of ["hobbies", "goals", "hates", "reminders"]) {
    if (!Array.isArray(value[key])) throw inputError(`${key} must be a list.`);
    profile[key] = value[key].slice(0, 12).map(item => String(item).trim().slice(0, 160)).filter(Boolean);
  }
  for (const key of ["socialComfort", "effortComfort"]) {
    profile[key] = ["none", "low", "medium", "high"].includes(value[key]) ? value[key] : DEFAULT_PROFILE[key];
  }
  return profile;
}

export function historyRow(attempt) {
  const q = attempt.quest || {}, c = attempt.context || {};
  return {
    minutes_available: Number(c.minutes || q.duration || 15), mood_before: c.mood || "unknown",
    energy_before: c.energy || "unknown", goal_type: c.goal || "unknown", locality_type: c.locality || "unknown",
    weather: c.weather || "unknown", temperature: c.temperature ?? null, rain_probability: c.rain_probability ?? null,
    quest_type: q.quest_type || "movement", quest_duration: Number(q.duration || 15),
    travel_minutes: q.travel_minutes ?? 0, physical_effort: q.physical_effort || "low", social_effort: q.social_effort || "none",
    status: attempt.status, completed: attempt.status === "completed", liked: attempt.liked ?? null,
    benefit_score: attempt.benefit ?? null, template_id: q.template_id || null
  };
}

export function createStore(path, { consoleLogs = true } = {}) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY, data TEXT NOT NULL, migrated INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recommendations (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES profiles(user_id), data TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES profiles(user_id), recommendation_id TEXT REFERENCES recommendations(id),
      status TEXT NOT NULL CHECK(status IN ('started','completed','partial','skipped')),
      liked INTEGER CHECK(liked IS NULL OR liked IN (0,1)), benefit REAL, minutes REAL NOT NULL,
      synthetic INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(user_id,id)
    );
    CREATE INDEX IF NOT EXISTS attempts_user_time ON attempts(user_id,created_at);
    CREATE INDEX IF NOT EXISTS recommendations_user_time ON recommendations(user_id,created_at);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, run_id TEXT, stage TEXT NOT NULL,
      level TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_user ON events(user_id,id);
    CREATE TABLE IF NOT EXISTS source_cache (
      key TEXT PRIMARY KEY, source TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    PRAGMA user_version=1;
  `);
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function profile(userId) {
    const row = db.prepare("SELECT data FROM profiles WHERE user_id=?").get(userId);
    if (row) return JSON.parse(row.data);
    saveProfile(userId, DEFAULT_PROFILE);
    return structuredClone(DEFAULT_PROFILE);
  }
  function saveProfile(userId, value) {
    const validated = validateProfile(value);
    db.prepare(`INSERT INTO profiles(user_id,data,updated_at) VALUES(?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`)
      .run(userId, JSON.stringify(validated), new Date().toISOString());
    return validated;
  }
  function attempts(userId, limit = 500) {
    return db.prepare("SELECT data FROM attempts WHERE user_id=? AND status!='started' ORDER BY created_at DESC LIMIT ?")
      .all(userId, limit).reverse().map(row => JSON.parse(row.data));
  }
  function putAttempt(userId, value, recommendationId = null) {
    db.prepare(`INSERT INTO attempts(id,user_id,recommendation_id,status,liked,benefit,minutes,synthetic,data,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET
      status=excluded.status,liked=excluded.liked,benefit=excluded.benefit,minutes=excluded.minutes,data=excluded.data`)
      .run(value.id, userId, recommendationId, value.status, value.liked == null ? null : Number(value.liked),
        value.benefit ?? null, value.minutes || 0, Number(Boolean(value.synthetic)), JSON.stringify(value), value.completedAt || value.startedAt);
  }
  function log(userId, runId, stage, data, level = "info") {
    const createdAt = new Date().toISOString();
    db.prepare("INSERT INTO events(user_id,run_id,stage,level,data,created_at) VALUES(?,?,?,?,?,?)")
      .run(userId, runId || null, stage, level, JSON.stringify(data), createdAt);
    if (consoleLogs) console.log(JSON.stringify({ timestamp: createdAt, runId, stage, level, ...data }));
    db.prepare("DELETE FROM events WHERE user_id=? AND id NOT IN (SELECT id FROM events WHERE user_id=? ORDER BY id DESC LIMIT 1000)")
      .run(userId, userId);
  }
  function migrate(userId, payload) {
    profile(userId);
    const row = db.prepare("SELECT migrated FROM profiles WHERE user_id=?").get(userId);
    if (row.migrated) return;
    transaction(() => {
      if (payload.profile) saveProfile(userId, payload.profile);
      for (const attempt of (Array.isArray(payload.attempts) ? payload.attempts : []).slice(-1000)) {
        if (!attempt.id || !["completed", "partial", "skipped"].includes(attempt.status) || !attempt.quest) continue;
        if (!Number.isFinite(Date.parse(attempt.completedAt))) continue;
        putAttempt(userId, { ...attempt, context: attempt.context && typeof attempt.context === "object" ? attempt.context : {},
          completedAt: new Date(attempt.completedAt).toISOString(), liked: typeof attempt.liked === "boolean" ? attempt.liked : null,
          minutes: Math.max(0, Math.min(180, Number(attempt.minutes) || 0)), benefit: Number(attempt.benefit) || null });
      }
      db.prepare("UPDATE profiles SET migrated=1 WHERE user_id=?").run(userId);
    });
    log(userId, null, "migration", { importedAttempts: attempts(userId).length });
  }
  function saveRecommendation(userId, data) {
    db.prepare("INSERT INTO recommendations(id,user_id,data,created_at) VALUES(?,?,?,?)")
      .run(data.id, userId, JSON.stringify(data), new Date().toISOString());
  }
  function recommendation(userId, id) {
    const row = id ? db.prepare("SELECT data FROM recommendations WHERE user_id=? AND id=?").get(userId, id) : null;
    return row ? JSON.parse(row.data) : null;
  }
  function startAttempt(userId, recommendationId, candidateId) {
    const rec = recommendation(userId, recommendationId);
    const quest = rec?.quests.find(q => q.id === candidateId);
    if (!quest) throw inputError("Choose a quest from your saved recommendation.");
    const value = { id: randomUUID(), quest, context: rec.context, recommendationId, status: "started",
      liked: null, benefit: null, minutes: 0, startedAt: new Date().toISOString() };
    putAttempt(userId, value, recommendationId);
    log(userId, recommendationId, "quest_started", { attemptId: value.id, candidateId, questType: quest.quest_type });
    return value;
  }
  function feedback(userId, payload) {
    const row = db.prepare("SELECT data FROM attempts WHERE user_id=? AND id=?").get(userId, payload.id || "");
    if (!row) throw inputError("Start this quest before saving feedback.");
    if (!["completed", "partial", "skipped"].includes(payload.status)) throw inputError("Invalid result.");
    if (payload.liked != null && typeof payload.liked !== "boolean") throw inputError("Enjoyment must be true, false or null.");
    if (payload.benefit != null && (!Number.isFinite(payload.benefit) || payload.benefit < 1 || payload.benefit > 5)) throw inputError("Benefit must be between 1 and 5.");
    if (!Number.isFinite(payload.minutes) || payload.minutes < 0 || payload.minutes > 180) throw inputError("Invalid minutes.");
    const saved = JSON.parse(row.data);
    const value = { ...saved, status: payload.status, liked: payload.liked ?? null, benefit: payload.benefit ?? null,
      minutes: payload.status === "skipped" ? 0 : payload.minutes, note: String(payload.note || "").slice(0, 2000),
      completedAt: new Date().toISOString() };
    putAttempt(userId, value, saved.recommendationId);
    log(userId, saved.recommendationId, "feedback_saved", { attemptId: value.id, status: value.status,
      liked: value.liked, benefit: value.benefit, minutes: value.minutes, historyRows: attempts(userId).length });
    return value;
  }
  function seed(userId, count, sourceProfile) {
    if (!Number.isInteger(count) || count < 20 || count > 200) throw inputError("Choose 20 to 200 demo rows.");
    saveProfile(userId, sourceProfile);
    const types = ["movement", "nature", "errand", "curiosity", "social", "creativity"];
    transaction(() => {
      db.prepare("DELETE FROM attempts WHERE user_id=? AND synthetic=1").run(userId);
      for (let i = 0; i < count; i++) {
        const type = types[i % types.length], low = i % 3 === 0;
        const duration = [10, 15, 20, 30][Math.floor(i / 6) % 4];
        const success = ["movement", "nature", "errand"].includes(type) ? i % 7 !== 0 : i % 4 === 0;
        const status = success ? "completed" : i % 2 ? "partial" : "skipped";
        const liked = i % 11 === 0 ? null : ["nature", "movement", "curiosity"].includes(type) ? i % 7 !== 0 : i % 5 === 0;
        putAttempt(userId, { id: `demo-${i}`, synthetic: true,
          quest: { id: `demo-candidate-${i}`, template_id: `${type}-demo`, title: `${type} practice ${i + 1}`, quest_type: type,
            duration, physical_effort: type === "movement" && duration >= 20 ? "medium" : "low",
            social_effort: type === "social" ? "medium" : "none", travel_minutes: 0 },
          context: { minutes: duration + 5, mood: low ? "tired" : "curious", energy: low ? "low" : "medium",
            goal: i % 2 ? "nature" : "fitness", locality: "residential", weather: i % 5 ? "clear" : "hot" },
          status, liked, benefit: status === "skipped" ? null : liked ? 4 : 2,
          note: i % 2 ? "Bring water next time." : "Short nature breaks felt useful.",
          minutes: status === "completed" ? duration : status === "partial" ? Math.round(duration / 2) : 0,
          completedAt: new Date(Date.now() - (count - i) * 3600000).toISOString()
        });
      }
    });
    log(userId, null, "demo_seeded", { insertedRows: count, synthetic: true, workspace: "demo" });
    return inspect(userId);
  }
  function inspect(userId, page = 0) {
    const rows = db.prepare("SELECT data FROM attempts WHERE user_id=? ORDER BY created_at DESC LIMIT 20 OFFSET ?")
      .all(userId, page * 20).map(row => JSON.parse(row.data));
    const stats = db.prepare(`SELECT COUNT(*) AS total, SUM(status='completed') AS completed,
      SUM(status='partial') AS partial, SUM(status='skipped') AS skipped, SUM(status='started') AS started,
      SUM(liked IS NOT NULL AND status!='started') AS enjoymentLabels, SUM(synthetic) AS synthetic FROM attempts WHERE user_id=?`).get(userId);
    const latest = db.prepare("SELECT data FROM recommendations WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(userId);
    const events = db.prepare("SELECT id,run_id AS runId,stage,level,data,created_at AS createdAt FROM events WHERE user_id=? ORDER BY id DESC LIMIT 100")
      .all(userId).map(row => ({ ...row, data: JSON.parse(row.data) }));
    return { stats, attempts: rows, page, latestRecommendation: latest ? JSON.parse(latest.data) : null, events };
  }
  return { db, profile, saveProfile, attempts, migrate, log, saveRecommendation, recommendation, startAttempt, feedback, seed, inspect,
    history: userId => attempts(userId).map(historyRow),
    recentOffers(userId, count = 8) {
      const rows = db.prepare("SELECT data FROM recommendations WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?").all(userId, count);
      return [...new Set(rows.flatMap(row => (JSON.parse(row.data).quests || []).map(q => q.template_id).filter(Boolean)))];
    },
    cacheGet(key) {
      const row = db.prepare("SELECT data FROM source_cache WHERE key=? AND expires_at>?").get(key, Date.now());
      return row ? JSON.parse(row.data) : null;
    },
    cachePut(key, source, data, ttl) {
      db.prepare("INSERT OR REPLACE INTO source_cache(key,source,data,expires_at) VALUES(?,?,?,?)")
        .run(key, source, JSON.stringify(data), Date.now() + ttl);
      db.prepare("DELETE FROM source_cache WHERE expires_at<?").run(Date.now());
    },
    close: () => db.close()
  };
}
