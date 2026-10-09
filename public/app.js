import { createLab } from "./lab.js";
import { openStartingPointPicker } from "./location-picker.js";
import { openActivityLibrary } from "./activity-library.js";
import { coordinateLabel, locationLabel } from "./location-labels.js";
import { sourceDetail, sourceReason } from "./source-display.js";

const STORE_KEY = "touch-grass-outbound:v1";

const defaultProfile = {
  name: "Explorer",
  hobbies: ["walking", "music", "food"],
  goals: ["fitness", "errands"],
  hates: ["crowds", "doomscrolling"],
  reminders: ["bring water"],
  socialComfort: "low",
  effortComfort: "medium"
};

const badges = [
  { id: "first-step", name: "First Step", icon: "boot", tone: "leaf", rule: (s) => s.attempts.length >= 1, text: "Returned with proof of life." },
  { id: "three-days", name: "Three Real Days", icon: "flame", tone: "sun", rule: (s) => currentStreak(s.attempts) >= 3, text: "A small streak, no guilt attached." },
  { id: "errand-alchemist", name: "Errand Alchemist", icon: "bag", tone: "clay", rule: (s) => countType(s, "errand") >= 2, text: "Turned chores into motion." },
  { id: "curiosity", name: "Curiosity Engine", icon: "spark", tone: "sky", rule: (s) => countType(s, "curiosity") >= 2, text: "Collected details from the world." },
  { id: "partial-credit", name: "Partial Counts", icon: "half", tone: "berry", rule: (s) => s.attempts.some((a) => a.status === "partial"), text: "Rejected all-or-nothing thinking." },
  { id: "screenbreaker", name: "Screenbreaker", icon: "bolt", tone: "ink", rule: (s) => totalMinutes(s.attempts) >= 60, text: "One hour reclaimed." }
];

const state = loadState();
let activeTab = "quests";
let backendReady = false;
let activeAttemptId = null;
let recommendationBusy = false;
let startingQuest = false;
let locationPending = false;
let locationError = "";
let locationRequestId = 0;
let locationWatchdog = null;
let locationConditions = null;
let conditionsPending = false;
let disposeLocationPicker = null;
const lab = createLab({ el, api, currentContext: () => ({ minutes: 20, mood: "tired", energy: "low", goal: state.profile.goals[0] || "fitness",
  locality: "residential", weather: "unknown", ...state.lastContext, location: state.location || null }),
  locationControls: renderLocationControls, redraw: render, notify: toast });
let activeQuest = null;
let activeStartedAt = null;
let activeTimer = null;
let remainingSeconds = 0;
let noteRecorder = null;
let noteChunks = [];
let elevenLabsUnavailable = false;
let currentAudio = null;
let currentVoiceToken = 0;
let currentVoiceResolve = null;
let currentVoiceVisible = false;
let voiceBusy = false;

function loadState() {
  const saved = localStorage.getItem(STORE_KEY);
  if (!saved) {
    return {
      profile: defaultProfile,
      attempts: [],
      generated: [],
      selectedQuest: null,
      liveContext: null,
      lastRun: null,
      lastContext: null,
      useElevenVoice: false
    };
  }
  try {
    return { profile: defaultProfile, attempts: [], generated: [], selectedQuest: null, liveContext: null, lastRun: null, lastContext: null, useElevenVoice: false, ...JSON.parse(saved) };
  } catch {
    return { profile: defaultProfile, attempts: [], generated: [], selectedQuest: null, liveContext: null, lastRun: null, lastContext: null, useElevenVoice: false };
  }
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

async function api(path, payload) {
  const response = await fetch(path, payload === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data;
}

async function initializeBackend() {
  try {
    const saved = await api("/api/bootstrap", { profile: state.profile, attempts: state.attempts });
    state.profile = saved.profile;
    state.attempts = saved.attempts;
    if (!state.lastRun?.recommendationId) { state.generated = []; state.lastRun = null; }
    backendReady = true;
    saveState(); render();
    if (state.location) refreshConditions(state.location);
    if (state.location && !state.location.approximate && !state.location.area) resolveSavedLocation();
  } catch (error) { toast(`Database connection failed: ${error.message}`); }
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  });
  [children].flat().filter(Boolean).forEach((child) => {
    node.append(child.nodeType ? child : document.createTextNode(child));
  });
  return node;
}

function render() {
  const app = document.querySelector("#app");
  const completed = state.attempts.filter((a) => a.status === "completed").length;
  const minutes = totalMinutes(state.attempts);
  const streak = currentStreak(state.attempts);

  app.innerHTML = "";
  app.append(
    el("main", { class: "app-shell" }, [
      renderTopbar(),
      el("nav", { class: "app-tabs", "aria-label": "Views" }, [
        el("button", { class: activeTab === "quests" ? "active" : "", "aria-current": activeTab === "quests" ? "page" : undefined,
          onclick: () => { activeTab = "quests"; render(); } }, "Quests"),
        el("button", { class: activeTab === "lab" ? "active" : "", "aria-current": activeTab === "lab" ? "page" : undefined,
          onclick: () => { activeTab = "lab"; render(); lab.refresh(); } }, "Recommendation lab")
      ]),
      activeTab === "lab" ? lab.render() : el("div", { class: "outing-view" }, [
        el("section", { class: "outing-banner" }, [
          el("img", { src: "/outbound-path.jpg", alt: "A sunlit walking path through a green park", fetchpriority: "high" }),
          el("div", { class: "outing-banner-copy" }, [
            el("p", {}, `A little fresh air, ${state.profile.name || "Explorer"}.`),
            el("h2", {}, "Your next outing"),
            el("span", {}, new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()))
          ])
        ]),
        el("div", { class: "stats-row" }, [statCard(completed, "quests completed", "footprints"),
          statCard(`${minutes}m`, "time outside", "sun"), statCard(streak, "day streak", "flame")]),
        el("section", { class: "grid" }, [
          el("section", { class: "setup-column" }, [el("h3", {}, "Make it yours"), renderContextForm()]),
          el("aside", {}, renderQuestPanel())
        ]),
        el("section", { class: "journey-footer" }, [renderHistory(), renderBadges()])
      ])
    ])
  );
  window.lucide?.createIcons();
}

function renderTopbar() {
  return el("header", { class: "topbar" }, [
    el("div", { class: "brand" }, [
      el("div", { class: "brand-mark" }, el("i", { "data-lucide": "footprints", "aria-hidden": "true" })),
      el("div", {}, [
        el("h1", {}, "Outbound"),
        el("p", {}, "Touch Grass")
      ])
    ]),
    el("div", { class: "top-actions" }, [
      renderVoiceControls(),
      el("button", { class: "button secondary profile-button", title: "Edit profile", "aria-label": "Edit profile", onclick: openProfile }, [el("i", { "data-lucide": "user-round", "aria-hidden": "true" }), el("span", {}, "Edit profile")]),
      el("button", { class: "button ghost icon-button", title: "Clear quest deck", "aria-label": "Clear quest deck", onclick: resetDemo }, el("i", { "data-lucide": "trash-2", "aria-hidden": "true" }))
    ])
  ]);
}

function renderVoiceControls() {
  return el("div", { class: "voice-controls" }, [
    el("label", { class: "voice-toggle", title: "Use ElevenLabs for quest and reward speech" }, [
      el("input", { type: "checkbox", "aria-label": "ElevenLabs voice", checked: state.useElevenVoice ? "" : undefined, onchange: toggleElevenVoice }),
      el("span", { class: "toggle-track", "aria-hidden": "true" }), el("span", {}, "ElevenLabs voice")
    ]),
    voiceBusy ? el("button", { class: "button ghost", onclick: stopVoice }, "Stop voice") : null
  ]);
}

function renderContextForm() {
  const context = state.lastContext || {};
  const todayGoal = context.goal || state.profile.goals[0] || "fitness";
  return el("form", { class: "quest-setup", id: "quest-form", onsubmit: generateQuests }, [
    choiceGroup("minutes", "How much time?", ["5", "10", "15", "20", "30", "45"], String(context.minutes || 15), (value) => `${value}m`),
    choiceGroup("mood", "What state are you in?", ["tired", "restless", "bored", "anxious", "curious", "focused"], context.mood || "restless"),
    choiceGroup("energy", "Energy", ["low", "medium", "high"], context.energy || "medium"),
    choiceGroup("goal", "Today's direction", unique([...state.profile.goals, "fitness", "social", "errands", "nature", "home", "creativity"]), todayGoal),
    el("details", { class: "context-details" }, [el("summary", {}, "More context"), el("div", { class: "setup-row two" }, [
      compactSelect("locality", "Place vibe", ["residential", "market", "campus", "office", "park", "unknown"], context.locality || "residential"),
      compactSelect("weather", "Weather", ["clear", "hot", "cloudy", "rainy", "windy", "snowy", "foggy", "thunderstorm", "unknown"], context.weather || "unknown")
    ])]),
    renderLocationControls(),
    el("div", { class: "field" }, [
      el("label", { for: "context-note" }, "Constraint or tiny wish"),
      el("input", {
        id: "context-note",
        name: "note",
        value: context.note || "",
        placeholder: "Avoid crowds, need to buy milk, want something easy..."
      })
    ]),
    el("div", { class: "activity-choice" }, [
      el("button", { class: "button secondary", type: "button", onclick: browseActivities }, [
        el("i", { "data-lucide": "compass" }), "Browse activities"
      ]),
      state.preferredActivity ? el("div", { class: "chosen-activity" }, [
        el("span", {}, state.preferredActivity.title),
        el("button", { class: "button ghost icon-button", type: "button", title: "Clear chosen activity", "aria-label": "Clear chosen activity",
          onclick: () => { state.lastContext = readCurrentContext(); state.preferredActivity = null; saveState(); render(); } }, el("i", { "data-lucide": "x" }))
      ]) : null
    ]),
    el("button", { class: "button big-action", type: "submit", id: "generate-button", disabled: !backendReady || recommendationBusy || undefined },
      [el("i", { "data-lucide": "sparkles", "aria-hidden": "true" }),
        !backendReady ? "Connecting to your history..." : recommendationBusy ? "Building your deck..." : "Generate 3 quests"])
  ]);
}

function readCurrentContext() {
  const form = document.querySelector("#quest-form");
  return { ...(form ? Object.fromEntries(new FormData(form)) : state.lastContext || { minutes: 15 }), location: state.location || null };
}

function browseActivities() {
  state.lastContext = readCurrentContext(); saveState(); closeModal();
  openActivityLibrary({ el, api, minutes: Number(state.lastContext.minutes), onClose: closeModal,
    onChoose: activity => {
      state.preferredActivity = { id: activity.id, title: activity.title };
      state.lastContext.minutes = Math.max(Number(state.lastContext.minutes), activity.minMinutes);
      saveState(); closeModal(); render();
    } });
}

function renderLocationControls() {
  return el("div", { class: "location-controls" }, [
    el("div", { class: "location-status" }, [el("strong", {}, "Starting point"), el("span", {}, locationPending ? "Locating..." : locationLabel(state.location)),
      state.location ? el("small", {}, state.location.approximate ? "Area only" : "Precise starting point") : null]),
    el("button", { class: "button secondary icon-button", type: "button", title: "Use current location", "aria-label": "Use current location", disabled: locationPending || undefined, onclick: useCurrentLocation }, el("i", { "data-lucide": "locate-fixed" })),
    el("button", { class: "button secondary icon-button", type: "button", title: "Choose area", "aria-label": "Choose area", onclick: openLocationSearch }, el("i", { "data-lucide": "search", "aria-hidden": "true" })),
    el("button", { class: "button secondary icon-button", type: "button", title: "Set starting point", "aria-label": "Set starting point", onclick: openManualLocation }, el("i", { "data-lucide": "map-pinned", "aria-hidden": "true" })),
    state.location ? el("button", { class: "button ghost icon-button", type: "button", title: "Remove location", "aria-label": "Remove location",
      onclick: () => selectLocation(null) }, el("i", { "data-lucide": "x" })) : null,
    locationError ? el("p", { class: "location-error", role: "alert" }, locationError) : null,
    conditionsPending ? el("p", { class: "location-conditions", role: "status" }, "Fetching weather and air quality...") : null,
    locationConditions ? el("div", { class: "location-conditions", role: "status" }, locationConditions.sources.map(s =>
      el("p", {}, `${s.source}: ${sourceDetail(s, locationConditions)} (${s.status})`))) : null
  ]);
}

function selectLocation(location) {
  state.lastContext = readCurrentContext();
  locationRequestId++; locationPending = false; locationError = "";
  clearTimeout(locationWatchdog); locationConditions = null; conditionsPending = false;
  state.location = location;
  if (location) state.lastContext.location = location;
  if (!location && state.lastContext) delete state.lastContext.location;
  saveState(); render();
  if (location) refreshConditions(location);
}

async function refreshConditions(location) {
  const id = locationRequestId;
  conditionsPending = true; render();
  try {
    const result = await api("/api/location/conditions", { ...readCurrentContext(), minutes: Number(readCurrentContext().minutes || 15), location });
    if (id !== locationRequestId || state.location !== location) return;
    locationConditions = result;
  } catch {
    if (id !== locationRequestId || state.location !== location) return;
    locationConditions = { sources: [{ source: "Weather / air quality", status: "unavailable", reason: "request_failed" }] };
  } finally {
    if (id === locationRequestId && state.location === location) { state.lastContext = readCurrentContext(); conditionsPending = false; render(); }
  }
}

function useCurrentLocation() {
  state.lastContext = readCurrentContext();
  if (!window.isSecureContext || !navigator.geolocation) {
    locationError = "Browser location is unavailable here. Open http://localhost:5177 in a browser, or set a map starting point.";
    render(); return;
  }
  const policy = document.permissionsPolicy || document.featurePolicy;
  if (policy?.allowsFeature && !policy.allowsFeature("geolocation")) {
    locationError = "This preview blocks browser location. Open http://localhost:5177 directly, or set a map starting point.";
    render(); return;
  }
  const requestId = ++locationRequestId;
  locationConditions = null; conditionsPending = false;
  locationPending = true; locationError = ""; render();
  clearTimeout(locationWatchdog);
  const failed = error => {
    if (requestId !== locationRequestId) return;
    clearTimeout(locationWatchdog); locationPending = false; ++locationRequestId;
    locationError = {
      1: "Location permission was denied. Check browser and system location permission, or set a starting point.",
      2: "Your browser could not determine your position. Set a starting point instead.",
      3: "Location lookup timed out. Try again or set a starting point."
    }[error.code] || "Location lookup failed. Set a starting point instead.";
    state.lastContext = readCurrentContext(); render();
  };
  locationWatchdog = setTimeout(() => failed({ code: 3 }), 16000);
  try { navigator.geolocation.getCurrentPosition(async position => {
    if (requestId !== locationRequestId) return;
    clearTimeout(locationWatchdog);
    const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    selectLocation({ ...point, label: coordinateLabel(point), approximate: false, method: "gps", accuracyMeters: position.coords.accuracy });
    const selected = state.location, selectedId = locationRequestId;
    const area = await lookupArea(point);
    if (selectedId !== locationRequestId || state.location !== selected) return;
    if (area) {
      state.lastContext = readCurrentContext();
      state.location = { ...selected, area, label: area }; state.lastContext.location = state.location;
      saveState(); render();
      if (conditionsPending) refreshConditions(state.location);
    }
    toast("Current location selected.");
  }, failed, { timeout: 15000, maximumAge: 60000, enableHighAccuracy: false }); }
  catch (error) { failed(error); }
}

function openManualLocation() {
  state.lastContext = readCurrentContext(); saveState();
  closeModal();
  disposeLocationPicker = openStartingPointPicker({ el, api, initial: state.location,
    onClose: closeModal, onSave: location => { selectLocation(location); closeModal(); toast("Starting point saved."); } });
}

async function lookupArea(point) {
  try { return (await api("/api/location/reverse", point)).area || ""; }
  catch { return ""; }
}

async function resolveSavedLocation() {
  const location = state.location;
  const requestId = locationRequestId;
  const area = await lookupArea(location);
  if (state.location !== location || requestId !== locationRequestId || !area) return;
  const alias = location.alias || (/^(my starting point|current location|sample place)$/i.test(location.label || "") || location.label === coordinateLabel(location) ? "" : location.label);
  selectLocation({ ...location, area, alias, label: alias ? `${alias} / ${area}` : area });
}

function openLocationSearch() {
  const results = el("div", { class: "location-results" });
  document.body.append(el("div", { class: "modal-backdrop" }, el("section", { class: "modal" }, [
    el("header", {}, [el("h2", {}, "Choose an area"), el("button", { class: "button ghost", onclick: closeModal }, "Close")]),
    el("form", { class: "modal-body", onsubmit: async event => {
      event.preventDefault(); const button = event.target.querySelector("button[type=submit]"); button.disabled = true;
      try {
        const data = await api("/api/location", { query: new FormData(event.target).get("query") });
        results.replaceChildren(...data.locations.map(location => el("button", { class: "button secondary", type: "button", onclick: () => {
          selectLocation(location); closeModal();
        } }, location.label)));
        if (!data.locations.length) results.textContent = "No areas found. Try another name.";
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    } }, [el("label", { class: "field" }, ["Town or city", el("input", { name: "query", required: "", minlength: 2, maxlength: 100 })]),
      el("button", { class: "button", type: "submit" }, "Search"), results])
  ])));
}

function choiceGroup(name, label, options, value, format = title) {
  const icons = { tired: "moon", restless: "wind", bored: "coffee", anxious: "heart", curious: "scan-eye", focused: "focus",
    low: "battery-low", medium: "battery-medium", high: "battery-full", fitness: "footprints", social: "users", errands: "shopping-bag",
    nature: "leaf", home: "house", creativity: "palette", calm: "cloud-sun", confidence: "sun" };
  return el("fieldset", { class: `choice-group choices-${name}` }, [
    el("legend", {}, label),
    el(
      "div",
      { class: "choice-grid" },
      options.map((option) =>
        el("label", { class: "choice-tile" }, [
          el("input", { type: "radio", name, value: option, ...(option === value ? { checked: "checked" } : {}) }),
          el("span", {}, [icons[option] ? el("i", { "data-lucide": icons[option], "aria-hidden": "true" }) : null, format(option)])
        ])
      )
    )
  ]);
}

function compactSelect(name, label, options, value) {
  return el("label", { class: "compact-select" }, [
    el("span", {}, label),
    el(
      "select",
      { name },
      options.map((option) => el("option", { value: option, ...(option === value ? { selected: "selected" } : {}) }, title(option)))
    )
  ]);
}

function statCard(value, label, icon) {
  return el("div", { class: "stat" }, [el("i", { "data-lucide": icon, "aria-hidden": "true" }),
    el("div", {}, [el("strong", {}, String(value)), el("span", {}, label)])]);
}

function renderQuestPanel() {
  return el("section", { class: "panel" }, [
    el("div", { class: "panel-inner" }, [
      el("div", { class: "section-title" }, [
        el("div", {}, [el("h3", {}, "Quest deck"), el("p", {}, questPanelSubtitle())])
      ]),
      state.liveContext ? el("div", { class: "run-evidence" }, [
        el("strong", {}, "Saved outing conditions"),
        state.lastRun?.context?.location ? el("p", {}, locationLabel(state.lastRun.context.location)) : null,
        ...(state.liveContext.sources || []).filter(s => ["open-meteo", "open-meteo-air"].includes(s.source))
          .map(s => el("p", {}, `${sourceDetail(s, state.liveContext)} (${s.status})`)),
        state.lastRun?.destinations?.eligible === 0 ? el("p", { class: "location-error" },
          `No named destination recommended: ${state.lastRun.destinations.reasons.map(sourceReason).join("; ")}.`) : null
      ]) : null,
      state.generated.length
        ? el("div", { class: "quest-stack" }, state.generated.map(renderQuestCard))
        : el("div", { class: "empty-state" }, [el("i", { "data-lucide": "compass", "aria-hidden": "true" }), "Your next outing is waiting."])
    ])
  ]);
}

function questPanelSubtitle() {
  if (state.generated.length) return "Three possibilities for today";
  return "A fresh start";
}

function renderQuestCard(quest, index) {
  const laneClass = quest.lane?.toLowerCase().includes("easy")
    ? "easy"
    : quest.lane?.toLowerCase().includes("useful")
      ? "useful"
      : "stretch";
  return el("article", { class: `quest-card ${laneClass}` }, [
    el("div", { class: "quest-meta" }, [
      el("span", { class: "pill" }, quest.lane || "Quest"),
      el("span", { class: "pill" }, `${quest.duration || 15} min`),
      el("span", { class: "pill" }, title(quest.quest_type || "action"))
    ]),
    el("h4", {}, quest.title || "Outside Quest"),
    quest.destination ? el("div", { class: "quest-destination" }, [
      el("i", { "data-lucide": "map-pin" }),
      el("div", {}, [el("strong", {}, quest.destination.name),
        el("span", {}, `${quest.travel_minutes}m walking round trip / ${quest.activity_minutes}m activity / ${quest.buffer_minutes ?? 2}m reserve`),
        el("span", {}, "Access and opening hours unverified")])
    ]) : null,
    el("p", {}, quest.why || "A small action that makes the real world easier to choose."),
    quest.evidence ? el("details", { class: "quest-rationale" }, [el("summary", {}, "Why this quest"),
      el("ul", {}, quest.evidence.reasons.map(r => el("li", {}, [el("span", {}, r.text), el("small", {}, r.source)])))]) : null,
    el(
      "ol",
      {},
      (quest.steps || []).slice(0, 3).map((step) => el("li", {}, step))
    ),
    el("div", { class: "quest-actions" }, [
      el("button", { class: "button", onclick: () => startQuest(index) }, [el("i", { "data-lucide": "arrow-up-right", "aria-hidden": "true" }), "Start"]),
      el("button", { class: "button secondary", onclick: () => previewQuest(index) }, [el("i", { "data-lucide": "volume-2", "aria-hidden": "true" }), "Read aloud"])
    ])
  ]);
}

function renderHistory() {
  const recent = [...state.attempts].reverse().slice(0, 8);
  return el("section", { class: "panel", style: "margin-top: 20px;" }, [
    el("div", { class: "panel-inner" }, [
      el("div", { class: "section-title" }, [
        el("div", {}, [el("h3", {}, "Field log"), el("p", {}, "Your recent outings and reflections.")])
      ]),
      recent.length
        ? el(
            "div",
            { class: "timeline" },
            recent.map((attempt) =>
              el("div", { class: "timeline-item" }, [
                el("strong", {}, attempt.quest.title),
                el("span", {}, `${title(attempt.status)} · ${attempt.minutes} min · ${new Date(attempt.completedAt).toLocaleDateString()}`),
                el("p", {}, attempt.note || "No note added.")
              ])
            )
          )
        : el("div", { class: "empty-state" }, [el("i", { "data-lucide": "notebook-pen", "aria-hidden": "true" }), "No outings logged yet."])
    ])
  ]);
}

function renderBadges() {
  return el("section", { class: "panel", style: "margin-top: 20px;" }, [
    el("div", { class: "panel-inner" }, [
      el("div", { class: "section-title" }, [
        el("div", {}, [el("h3", {}, "Badges"), el("p", {}, "Small proof that the real world got a turn.")])
      ]),
      el(
        "div",
        { class: "badge-grid" },
        badges.map((badge) => {
          const earned = badge.rule(state);
          return el("div", { class: `badge ${badge.tone} ${earned ? "" : "locked"}` }, [
            badgeIcon(badge),
            el("div", {}, [el("strong", {}, badge.name), el("span", {}, earned ? badge.text : "Locked")])
          ]);
        })
      )
    ])
  ]);
}

function badgeIcon(badge) {
  const icons = {
    boot: "M8 5h6l1.3 7.5 5.7 2.1V18H9.8L7 15.2V10h1V5Zm1.8 9 1.1 1h7.6v-.4l-4.9-1.8L12.5 7H10v7Z",
    flame: "M12 3c3.5 3.2 5 5.7 5 8.3 0 3.4-2.3 5.7-5 5.7s-5-2.3-5-5.4c0-1.9 1-3.6 2.5-5.1-.1 2 .7 3.4 2.2 4.1.8-2.2.9-4.5.3-7.6Z",
    bag: "M7 8h10l1 11H6L7 8Zm3 0V6a2 2 0 0 1 4 0v2h-1.5V6a.5.5 0 0 0-1 0v2H10Z",
    spark: "M12 3l1.8 5.1L19 10l-5.2 1.9L12 17l-1.8-5.1L5 10l5.2-1.9L12 3Zm6 10 1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1 1-2.4Z",
    half: "M12 4a8 8 0 1 1 0 16V4Zm0 2v12a6 6 0 0 0 0-12Z",
    bolt: "M13 2 5 13h6l-1 9 8-12h-6l1-8Z"
  };
  return el("div", { class: "badge-icon", html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[badge.icon] || icons.spark}"></path></svg>` });
}

function openProfile() {
  const profile = state.profile;
  const modal = el("div", { class: "modal-backdrop" }, [
    el("section", { class: "modal" }, [
      el("header", {}, [el("h2", {}, "Your quest profile"), el("button", { class: "button ghost", onclick: closeModal }, "Close")]),
      el("form", { id: "profile-form", onsubmit: saveProfile }, [
        el("div", { class: "modal-body profile-builder" }, [
          profileInput("name", "Name", profile.name),
          profileChips("hobbies", "Hobbies", ["walking", "music", "food", "plants", "photography", "reading", "sports", "coffee"], profile.hobbies),
          profileChips("goals", "Goals", ["fitness", "social", "errands", "nature", "home", "creativity", "calm", "confidence"], profile.goals),
          profileChips("hates", "Avoid", ["crowds", "heat", "awkward social tasks", "long walks", "noise", "spending money", "sweating", "traffic"], profile.hates),
          profileInput("reminders", "Remember for future quests", profile.reminders.join(", "), "Bring water, carry umbrella"),
          el("div", { class: "setup-row two" }, [
            compactSelect("socialComfort", "Social comfort", ["none", "low", "medium", "high"], profile.socialComfort),
            compactSelect("effortComfort", "Effort comfort", ["low", "medium", "high"], profile.effortComfort)
          ])
        ]),
        el("footer", {}, [
          el("button", { class: "button secondary", type: "button", onclick: seedDemoData }, "Add sample history"),
          el("button", { class: "button", type: "submit" }, "Save profile")
        ])
      ])
    ])
  ]);
  document.body.append(modal);
}

function profileInput(name, label, value, placeholder = "") {
  return el("div", { class: "field" }, [
    el("label", { for: `profile-${name}` }, label),
    el("input", { id: `profile-${name}`, name, value, placeholder })
  ]);
}

function profileChips(name, label, options, selected = []) {
  const selectedSet = new Set(selected);
  return el("fieldset", { class: "profile-chips" }, [
    el("legend", {}, label),
    el(
      "div",
      { class: "chip-grid" },
      options.map((option) =>
        el("label", { class: "select-chip" }, [
          el("input", { type: "checkbox", name, value: option, ...(selectedSet.has(option) ? { checked: "checked" } : {}) }),
          el("span", {}, title(option))
        ])
      )
    ),
    el("input", {
      class: "chip-custom",
      name: `${name}Custom`,
      placeholder: `Add custom ${label.toLowerCase()} separated by commas`
    })
  ]);
}

function closeModal() {
  disposeLocationPicker?.(); disposeLocationPicker = null;
  document.querySelector(".modal-backdrop")?.remove();
}

async function saveProfile(event) {
  event.preventDefault();
  if (!backendReady) return toast("Your history is still connecting. Please try again shortly.");
  const data = Object.fromEntries(new FormData(event.target));
  const profile = {
    name: data.name || "Explorer",
    hobbies: collectProfileList(event.target, "hobbies"),
    goals: collectProfileList(event.target, "goals"),
    hates: collectProfileList(event.target, "hates"),
    reminders: splitList(data.reminders),
    socialComfort: data.socialComfort,
    effortComfort: data.effortComfort
  };
  try { state.profile = (await api("/api/profile", { profile })).profile; }
  catch (error) { return toast(error.message); }
  saveState();
  closeModal();
  render();
  toast("Profile saved. The quest engine now has better taste.");
}

function collectProfileList(form, name) {
  const checked = [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
  const custom = splitList(form.querySelector(`input[name="${name}Custom"]`)?.value || "");
  return unique([...checked, ...custom]).slice(0, 12);
}

async function generateQuests(event) {
  event.preventDefault();
  if (!backendReady || recommendationBusy) return;
  recommendationBusy = true;
  const button = document.querySelector("#generate-button");
  button.disabled = true;
  button.textContent = "Building your deck...";

  const form = new FormData(event.target);
  const context = { ...Object.fromEntries(form), ...(state.location ? { location: state.location } : {}) };
  state.lastContext = context;
  try {
  const data = await api("/api/generate", { context, preferredTemplate: state.preferredActivity?.id || null });
  const candidates = normalizeQuests(data.quests || []);
  state.generated = candidates;
  state.preferredActivity = null;
  state.lastContext = data.context;
  state.liveContext = data.facts;
  state.lastRun = {
    recommendationId: data.id,
    source: data.source,
    ranker: data.ranker,
    context: data.context,
    destinations: data.destinations,
    at: new Date().toISOString()
  };
  saveState();
  toast(data.notice || "Your next three possibilities are ready.");
  } catch (error) { toast(error.message); }
  finally { recommendationBusy = false; render(); }
}


function normalizeQuests(quests) {
  return quests.slice(0, 3).map((quest, index) => ({
    ...quest,
    lane: quest.lane || ["Easy Win", "Useful Quest", "Stretch Quest"][index],
    title: quest.title || "Outside Quest",
    quest_type: quest.quest_type || "movement",
    duration: Number(quest.duration || 15),
    physical_effort: quest.physical_effort || "low",
    social_effort: quest.social_effort || "none",
    why: quest.why || "A small real-world action that beats another scroll.",
    steps: Array.isArray(quest.steps) ? quest.steps : ["Go outside.", "Do the quest.", "Return with one sentence."],
    field_prompt: quest.field_prompt || "What did you notice?",
    prep: Array.isArray(quest.prep) ? quest.prep : [],
    score: Number(quest.score || quest.predicted_score || quest.completion_probability || 0.6),
    ranker: quest.ranker
  }));
}


async function startQuest(index) {
  if (startingQuest || document.querySelector(".field-mode")) return;
  startingQuest = true;
  activeQuest = state.generated[index];
  try {
    const saved = await api("/api/attempts/start", { recommendationId: state.lastRun?.recommendationId, candidateId: activeQuest.id });
    activeAttemptId = saved.attempt.id;
  } catch (error) { activeQuest = null; return toast(error.message); }
  finally { startingQuest = false; }
  activeStartedAt = Date.now();
  remainingSeconds = Number(activeQuest.duration || 15) * 60;
  renderFieldMode();
  activeTimer = setInterval(tickTimer, 1000);
}

function renderFieldMode() {
  const existing = document.querySelector(".field-mode");
  existing?.remove();
  document.body.append(
    el("div", { class: "field-mode" }, [
      el("section", { class: "field-card" }, [
        el("div", { class: "panel-inner" }, [
          el("div", { class: "eyebrow" }, activeQuest.lane),
          el("h2", {}, activeQuest.title),
          el("div", { class: "timer", id: "timer" }, formatTime(remainingSeconds)),
          el("ol", {}, activeQuest.steps.map((step) => el("li", {}, step))),
          activeQuest.prep?.length ? el("p", {}, `Remember: ${activeQuest.prep.join(", ")}`) : null,
          el("div", { class: "quest-actions" }, [
            el("button", { class: "button", onclick: openReflection }, "I'm back"),
            el("button", { class: "button secondary", onclick: cancelFieldMode }, "Cancel")
          ])
        ])
      ])
    ])
  );
}

function tickTimer() {
  remainingSeconds = Math.max(0, remainingSeconds - 1);
  const timer = document.querySelector("#timer");
  if (timer) timer.textContent = formatTime(remainingSeconds);
}

function openReflection() {
  clearInterval(activeTimer);
  document.querySelector(".field-mode")?.remove();
  document.body.append(
    el("div", { class: "modal-backdrop" }, [
      el("section", { class: "modal" }, [
        el("header", {}, [el("h2", {}, "How did it go?"), el("button", { class: "button ghost", onclick: closeModal }, "Close")]),
        el("form", { onsubmit: saveAttempt }, [
          el("div", { class: "modal-body reflection" }, [
            el("div", { class: "field" }, [
              el("label", { for: "status" }, "Result"),
              el("select", { id: "status", name: "status" }, [
                el("option", { value: "completed" }, "Completed"),
                el("option", { value: "partial" }, "Partially completed"),
                el("option", { value: "skipped" }, "Skipped")
              ])
            ]),
            el("div", { class: "field" }, [
              el("label", { for: "liked" }, "Did it feel worth it?"),
              el("select", { id: "liked", name: "liked" }, [
                el("option", { value: "" }, "Not rated"),
                el("option", { value: "true" }, "Yes"),
                el("option", { value: "false" }, "Not really")
              ])
            ]),
            el("div", { class: "field" }, [
              el("label", { for: "benefit" }, "Benefit score"),
              el("select", { id: "benefit", name: "benefit" }, [el("option", { value: "" }, "Not rated"), ...["1", "2", "3", "4", "5"].map((n) => el("option", { value: n }, n))])
            ]),
            el("div", { class: "field" }, [
              el("label", { for: "note" }, activeQuest.field_prompt || "One note"),
              el("textarea", {
                id: "note",
                name: "note",
                placeholder: "Loved it, too crowded, bring water next time, felt better after..."
              })
            ]),
            el("div", { class: "voice-note" }, [
              el("button", { class: "button secondary", type: "button", id: "record-note", onclick: toggleNoteRecording }, "Record note"),
              el("span", { id: "record-status" }, "Optional: dictate your field note.")
            ])
          ]),
          el("footer", {}, [el("button", { class: "button", type: "submit" }, "Save and reward")])
        ])
      ])
    ])
  );
}

async function saveAttempt(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const elapsed = Math.max(1, Math.round((Date.now() - activeStartedAt) / 60000));
  const earnedBefore = earnedBadgeIds();
  let attempt = {
    id: activeAttemptId,
    quest: activeQuest,
    context: state.lastContext || {},
    status: data.status,
    liked: data.liked === "" ? null : data.liked === "true",
    benefit: data.benefit === "" ? null : Number(data.benefit),
    note: data.note,
    minutes: Math.min(elapsed, Number(activeQuest.duration || elapsed)),
    completedAt: new Date().toISOString()
  };
  const button = event.target.querySelector("button[type=submit]"); button.disabled = true;
  try { attempt = (await api("/api/feedback", attempt)).attempt; }
  catch (error) { button.disabled = false; return toast(error.message); }
  state.attempts = [...state.attempts.filter(a => a.id !== attempt.id), attempt];
  state.generated = [];
  state.lastRun = null;
  saveState();
  closeModal();
  render();
  playSuccessSound();
  await rewardVoice(attempt);
  const newBadges = badges.filter((badge) => badge.rule(state) && !earnedBefore.has(badge.id));
  if (newBadges.length) {
    setTimeout(() => revealBadge(newBadges[0], newBadges.length), 3000);
  }
}

async function rewardVoice(attempt) {
  const message = await rewardMessage(attempt);
  await speakMessage(message, { label: "Reward message", visible: false, notices: false });
}

async function speakMessage(message, { label = "Voice", visible = true, notices = true } = {}) {
  const token = ++currentVoiceToken;
  stopVoice({ silent: true });
  currentVoiceToken = token;
  currentVoiceVisible = visible;
  voiceBusy = visible;
  const done = new Promise((resolve) => {
    currentVoiceResolve = resolve;
  });
  if (visible) {
    showVoiceBar(message, label);
    render();
  }

  if (state.useElevenVoice && !elevenLabsUnavailable) {
    try {
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: message })
      });
      const data = await response.json();
      if (token !== currentVoiceToken) return;
      if (data.audio) {
        try {
          currentAudio = new Audio(data.audio);
          currentAudio.addEventListener("ended", () => finishVoice(token));
          currentAudio.addEventListener("error", () => {
            if (token === currentVoiceToken) {
              if (notices) toast("ElevenLabs audio could not play, using browser voice.");
              speakInBrowser(message, token);
            }
          });
          await currentAudio.play();
          return done;
        } catch {
          if (notices) toast("Audio playback was blocked, using browser voice.");
        }
      } else if (data.error) {
        elevenLabsUnavailable = data.error.includes("402");
        if (notices) toast(elevenLabsUnavailable ? "ElevenLabs needs credits or billing access, using browser voice." : "ElevenLabs voice failed, using browser voice.");
      }
    } catch {
      if (notices) toast("Voice service was unavailable, using browser voice.");
    }
  }
  if (token === currentVoiceToken) speakInBrowser(message, token);
  return done;
}

async function rewardMessage(attempt) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    const response = await fetch("/api/reward", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: state.profile, attempt }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (data.message) return data.message;
  } catch {
    // Static fallback below keeps the reward immediate if the local model is cold.
  }
  if (attempt.status === "completed") return `Nice, ${state.profile.name}. You chose the real world for ${attempt.minutes} minutes. That counts.`;
  if (attempt.status === "partial") return `Partial counts, ${state.profile.name}. You interrupted the scroll loop, and that is a real rep.`;
  return `You came back with data. Next quest gets easier because the app learned what did not work.`;
}

function speakInBrowser(message, token = currentVoiceToken) {
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 0.95;
    utterance.pitch = 1.02;
    utterance.onend = () => finishVoice(token);
    utterance.onerror = () => finishVoice(token);
    speechSynthesis.speak(utterance);
  } else {
    finishVoice(token);
  }
}

function finishVoice(token) {
  if (token !== currentVoiceToken) return;
  const resolve = currentVoiceResolve;
  currentVoiceResolve = null;
  voiceBusy = false;
  currentAudio = null;
  if (currentVoiceVisible) {
    hideVoiceBar();
    render();
  }
  currentVoiceVisible = false;
  resolve?.();
}

function stopVoice({ silent = false } = {}) {
  const resolve = currentVoiceResolve;
  currentVoiceResolve = null;
  currentVoiceToken += 1;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  voiceBusy = false;
  if (currentVoiceVisible) {
    hideVoiceBar();
    render();
  }
  currentVoiceVisible = false;
  resolve?.();
  if (!silent) toast("Voice stopped.");
}

function showVoiceBar(message, label) {
  hideVoiceBar();
  const node = el("div", { class: "voice-bar" }, [
    el("div", {}, [el("strong", {}, label), el("span", {}, message)]),
    el("button", { class: "button ghost", onclick: stopVoice }, "Stop")
  ]);
  document.body.append(node);
}

function hideVoiceBar() {
  document.querySelector(".voice-bar")?.remove();
}

async function toggleNoteRecording() {
  const button = document.querySelector("#record-note");
  const status = document.querySelector("#record-status");

  if (noteRecorder?.state === "recording") {
    noteRecorder.stop();
    button.textContent = "Record note";
    status.textContent = "Transcribing...";
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = "Recording is not available in this browser.";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    noteChunks = [];
    noteRecorder = new MediaRecorder(stream);
    noteRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) noteChunks.push(event.data);
    });
    noteRecorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());
      await transcribeNote();
    });
    noteRecorder.start();
    button.textContent = "Stop recording";
    status.textContent = "Listening. Keep it short and natural.";
  } catch {
    status.textContent = "Microphone permission was blocked.";
  }
}

async function transcribeNote() {
  const status = document.querySelector("#record-status");
  const note = document.querySelector("#note");
  const blob = new Blob(noteChunks, { type: noteChunks[0]?.type || "audio/webm" });
  const reader = new FileReader();
  reader.addEventListener("loadend", async () => {
    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audio: reader.result, mimeType: blob.type })
      });
      const data = await response.json();
      if (data.text) {
        note.value = [note.value, data.text].filter(Boolean).join(note.value ? "\n" : "");
        status.textContent = data.source === "elevenlabs" ? "Transcribed with ElevenLabs." : "Transcription unavailable.";
      } else {
        status.textContent = "Transcription unavailable. Type the note instead.";
      }
    } catch {
      status.textContent = "Transcription failed. Type the note instead.";
    }
  });
  reader.readAsDataURL(blob);
}

async function previewQuest(index) {
  const quest = state.generated[index];
  const text = `${quest.lane}. ${quest.title}. ${quest.why}. ${quest.steps.join(" ")}`;
  await speakMessage(text, { label: "Quest read-aloud" });
}

function toggleElevenVoice() {
  state.lastContext = readCurrentContext();
  state.useElevenVoice = !state.useElevenVoice;
  if (!state.useElevenVoice) stopVoice({ silent: true });
  saveState();
  render();
  toast(state.useElevenVoice ? "ElevenLabs voice enabled." : "Browser voice enabled.");
}

function playUiSound() {
  try {
    const sound = new Audio("/audio/eleven-ui-click.wav");
    sound.preload = "auto";
    sound.volume = 0.75;
    sound.play().catch(() => {});
  } catch {
    // Button feedback is optional.
  }
}

function cancelFieldMode() {
  clearInterval(activeTimer);
  document.querySelector(".field-mode")?.remove();
}

function earnedBadgeIds() {
  return new Set(badges.filter((badge) => badge.rule(state)).map((badge) => badge.id));
}

function revealBadge(badge, count = 1) {
  document.querySelector(".badge-reveal")?.remove();
  playBadgeSound();
  const extra = count > 1 ? `+${count - 1} more unlocked` : "new badge unlocked";
  const overlay = el("div", { class: "badge-reveal" }, [
    el("section", { class: `badge-prize ${badge.tone}` }, [
      el("div", { class: "eyebrow" }, extra),
      badgeIcon(badge),
      el("h2", {}, badge.name),
      el("p", {}, badge.text),
      el("button", { class: "button", onclick: () => overlay.remove() }, "Keep going")
    ])
  ]);
  document.body.append(overlay);
  setTimeout(() => overlay.remove(), 7200);
}

function playSuccessSound() {
  playLocalSound("/audio/arcade-reward.wav", 0.55);
}

function playBadgeSound() {
  playLocalSound("/audio/arcade-reward.wav", 0.72);
}

function playLocalSound(src, volume = 0.7) {
  try {
    const sound = new Audio(src);
    sound.preload = "auto";
    sound.volume = volume;
    sound.play().catch(() => {});
  } catch {
    // Reward sound is decorative; never block the flow.
  }
}

function seedDemoData() {
  closeModal();
  activeTab = "lab";
  render();
  lab.refresh();
}

function resetDemo() {
  state.lastContext = readCurrentContext();
  state.generated = []; state.lastRun = null;
  saveState();
  render();
}

function splitList(value = "") {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function title(value = "") {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function containsAny(text, values = []) {
  const lower = text.toLowerCase();
  return values.some((value) => lower.includes(value.toLowerCase()));
}

function totalMinutes(attempts) {
  return attempts.reduce((sum, attempt) => sum + Number(attempt.minutes || 0), 0);
}

function countType(s, type) {
  return s.attempts.filter((attempt) => attempt.quest.quest_type === type && attempt.status !== "skipped").length;
}

function currentStreak(attempts) {
  const days = [...new Set(attempts.filter((a) => a.status !== "skipped").map((a) => a.completedAt.slice(0, 10)))].sort().reverse();
  if (!days.length) return 0;
  let streak = 0;
  const cursor = new Date();
  for (const day of days) {
    const expected = cursor.toISOString().slice(0, 10);
    if (day === expected) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else if (streak === 0) {
      cursor.setDate(cursor.getDate() - 1);
      if (day === cursor.toISOString().slice(0, 10)) streak += 1;
      else break;
    } else {
      break;
    }
  }
  return streak;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const node = el("div", { class: "toast" }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 4200);
}

if (!localStorage.getItem(STORE_KEY)) {
  setTimeout(openProfile, 350);
}

document.addEventListener(
  "pointerdown",
  (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.textContent.trim().toLowerCase().startsWith("stop")) return;
    playUiSound();
  },
  { passive: true }
);

render();
initializeBackend();
