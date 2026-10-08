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
let integrations = null;
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
      el("section", { class: "grid" }, [
        el("div", {}, [
          el("section", { class: "panel" }, [
            el("div", { class: "panel-inner" }, [
              el("div", { class: "hero-copy" }, [
                el("div", { class: "eyebrow" }, "Anti-feed quest engine"),
                el("h2", {}, "Do the thing outside."),
                el(
                  "p",
                  {},
                  "Outbound recommends small real-world quests from your goals, dislikes, energy, past notes, and local context. The screen is the launcher, not the destination."
                )
              ]),
              renderContextForm(),
              el("div", { class: "stats-row" }, [
                statCard(completed, "quests completed"),
                statCard(`${minutes}m`, "real-world minutes"),
                statCard(streak, "day streak")
              ])
            ])
          ]),
          renderHistory()
        ]),
        el("aside", {}, [renderQuestPanel(), renderBadges()])
      ])
    ])
  );
}

function renderTopbar() {
  return el("header", { class: "topbar" }, [
    el("div", { class: "brand" }, [
      el("div", { class: "brand-mark" }, "TG"),
      el("div", {}, [
        el("h1", {}, "Touch Grass: Outbound"),
        el("p", {}, `For ${state.profile.name || "Explorer"}: less scrolling, more living.`)
      ])
    ]),
    el("div", { class: "top-actions" }, [
      renderIntegrationPills(),
      renderVoiceControls(),
      el("button", { class: "button secondary", onclick: openProfile }, "Edit profile"),
      el("button", { class: "button ghost", onclick: resetDemo }, "Reset demo")
    ])
  ]);
}

function renderVoiceControls() {
  return el("div", { class: "voice-controls" }, [
    el(
      "button",
      { class: `button secondary voice-toggle ${state.useElevenVoice ? "active" : ""}`, onclick: toggleElevenVoice },
      state.useElevenVoice ? "Eleven voice on" : "Browser voice"
    ),
    voiceBusy ? el("button", { class: "button ghost", onclick: stopVoice }, "Stop voice") : null
  ]);
}

function renderIntegrationPills() {
  const items = integrations
    ? [
        ["Gemma", integrations.ollama?.reachable ? "on" : "fallback"],
        ["SerpApi", integrations.serpapi?.configured ? "on" : "off"],
        ["TabPFN", integrations.tabpfn?.reachable ? "on" : integrations.tabpfn?.configured ? "waiting" : "off"],
        ["Voice", integrations.elevenlabs?.configured ? "elevenlabs" : "browser"]
      ]
    : [["Hooks", "checking"]];

  return el(
    "div",
    { class: "hook-strip", title: "Integration status" },
    items.map(([name, status]) => el("span", { class: `hook-pill ${status}` }, `${name}: ${status}`))
  );
}

function renderContextForm() {
  const todayGoal = state.profile.goals[0] || "fitness";
  return el("form", { class: "quest-setup", id: "quest-form", onsubmit: generateQuests }, [
    choiceGroup("minutes", "How much time?", ["5", "10", "15", "20", "30", "45"], "15", (value) => `${value}m`),
    choiceGroup("mood", "What state are you in?", ["tired", "restless", "bored", "anxious", "curious", "focused"], "restless"),
    choiceGroup("energy", "Energy", ["low", "medium", "high"], "medium"),
    choiceGroup("goal", "Today's direction", unique([...state.profile.goals, "fitness", "social", "errands", "nature", "home", "creativity"]), todayGoal),
    el("div", { class: "setup-row two" }, [
      compactSelect("locality", "Place vibe", ["residential", "market", "campus", "office", "park", "unknown"], "residential"),
      compactSelect("weather", "Weather", ["clear", "hot", "cloudy", "rainy", "windy", "unknown"], "unknown")
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "context-note" }, "Constraint or tiny wish"),
      el("input", {
        id: "context-note",
        name: "note",
        placeholder: "Avoid crowds, need to buy milk, want something easy..."
      })
    ]),
    el("button", { class: "button big-action", type: "submit", id: "generate-button" }, "Generate 3 quests")
  ]);
}

function choiceGroup(name, label, options, value, format = title) {
  return el("fieldset", { class: "choice-group" }, [
    el("legend", {}, label),
    el(
      "div",
      { class: "choice-grid" },
      options.map((option) =>
        el("label", { class: "choice-tile" }, [
          el("input", { type: "radio", name, value: option, ...(option === value ? { checked: "checked" } : {}) }),
          el("span", {}, format(option))
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

function statCard(value, label) {
  return el("div", { class: "stat" }, [el("strong", {}, String(value)), el("span", {}, label)]);
}

function renderQuestPanel() {
  return el("section", { class: "panel" }, [
    el("div", { class: "panel-inner" }, [
      el("div", { class: "section-title" }, [
        el("div", {}, [el("h3", {}, "Quest deck"), el("p", {}, questPanelSubtitle())])
      ]),
      state.generated.length
        ? el("div", { class: "quest-stack" }, state.generated.map(renderQuestCard))
        : el("div", { class: "empty-state" }, "Set your context and generate three quests. Pick one, then let the app get quiet.")
    ])
  ]);
}

function questPanelSubtitle() {
  if (state.lastRun?.ranker === "tabpfn") return "Generated by the quest engine and ranked by TabPFN.";
  if (state.lastRun?.source === "ollama") return "Generated by local Gemma/Ollama, ranked from your history.";
  if (state.liveContext?.available) return "Grounded with live context and your local history.";
  if (state.generated.length) return "Ranked from your profile and attempt history.";
  return "No infinite feed. Just three doors.";
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
      el("span", { class: "pill" }, title(quest.quest_type || "action")),
      el("span", { class: "pill" }, `score ${Math.round((quest.score || 0.6) * 100)}`),
      quest.ranker ? el("span", { class: "pill" }, quest.ranker) : null
    ]),
    el("h4", {}, quest.title || "Outside Quest"),
    el("p", {}, quest.why || "A small action that makes the real world easier to choose."),
    el(
      "ol",
      {},
      (quest.steps || []).slice(0, 3).map((step) => el("li", {}, step))
    ),
    el("div", { class: "quest-actions" }, [
      el("button", { class: "button", onclick: () => startQuest(index) }, "Start"),
      el("button", { class: "button secondary", onclick: () => previewQuest(index) }, "Read aloud")
    ])
  ]);
}

function renderHistory() {
  const recent = [...state.attempts].reverse().slice(0, 8);
  return el("section", { class: "panel", style: "margin-top: 20px;" }, [
    el("div", { class: "panel-inner" }, [
      el("div", { class: "section-title" }, [
        el("div", {}, [el("h3", {}, "Field log"), el("p", {}, "Your notes stay in this browser.")])
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
        : el("div", { class: "empty-state" }, "Complete or partially complete a quest to start your field log.")
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
  document.querySelector(".modal-backdrop")?.remove();
}

function saveProfile(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  state.profile = {
    name: data.name || "Explorer",
    hobbies: collectProfileList(event.target, "hobbies"),
    goals: collectProfileList(event.target, "goals"),
    hates: collectProfileList(event.target, "hates"),
    reminders: splitList(data.reminders),
    socialComfort: data.socialComfort,
    effortComfort: data.effortComfort
  };
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
  const button = document.querySelector("#generate-button");
  button.disabled = true;
  button.textContent = "Building your deck...";

  const form = new FormData(event.target);
  const context = Object.fromEntries(form);
  state.lastContext = context;
  const memories = retrieveMemories(context);

  state.liveContext = await fetchLiveContext(context);
  const payload = {
    profile: state.profile,
    context: { ...context, liveContext: state.liveContext?.summary },
    memories,
    history: structuredHistory()
  };

  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  const candidates = normalizeQuests(data.quests || []);
  state.generated = data.ranker === "tabpfn" ? candidates : rankQuests(candidates, context);
  state.lastRun = {
    source: data.source || "local-fallback",
    ranker: data.ranker || "local",
    at: new Date().toISOString()
  };
  saveState();
  render();
  if (data.ranker === "tabpfn") toast("TabPFN ranked this deck from your structured history.");
  else toast(data.source === "ollama" ? "Gemma/Ollama shaped this quest deck." : "Offline quest engine shaped this deck.");
}

async function fetchLiveContext(context) {
  const query = `${context.weather || ""} ${context.locality || ""} outdoor things nearby ${state.profile.goals.join(" ")}`.trim();
  try {
    const response = await fetch("/api/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query })
    });
    return await response.json();
  } catch {
    return { available: false, source: "offline", summary: "Live context unavailable." };
  }
}

function normalizeQuests(quests) {
  return quests.slice(0, 3).map((quest, index) => ({
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

function rankQuests(quests, context) {
  return quests
    .map((quest) => ({ ...quest, score: scoreQuest(quest, context) }))
    .sort((a, b) => b.score - a.score)
    .sort((a, b) => laneOrder(a.lane) - laneOrder(b.lane));
}

function scoreQuest(quest, context) {
  const attempts = state.attempts;
  let score = 0.52;
  const similar = attempts.filter((attempt) => attempt.quest.quest_type === quest.quest_type);
  const completedSimilar = similar.filter((attempt) => attempt.status === "completed");
  const likedSimilar = similar.filter((attempt) => attempt.liked);

  if (similar.length) score += (completedSimilar.length / similar.length) * 0.2;
  if (similar.length) score += (likedSimilar.length / similar.length) * 0.14;
  if (quest.duration <= Number(context.minutes)) score += 0.08;
  if (quest.social_effort === "none" && state.profile.socialComfort === "none") score += 0.08;
  if (quest.social_effort === "low" && ["low", "medium", "high"].includes(state.profile.socialComfort)) score += 0.04;
  if (quest.physical_effort === "low" && context.energy === "low") score += 0.08;
  if (quest.physical_effort === "medium" && context.energy === "high") score += 0.06;
  if (containsAny(quest.title + quest.why, state.profile.hates)) score -= 0.16;
  if (attempts.slice(-3).some((attempt) => attempt.quest.title === quest.title)) score -= 0.22;

  return Math.max(0.05, Math.min(0.98, score));
}

function laneOrder(lane = "") {
  if (lane.toLowerCase().includes("easy")) return 0;
  if (lane.toLowerCase().includes("useful")) return 1;
  return 2;
}

function retrieveMemories(context) {
  const terms = [context.goal, context.mood, context.energy, context.note, ...state.profile.hates, ...state.profile.reminders]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 2);

  return state.attempts
    .map((attempt) => {
      const text = `${attempt.note || ""} ${attempt.quest.title} ${attempt.quest.quest_type}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
      return { text: attempt.note || attempt.quest.title, score };
    })
    .filter((memory) => memory.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function structuredHistory() {
  return state.attempts.map((attempt) => ({
    minutes_available: attempt.context?.minutes || attempt.quest.duration || attempt.minutes,
    mood_before: attempt.context?.mood || "unknown",
    energy_before: attempt.context?.energy || "unknown",
    goal_type: attempt.context?.goal || attempt.quest.quest_type || "unknown",
    locality_type: attempt.context?.locality || "unknown",
    weather: attempt.context?.weather || "unknown",
    quest_type: attempt.quest.quest_type || "action",
    quest_duration: attempt.quest.duration || attempt.minutes,
    physical_effort: attempt.quest.physical_effort || "unknown",
    social_effort: attempt.quest.social_effort || "unknown",
    status: attempt.status,
    completed: attempt.status === "completed",
    liked: Boolean(attempt.liked),
    benefit_score: Number(attempt.benefit || 3),
    note: attempt.note || ""
  }));
}

function startQuest(index) {
  activeQuest = state.generated[index];
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
                el("option", { value: "true" }, "Yes"),
                el("option", { value: "false" }, "Not really")
              ])
            ]),
            el("div", { class: "field" }, [
              el("label", { for: "benefit" }, "Benefit score"),
              el("select", { id: "benefit", name: "benefit" }, ["1", "2", "3", "4", "5"].map((n) => el("option", { value: n }, n)))
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
  const attempt = {
    id: crypto.randomUUID(),
    quest: activeQuest,
    context: state.lastContext || {},
    status: data.status,
    liked: data.liked === "true",
    benefit: Number(data.benefit),
    note: data.note,
    minutes: Math.min(elapsed, Number(activeQuest.duration || elapsed)),
    completedAt: new Date().toISOString()
  };
  state.attempts.push(attempt);
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
  const now = Date.now();
  const demo = [
    ["Future-You Errand", "errand", "completed", true, 5, "Buying fruit during a walk felt useful. Remind me to carry a bag."],
    ["Two-Block Reset", "movement", "completed", true, 4, "Good after work, but avoid the crowded main road."],
    ["Hobby in the Wild", "curiosity", "partial", true, 4, "I liked finding textures. Keep quests short when it is hot."]
  ].map(([titleText, type, status, liked, benefit, note], index) => ({
    id: crypto.randomUUID(),
    quest: { title: titleText, quest_type: type },
    status,
    liked,
    benefit,
    note,
    minutes: 12 + index * 4,
    completedAt: new Date(now - index * 86400000).toISOString()
  }));
  state.attempts = [...state.attempts, ...demo];
  saveState();
  closeModal();
  render();
  toast("Sample history added. The ranker has something to learn from.");
}

function resetDemo() {
  if (!confirm("Reset profile, quests, and history for this browser?")) return;
  localStorage.removeItem(STORE_KEY);
  Object.assign(state, loadState());
  render();
}

async function refreshIntegrationStatus() {
  try {
    const response = await fetch("/api/status");
    integrations = await response.json();
    render();
  } catch {
    integrations = null;
  }
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
refreshIntegrationStatus();
