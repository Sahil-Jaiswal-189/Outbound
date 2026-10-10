import { GOALS, HOBBIES } from "./activity-policy.mjs";

function previousNote(quest, attempts) {
  return attempts.filter(a => a.completedAt && a.note && a.quest.quest_type === quest.quest_type).at(-1);
}

export function rememberedPreparation(quest, attempts) {
  const note = previousNote(quest, attempts)?.note || "";
  return ["water", "umbrella", "snack", "reusable bag"].filter(item => {
    const positive = new RegExp(`\\b(?:bring|carry|pack|take) (?:a |an |my |your |the |some )?${item}\\b`, "i");
    const negative = new RegExp(`\\b(?:don't|do not|no need to) (?:bring|carry|pack|take) (?:a |an |my |your |the |some )?${item}\\b`, "i");
    return positive.test(note) && !negative.test(note);
  }).map(item => `Bring ${item} (from your previous note).`);
}

export function destinationAvailability(context, facts, candidates, rejected) {
  const local = candidates.filter(q => q.destination);
  const rejectedIds = new Set(rejected.map(q => q.id));
  const reasons = [...new Set(rejected.filter(q => local.some(item => item.id === q.id)).flatMap(q => q.reasons))];
  if (!context.location) reasons.push("no_location");
  else if (context.location.approximate) reasons.push("area_location_only");
  else if (!local.length) reasons.push(...facts.sources.filter(s => ["overpass", "openrouteservice"].includes(s.source))
    .map(s => s.reason).filter(Boolean), "no_feasible_destination");
  return { mapped: facts.places.length, routed: facts.places.filter(p => p.route?.data).length,
    eligible: local.filter(q => !rejectedIds.has(q.id)).length, reasons: [...new Set(reasons)] };
}

export function explainQuest(quest, { context, profile, history, facts, decision, destinations, attempts = [] }) {
  const reasons = [];
  const add = (kind, text, source) => reasons.push({ kind, text, source });
  add("time", `${quest.duration} minutes fits your ${context.minutes}-minute budget.`, "current settings");
  add("energy", `${quest.physical_effort} physical effort fits your ${context.energy} energy setting and effort preference.`, "current settings / profile");
  if ((GOALS[context.goal] || []).includes(quest.quest_type)) add("goal", `Matches your ${context.goal} direction.`, "current goal");
  const hobbies = profile.hobbies.filter(h => HOBBIES[h] === quest.quest_type);
  if (hobbies.length) add("interest", `Connects with your interest in ${hobbies.join(", ")}.`, "profile");
  const similar = history.filter(row => row.quest_type === quest.quest_type);
  const rated = similar.filter(row => typeof row.liked === "boolean");
  if (similar.length) add("history", `Your ${quest.quest_type} history: ${similar.filter(row => row.completed).length}/${similar.length} completed; ${rated.filter(row => row.liked).length}/${rated.length} rated positively.`, "saved outcomes");
  else add("history", `No ${quest.quest_type} outcomes yet; predictions are provisional.`, "saved outcomes");
  const note = previousNote(quest, attempts);
  if (note) add("note", `Previous note for this activity type: ${note.note.slice(0, 140)}`, "your reflection");
  for (const prep of rememberedPreparation(quest, attempts)) add("preparation", prep, "your reflection");
  if (quest.destination) add("place", `${quest.destination.name}: ${quest.travel_minutes} minutes walking round trip, ${quest.activity_minutes} minutes on site, ${quest.buffer_minutes} minutes reserve. Access and opening hours are unverified.`, "OpenStreetMap / openrouteservice");
  else add("place", `${context.location ? "Near your starting point on a familiar public route" : "At a familiar public spot you choose"}; no named destination is attached.${!destinations.eligible && destinations.reasons.includes("destination_after_dark") ? " Named destinations were excluded because it is after dark." : ""}`, "destination checks");
  if (facts.weather) add("weather", `${facts.weather.condition}${Number.isFinite(facts.weather.temperature) ? `, ${facts.weather.temperature} C` : ""}; ${facts.weather.daylight === false ? "after dark" : facts.weather.daylight === true ? "daylight" : "daylight unknown"}${Number.isFinite(facts.weather.rainProbability) ? `; rain chance ${facts.weather.rainProbability}%` : ""}.`, "Open-Meteo forecast");
  if (facts.airQuality) add("air", `Modeled US AQI ${facts.airQuality.aqi}${Number.isFinite(facts.airQuality.pm25) ? `; PM2.5 ${facts.airQuality.pm25} micrograms/m3` : ""}. This is a regional model estimate, not a local sensor reading.`, "Open-Meteo / CAMS");
  else add("air", "Air quality is unavailable for this run; no claim about clean air is made.", "source status");
  if (quest.scoring_mode === "outcome-average") add("ranking", `Ranking averages completion and liking estimates equally, then subtracts repetition penalties (${quest.ranker} predictions). Mood is a predictor input, not an extra scoring bonus.`, "scoring policy");
  else if (quest.scoring_mode === "preference-fallback") add("ranking", "Neither target uses TabPFN in this run. Ranking uses explicit goal/hobby preferences minus repetition penalties; category-baseline probabilities are provisional and do not determine this score.", "fallback policy");
  if (decision?.decision === "explore") add("selection", "An exploration pick from a less-tried activity type, after feasibility checks.", "selection policy");
  else if (decision?.decision === "user_pick") add("selection", "You chose this activity; it passed the outing checks.", "your choice");
  else add("selection", "Selected among similarly scored feasible options; recent suggestions are avoided where alternatives exist.", "selection policy");
  const summary = [reasons.find(r => r.kind === "place" && quest.destination),
    reasons.find(r => r.kind === "goal"), reasons.find(r => r.kind === "time")].filter(Boolean).slice(0, 2).map(r => r.text).join(" ");
  return { summary, reasons, predictions: { completion: quest.completion_probability, enjoyment: quest.liked_probability,
    engine: quest.ranker }, scoringMode: quest.scoring_mode, historyRows: similar.length, decision: decision?.decision || null };
}
