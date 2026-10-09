import { locationLabel } from "./location-labels.js";
import { sourceDetail, sourceReason } from "./source-display.js";

export function createLab({ el, api, currentContext, locationControls, redraw, notify }) {
  const state = { scope: "demo", data: null, busy: false, count: 60, page: 0, error: null,
    context: { minutes: 20, mood: "restless", energy: "low", goal: "fitness", weather: "clear" } };
  const icon = name => el("i", { "data-lucide": name, "aria-hidden": "true" });
  const pct = value => Number.isFinite(value) ? `${Math.round(value * 100)}%` : "-";
  function table(headers, rows, className = "") {
    return el("div", { class: "data-scroll", tabindex: 0, "aria-label": `${headers[0]} table` }, el("table", { class: `data-table ${className}` }, [
      el("thead", {}, el("tr", {}, headers.map(header => el("th", { scope: "col",
        title: header.includes("Brier") ? "Mean squared probability error. Lower is better." : undefined }, header)))),
      el("tbody", {}, rows.length ? rows.map(row => el("tr", {}, row.map(cell => el("td", {}, cell))))
        : el("tr", {}, el("td", { colspan: headers.length, class: "table-empty" }, "No records")))
    ]));
  }
  async function perform(action) {
    state.busy = true; state.error = null; redraw();
    try { await action(); }
    catch (error) { state.error = error.message; notify(error.message); }
    finally { state.busy = false; redraw(); }
  }
  async function load() {
    state.data = await api(`/api/lab?scope=${state.scope}&page=${state.page}`);
  }
  async function seed() {
    await perform(async () => {
      await api("/api/demo/seed", { count: state.count });
      state.scope = "demo"; state.page = 0;
      await load(); notify(`${state.count} synthetic rows saved to SQLite.`);
    });
  }
  async function run() {
    await perform(async () => {
      await api("/api/demo/recommend", { context: { ...currentContext(), ...state.context } });
      state.scope = "demo"; state.page = 0;
      await load(); notify("Demo recommendation saved.");
    });
  }
  function section(label, content) {
    return el("section", { class: "lab-section" }, [el("h3", {}, label), ...[content].flat()]);
  }
  function render() {
    const data = state.data, rec = data?.latestRecommendation, stats = data?.stats || {};
    return el("div", { class: "lab-view", "aria-busy": String(state.busy) }, [
      el("div", { class: "lab-heading" }, [
        el("div", {}, [el("h2", {}, "Recommendation lab"), el("span", { class: "workspace-label" }, state.scope === "demo" ? "Demo workspace / synthetic history" : "Personal workspace / real history")]),
        el("button", { class: "button secondary icon-button", title: "Refresh records", "aria-label": "Refresh records", disabled: state.busy || undefined,
          onclick: () => perform(load) }, icon("refresh-cw"))
      ]),
      el("div", { class: "lab-toolbar" }, [
        el("div", { class: "workspace-switch", role: "group", "aria-label": "Database workspace" }, ["demo", "live"].map(scope =>
          el("button", { class: `button ${state.scope === scope ? "active" : "ghost"}`, "aria-pressed": String(state.scope === scope),
            disabled: state.busy || undefined, onclick: () => perform(async () => { state.scope = scope; state.page = 0; await load(); }) }, scope === "demo" ? "Demo" : "Personal"))),
        el("label", { class: "seed-count" }, ["Demo rows", el("input", { type: "number", min: 20, max: 200, step: 1, value: state.count,
          disabled: state.busy || undefined, onchange: event => { state.count = Number(event.target.value); } })]),
        el("button", { class: "button secondary", disabled: state.busy || undefined, onclick: seed }, [icon("database"), "Seed demo data"]),
        el("button", { class: "button", disabled: state.busy || undefined, onclick: run }, [icon("play"), state.busy ? "Working..." : "Run demo recommendation"])
      ]),
      el("div", { class: "lab-context" }, [["minutes", "Available minutes", ["5", "10", "15", "20", "30", "45"]],
        ["mood", "Mood", ["tired", "restless", "bored", "anxious", "curious", "focused"]],
        ["energy", "Energy", ["low", "medium", "high"]], ["goal", "Goal", ["fitness", "nature", "errands", "social", "creativity", "calm"]],
        ["weather", "Reported weather", ["clear", "hot", "rainy", "unknown"]]].map(([name, label, options]) =>
          el("label", {}, [label, el("select", { name: `demo-${name}`, "aria-label": label, disabled: state.busy || undefined,
            onchange: event => { state.context[name] = name === "minutes" ? Number(event.target.value) : event.target.value; } },
            options.map(value => el("option", { value, selected: String(state.context[name]) === value ? "" : undefined }, value)))]))),
      locationControls(),
      state.error ? el("p", { class: "lab-error", role: "alert" }, state.error) : null,
      el("dl", { class: "lab-stats" }, [["Stored attempts", stats.total || 0], ["Completed", stats.completed || 0],
        ["Partial", stats.partial || 0], ["Skipped", stats.skipped || 0], ["Enjoyment labels", stats.enjoymentLabels || 0],
        ["Synthetic rows", stats.synthetic || 0]].map(([label, value]) => el("div", {}, [el("dt", {}, label), el("dd", {}, String(value))]))),
      section("Stored attempts", [
        table(["Time", "Activity", "Context", "Outcome", "Liked", "Benefit", "Minutes", "Origin"],
          (data?.attempts || []).map(a => [new Date(a.completedAt || a.startedAt).toLocaleString(), a.quest.title,
            `${a.context?.energy || "unknown"} / ${a.context?.minutes || "?"}m / ${a.context?.goal || "unknown"}`,
            a.status, a.liked == null ? "Unrated" : a.liked ? "Yes" : "No", a.benefit == null ? "-" : String(a.benefit),
            String(a.minutes), a.synthetic ? "Synthetic" : "Personal"])),
        el("div", { class: "table-pagination" }, [
          el("button", { class: "button ghost icon-button", title: "Previous rows", "aria-label": "Previous rows", disabled: state.busy || state.page === 0 || undefined,
            onclick: () => perform(async () => { state.page--; await load(); }) }, icon("chevron-left")),
          el("span", {}, `Page ${state.page + 1}`),
          el("button", { class: "button ghost icon-button", title: "Next rows", "aria-label": "Next rows", disabled: state.busy || (state.page + 1) * 20 >= (stats.total || 0) || undefined,
            onclick: () => perform(async () => { state.page++; await load(); }) }, icon("chevron-right"))
        ])
      ]),
      section("Latest recommendation", rec ? [
        el("dl", { class: "run-summary" }, [["Run", rec.id], ["Predictor", rec.ranker], ["Writer", rec.source],
          ["History rows", rec.historyRows], ["Elapsed", `${rec.elapsedMs}ms`], ["Policy", rec.policyVersion],
          ["Run location", rec.context.location ? locationLabel(rec.context.location) : "Not shared for this run"]].map(([label, value]) =>
            el("div", {}, [el("dt", {}, label), el("dd", {}, String(value))]))),
        rec.notice ? el("p", { class: "lab-error" }, rec.notice) : null,
        rec.destinations ? el("p", { class: "destination-summary" }, `${rec.destinations.mapped} mapped places / ${rec.destinations.routed} routed / ${rec.destinations.eligible} eligible destination activities${rec.destinations.eligible === 0 ? ` / ${rec.destinations.reasons.map(sourceReason).join("; ")}` : ""}`) : null,
        el("h4", {}, "Prediction targets"),
        table(["Target", "Engine", "Labeled rows", "Positive", "Negative", "Status"],
          Object.entries(rec.prediction.targets || {}).map(([target, detail]) => [target, detail.mode, String(detail.rows),
            String(detail.positive_labels), String(detail.negative_labels), detail.reason || (detail.cache_hit ? "Cached estimator" : "Predicted")])),
        el("h4", {}, "Chronological validation"),
        table(["Target", "Training rows", "Later test rows", "TabPFN Brier", "Baseline Brier", "Selection"],
          Object.entries(rec.prediction.targets || {}).filter(([, d]) => d.evaluation).map(([target, d]) => [target,
            String(d.evaluation.training_rows), String(d.evaluation.holdout_rows), String(d.evaluation.tabpfn_brier),
            String(d.evaluation.baseline_brier), d.evaluation.promoted ? "TabPFN" : "Baseline"])),
        el("h4", {}, "Candidate scores"),
        table(["Activity", "Type", "Minutes", "Completion", "Enjoyment", "Goal alignment", "Mood fit", "Place fit", "Repeat penalty", "Score", "Selection"],
          rec.candidates.map(q => [q.title, q.quest_type, String(q.duration), pct(q.completion_probability), pct(q.liked_probability),
            pct(q.benefit_signal), (q.components.moodFit || 0).toFixed(2), (q.components.placeFit || 0).toFixed(2), q.components.repetitionPenalty.toFixed(2), q.score.toFixed(3),
            rec.decisions.find(d => d.candidateId === q.id)?.decision || "Not selected"])),
        el("h4", {}, "Place-to-activity matches"),
        table(["Place", "Group", "Compatible activities", "Candidate activity IDs", "Unavailable reason"],
          (rec.placeMatching?.places || []).map(p => [p.name, p.group || "-", p.compatibleCount == null ? "-" : String(p.compatibleCount),
            p.candidateActivities.join(", ") || "-", p.skipped.join(", ") || "-"])),
        el("h4", {}, "Destination candidates"),
        table(["Activity", "Place", "Round trip", "On site", "Reserve", "Total", "Route", "Access / opening"],
          rec.candidates.filter(q => q.destination).map(q => [q.title, q.destination.name, `${q.travel_minutes}m`,
            `${q.activity_minutes}m`, `${q.buffer_minutes}m`, `${q.duration}m`, q.routing.status, "Unverified"])),
        el("h4", {}, "Selected quests"),
        el("ol", { class: "lab-selected" }, rec.quests.map(q => el("li", {}, [el("strong", {}, `${q.lane}: ${q.title}`), el("p", {}, q.why),
          q.evidence ? el("details", { class: "quest-rationale" }, [el("summary", {}, "Why this quest"),
            el("div", {}, q.evidence.reasons.map(r => el("p", {}, [r.text, el("small", {}, r.source)])))]) : null]))),
        el("h4", {}, "Filtered candidates"),
        table(["Activity", "Reasons"], rec.rejected.map(q => [q.title, q.reasons.join(", ")])),
        el("h4", {}, "Data sources"),
        table(["Source", "Place / facts", "Status", "Fetched", "Reason", "Use in this run"], rec.facts.sources.map(s => [s.source,
          sourceDetail(s, rec.facts), s.status, s.fetchedAt ? new Date(s.fetchedAt).toLocaleString() : "-", sourceReason(s.reason),
          s.placeId ? rec.quests.some(q => q.destination?.id === s.placeId) ? "Used by a selected destination quest" : "Route checked; no selected quest uses this place"
            : s.source === "open-meteo" && rec.facts.weather ? "Weather and daylight checks"
            : s.source === "open-meteo-air" && rec.facts.airQuality ? "AQI checks and preparation; regional model estimate"
            : s.source === "overpass" && rec.facts.places.length ? "Mapped places considered for activity matching"
            : sourceReason(s.reason)]), "source-table"),
        el("details", { class: "json-disclosure" }, [el("summary", {}, "Selection probabilities and source facts"),
          el("pre", {}, JSON.stringify({ decisions: rec.decisions, placeMatching: rec.placeMatching, facts: rec.facts }, null, 2))])
      ] : el("p", { class: "table-empty" }, "No recommendation recorded")),
      section("Structured event log", el("div", { class: "event-log" }, (data?.events || []).length ? data.events.map(event =>
        el("details", { class: `log-entry ${event.level}` }, [el("summary", {}, [
          el("time", {}, new Date(event.createdAt).toLocaleTimeString()), el("strong", {}, event.stage),
          el("span", {}, event.level), el("code", {}, event.runId ? event.runId.slice(0, 8) : "workspace")
        ]), el("pre", {}, JSON.stringify(event.data, null, 2))])) : el("p", { class: "table-empty" }, "No events recorded")))
    ]);
  }
  return { render, refresh: () => perform(load) };
}
