export const sourceReason = code => ({
  timeout: "Provider timed out", request_failed: "Provider could not be reached", invalid_air_response: "Provider returned no usable AQI",
  upstream_http_429: "Provider rate limit reached", missing_api_key: "Routing key missing", no_location: "Starting point not shared",
  area_location_only: "Area selected, not an exact starting point", no_destination: "No compatible named destination found",
  places_unavailable: "Nearby-place lookup unavailable", destination_after_dark: "Named destinations excluded after dark",
  insufficient_time_at_destination: "Not enough time after the walking round trip", time_budget: "Exceeds the available time",
  no_verified_walking_route: "Walking route unavailable", no_feasible_destination: "No feasible named destination",
  needs_verified_destination: "This activity needs a verified destination", low_energy: "Effort exceeds your energy setting",
  effort_preference: "Effort exceeds your preference", needs_daylight: "Needs daylight", current_movement_constraint: "Walking excluded by your note"
})[code] || (code ? code.replaceAll("_", " ") : "-");

export function sourceDetail(source, facts) {
  if (source.source === "openrouteservice" && source.placeId) {
    const place = facts.places?.find(p => p.id === source.placeId);
    const minutes = source.travelMinutes ?? place?.route?.data?.travelMinutes;
    return `${source.placeName || place?.name || source.placeId}${Number.isFinite(minutes) ? ` / ${minutes}m walking round trip` : ""}`;
  }
  if (source.source === "open-meteo" && facts.weather) {
    const w = facts.weather;
    return [w.condition, Number.isFinite(w.temperature) ? `${w.temperature} C` : null,
      w.daylight === false ? "after dark" : w.daylight === true ? "daylight" : null,
      Number.isFinite(w.rainProbability) ? `${w.rainProbability}% rain chance` : null].filter(Boolean).join(" / ");
  }
  if (source.source === "open-meteo-air" && facts.airQuality) {
    const a = facts.airQuality;
    return `Modeled US AQI ${a.aqi}${Number.isFinite(a.pm25) ? ` / PM2.5 ${a.pm25} micrograms/m3` : ""}`;
  }
  if (source.source === "overpass" && facts.places) return `${facts.places.length} mapped places`;
  return sourceReason(source.reason);
}
