import { ACTIVITY_CATALOG } from "./catalog.mjs";
import { intentReason } from "./activity-policy.mjs";

const rules = {
  green: [
    "gentle-walk", "brisk-loop", "pace-ladder", "outdoor-mobility", "posture-stroll", "rhythm-walk", "shade-loop", "talk-pace", "finish-easy", "park-lap", "nature-quiet-seat",
    "nature-noticing", "leaf-shapes", "bird-listening", "cloud-study", "tree-bark", "insect-watch", "fallen-leaf", "bird-movement",
    "wind-in-trees", "flower-observe", "tree-canopy", "nature-sound-map", "season-signs", "grass-observation", "tree-silhouettes", "seed-heads", "sky-colours",
    "texture-hunt", "colour-collection", "sound-layers", "shadow-patterns", "tiny-landmark",
    "outdoor-sketch", "outdoor-reading", "three-line-poem", "mental-photo", "one-line-drawing", "sound-poem", "colour-palette",
    "sky-journal", "shape-composition", "shadow-sketch", "six-word-story", "texture-drawing", "nature-metaphor", "silent-melody", "paper-viewfinder"
  ],
  library: ["outdoor-reading", "library-return", "outdoor-sketch", "architecture-sketch", "sign-typography", "doorway-design", "practical-check"],
  sports: ["gentle-walk", "outdoor-mobility", "posture-stroll", "rhythm-walk", "talk-pace", "ball-practice"],
  errands: ["practical-check", "essential-top-up", "pantry-list-walk", "market-list", "price-compare", "refill-check", "sign-typography"],
};
const goals = {
  fitness: ["green", "sports"], nature: ["green"], calm: ["green"],
  errands: ["errands"], home: ["errands"], creativity: ["green", "library"], social: ["green", "sports"]
};

export function placeGroup(place) {
  if (["park", "garden", "recreation_ground"].includes(place.kind)) return "green";
  if (place.kind === "library") return "library";
  if (place.kind === "pitch") return "sports";
  if (["shop", "marketplace"].includes(place.kind)) return "errands";
  return null;
}

export function activityPlaceGroups(activityId) {
  return Object.entries(rules).filter(([, ids]) => ids.includes(activityId)).map(([group]) => group);
}

function compatibleActivities(place, context) {
  const group = placeGroup(place), note = String(context.note || "").toLowerCase();
  return ACTIVITY_CATALOG.filter(activity => (rules[group] || []).includes(activity.id)
    && !intentReason(activity.id, note)
    && (activity.id !== "ball-practice" || String(place.sport || "").split(";").some(sport => ["basketball", "soccer"].includes(sport.trim()))));
}

export function selectRouteDestinations(places, context, { limit = 3, preferredTemplate = null } = {}) {
  const priority = goals[context.goal] || [];
  const ranked = places.filter(place => placeGroup(place) && !["private", "no"].includes(place.access) && place.foot !== "no" && place.openingHours !== "off")
    .map(place => ({ place, matches: compatibleActivities(place, context) }))
    .filter(row => row.matches.length)
    .sort((a, b) => Number(b.matches.some(q => q.id === preferredTemplate)) - Number(a.matches.some(q => q.id === preferredTemplate))
      || Number(priority.includes(placeGroup(b.place))) - Number(priority.includes(placeGroup(a.place)))
      || (a.place.distanceMeters ?? Infinity) - (b.place.distanceMeters ?? Infinity));
  const selected = [];
  // Cover different opportunities before spending the bounded route budget on another similar venue.
  for (const { place } of ranked) {
    if (!selected.some(p => placeGroup(p) === placeGroup(place)) && selected.length < limit) selected.push(place);
  }
  for (const { place } of ranked) {
    if (selected.length >= limit) break;
    if (!selected.some(p => p.id === place.id)) selected.push(place);
  }
  return selected;
}

function balanceTypes(activities) {
  const groups = [...new Set(activities.map(a => a.type))].map(type => activities.filter(a => a.type === type));
  const result = [];
  for (let i = 0; groups.some(group => i < group.length); i++) {
    for (const group of groups) if (group[i]) result.push(group[i]);
  }
  return result;
}

export function matchPlaceActivities(places, context) {
  const matches = new Map(), diagnostics = [];
  for (const place of places) {
    const group = placeGroup(place);
    const entry = { placeId: place.id, name: place.name, group, candidateActivities: [], skipped: [] };
    diagnostics.push(entry);
    if (!group) { entry.skipped.push("unsupported_place_type"); continue; }
    if (["private", "no"].includes(place.access) || place.foot === "no") { entry.skipped.push("restricted_access"); continue; }
    if (place.openingHours === "off") { entry.skipped.push("marked_closed"); continue; }
    if (!["live", "cached"].includes(place.route?.status) || !place.route?.data) { entry.skipped.push("no_verified_walking_route"); continue; }
    const travelMinutes = place.route.data.travelMinutes;
    if (!Number.isFinite(travelMinutes) || travelMinutes < 0) { entry.skipped.push("invalid_travel_time"); continue; }
    const available = Math.floor(context.minutes - travelMinutes - 2);
    const compatible = compatibleActivities(place, context);
    entry.compatibleCount = compatible.length;
    const feasible = compatible.filter(a => a.minMinutes <= available);
    if (!feasible.length) { entry.skipped.push(compatible.length ? "insufficient_time_at_destination" : "no_compatible_activity"); continue; }
    for (const activity of balanceTypes(feasible).slice(0, 12)) {
      const activityMinutes = Math.min(activity.maxMinutes, available);
      entry.candidateActivities.push(activity.id);
      const previous = matches.get(activity.id);
      if (!previous || travelMinutes < previous.travelMinutes) {
        matches.set(activity.id, { activity, place, group, travelMinutes, activityMinutes, bufferMinutes: 2 });
      }
    }
  }
  const selected = [...matches.values()];
  for (const entry of diagnostics) {
    entry.consideredActivities = entry.candidateActivities;
    entry.candidateActivities = selected.filter(m => m.place.id === entry.placeId).map(m => m.activity.id);
    if (entry.consideredActivities.length && !entry.candidateActivities.length) entry.skipped.push("closer_compatible_destination_selected");
  }
  return { matches: selected, diagnostics };
}

export function placedActivitySteps({ activity, place, group, travelMinutes, activityMinutes, bufferMinutes }) {
  const arrival = `Walk to ${place.name} using a suitable public walking route; allow about ${travelMinutes} minutes for the round trip.`;
  let action = activity.action;
  if (activity.id === "outdoor-reading") action = "Read your own book in a permitted outdoor spot at or near the destination, if one is available; seating is not verified.";
  if (activity.id === "library-return") action = "Only return your borrowed book if this is a library you use and it confirms it accepts the return; a return box and opening hours are unverified.";
  if (activity.id === "practical-check") action = "Check this destination's posted hours or services from a permitted public area. Opening hours and facilities are unverified.";
  if (activity.id === "market-list") action = "Compare this destination's publicly displayed goods with your existing shopping needs, if displays are available. No purchase required.";
  if (group === "sports" && activity.id === "ball-practice") action += " Use the sports ground only if entry and your chosen activity are permitted; equipment and availability are unverified.";
  const uncertainty = group === "errands" ? "Access, stock and opening hours" : group === "library" ? "Access, facilities and opening hours" : "Access and facilities";
  return [arrival, `Spend up to ${activityMinutes} minutes on this activity: ${action}`,
    `Keep ${bufferMinutes} minutes in reserve and leave time for the return. ${uncertainty} are unverified; skip the activity if conditions or permission are unsuitable.`];
}
