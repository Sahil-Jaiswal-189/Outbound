import { inputError } from "./store.mjs";
import { selectRouteDestinations } from "./place-matching.mjs";

export function validateContext(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw inputError("Outing context is required.");
  const minutes = Number(value.minutes);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 180) throw inputError("Available time must be 5 to 180 minutes.");
  const context = { minutes, mood: String(value.mood || "restless").slice(0, 40),
    energy: ["low", "medium", "high"].includes(value.energy) ? value.energy : "medium",
    goal: String(value.goal || "fitness").slice(0, 40), locality: String(value.locality || "unknown").slice(0, 40),
    weather: String(value.weather || "unknown").slice(0, 30), note: String(value.note || "").slice(0, 500) };
  if (value.location != null) {
    const { latitude, longitude } = value.location;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw inputError("Invalid location coordinates.");
    }
    context.location = { latitude, longitude, label: String(value.location.label || "Current location").slice(0, 120),
      approximate: Boolean(value.location.approximate), area: String(value.location.area || "").slice(0, 160),
      alias: String(value.location.alias || "").slice(0, 100) };
  }
  return context;
}

export function distanceMeters(a, b) {
  const rad = value => value * Math.PI / 180;
  const deltaLat = rad(b.latitude - a.latitude), deltaLon = rad(b.longitude - a.longitude);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function weatherName(code) {
  if (code >= 95) return "thunderstorm";
  if (code >= 71 && code <= 77 || code >= 85 && code <= 86) return "snowy";
  if (code >= 51 && code <= 67 || code >= 80 && code <= 82) return "rainy";
  return code <= 1 ? "clear" : code <= 3 ? "cloudy" : "foggy";
}

export function createSources(store, { fetchImpl = fetch, env = process.env } = {}) {
  const pending = new Map();
  const placeFailures = new Map();
  const failureReason = error => error.name === "TimeoutError" || error.name === "AbortError" ? "timeout"
    : /^upstream_http_\d+$|^invalid_[a-z_]+_response$/.test(error.message) ? error.message : "request_failed";
  async function request(url, options = {}, timeoutMs = 5000) {
    const response = await fetchImpl(url, { ...options,
      headers: { Accept: "application/json", "User-Agent": "Outbound/0.1 (https://github.com/Sahil-Jaiswal-189/Outbound)", ...options.headers },
      signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`upstream_http_${response.status}`);
    return response.json();
  }
  async function cached(source, key, ttl, fn) {
    const data = store.cacheGet(key);
    if (data) return { source, status: "cached", fetchedAt: data.fetchedAt, data };
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      try {
        const fresh = { ...await fn(), fetchedAt: new Date().toISOString() };
        store.cachePut(key, source, fresh, ttl);
        return { source, status: "live", fetchedAt: fresh.fetchedAt, data: fresh };
      } catch (error) {
        return { source, status: "unavailable", reason: failureReason(error), attempts: error.attempts, data: null };
      }
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  const coordinateKey = location => `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
  async function weather(location, minutes) {
    const key = `weather:${coordinateKey(location)}:${Math.ceil(minutes / 30)}`;
    return cached("open-meteo", key, 10 * 60_000, async () => {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({ latitude: location.latitude, longitude: location.longitude, timezone: "GMT",
        current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day",
        hourly: "precipitation_probability,precipitation,weather_code,temperature_2m,wind_speed_10m",
        daily: "sunrise,sunset", forecast_days: "2" }).toString();
      const result = await request(url);
      if (!result.current || !Array.isArray(result.hourly?.time)) throw new Error("invalid_weather_response");
      const now = Date.now(), end = now + minutes * 60_000;
      const indices = result.hourly.time.map((time, i) => ({ i, time: Date.parse(`${time}Z`) }))
        .filter(item => item.time + 3600000 > now && item.time <= end).map(item => item.i);
      const max = (field, fallback = null) => {
        const values = indices.map(i => result.hourly[field]?.[i]).filter(Number.isFinite);
        return values.length ? Math.max(...values) : fallback;
      };
      const code = Number(result.current.weather_code);
      return { condition: weatherName(code), temperature: result.current.temperature_2m,
        apparentTemperature: result.current.apparent_temperature, rainProbability: max("precipitation_probability"),
        precipitation: max("precipitation", result.current.precipitation), wind: max("wind_speed_10m", result.current.wind_speed_10m),
        daylight: result.current.is_day === 1 ? true : result.current.is_day === 0 ? false : null, sunset: result.daily?.sunset?.[0] || null,
        thunderstorm: code >= 95 || indices.some(i => result.hourly.weather_code?.[i] >= 95),
        attribution: "Weather data by Open-Meteo" };
    });
  }
  async function airQuality(location) {
    const response = await cached("open-meteo-air", `air:v2:${coordinateKey(location)}`, 30 * 60_000, async () => {
      const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
      url.search = new URLSearchParams({ latitude: location.latitude, longitude: location.longitude, current: "us_aqi,pm2_5", timezone: "GMT" }).toString();
      const attempts = [];
      for (const timeout of [5000, 8000]) {
        const started = Date.now();
        try {
          const result = await request(url, {}, timeout);
          if (!Number.isFinite(result.current?.us_aqi)) throw new Error("invalid_air_response");
          attempts.push({ status: "live", elapsedMs: Date.now() - started });
          return { aqi: result.current.us_aqi, pm25: result.current.pm2_5, modeled: true,
            validAt: result.current.time ? `${result.current.time}Z` : null, attempts,
            attribution: "Air quality: Open-Meteo / CAMS" };
        } catch (error) {
          attempts.push({ status: "unavailable", reason: failureReason(error), elapsedMs: Date.now() - started });
          if (timeout === 8000 || !["timeout", "request_failed"].includes(failureReason(error)) && !/^upstream_http_5\d\d$/.test(error.message)) {
            throw Object.assign(error, { attempts });
          }
        }
      }
    });
    return { ...response, attempts: response.data?.attempts || response.attempts };
  }
  async function places(location, radius) {
    const key = `places:v3:${coordinateKey(location)}:${radius}`;
    const failed = placeFailures.get(key);
    if (failed?.until > Date.now()) return { ...failed.result, retryAfterSeconds: Math.ceil((failed.until - Date.now()) / 1000) };
    const response = await cached("overpass", key, 24 * 3600_000, async () => {
      const { latitude, longitude } = location;
      const query = `[out:json][timeout:15];(nwr(around:${radius},${latitude},${longitude})[leisure~"^(park|garden|recreation_ground|pitch)$"];nwr(around:${radius},${latitude},${longitude})[shop~"^(supermarket|convenience|greengrocer)$"];nwr(around:${radius},${latitude},${longitude})[amenity~"^(library|marketplace|community_centre)$"];);out body center 60;`;
      // Custom/self-hosted endpoints stay private unless a fallback is explicitly configured.
      const customEndpoint = env.OVERPASS_URL && env.OVERPASS_URL !== "https://overpass-api.de/api/interpreter";
      const fallback = env.OVERPASS_FALLBACK_URL ?? (customEndpoint ? "" : "https://overpass.private.coffee/api/interpreter");
      const endpoints = [...new Set([env.OVERPASS_URL || "https://overpass-api.de/api/interpreter", fallback].filter(Boolean))];
      const attempts = [];
      let result;
      for (const endpoint of endpoints) {
        const started = Date.now();
        try {
          result = await request(endpoint, {
            method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ data: query }).toString()
          }, 35000);
          if (!Array.isArray(result.elements) || result.remark) throw new Error("invalid_places_response");
          attempts.push({ server: new URL(endpoint).hostname, status: "live", elapsedMs: Date.now() - started });
          break;
        } catch (error) {
          attempts.push({ server: new URL(endpoint).hostname, status: "unavailable", reason: failureReason(error), elapsedMs: Date.now() - started });
          // Respect rate limits and configuration errors; do not keep retrying them.
          if (endpoint === endpoints.at(-1) || /^upstream_http_4\d\d$/.test(error.message)) {
            throw Object.assign(error, { attempts });
          }
        }
      }
      const items = result.elements.map(item => ({ id: `${item.type}/${item.id}`, name: item.tags?.name,
        kind: item.tags?.shop ? "shop" : item.tags?.leisure || item.tags?.amenity, latitude: item.lat ?? item.center?.lat,
        longitude: item.lon ?? item.center?.lon, access: item.tags?.access,
        openingHours: item.tags?.opening_hours || null, foot: item.tags?.foot,
        sport: item.tags?.sport || null, shopType: item.tags?.shop || null }))
        .filter(item => item.name && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
          && !["private", "no"].includes(item.access) && item.foot !== "no")
        .map(item => ({ ...item, distanceMeters: Math.round(distanceMeters(location, item)) }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 24);
      return { places: items, attempts, attribution: "OpenStreetMap contributors (ODbL)", openingHoursVerified: false };
    });
    if (response.status === "unavailable") {
      if (placeFailures.size >= 100) placeFailures.delete(placeFailures.keys().next().value);
      placeFailures.set(key, { result: response, until: Date.now() + 30_000 });
    } else placeFailures.delete(key);
    return response;
  }
  async function route(location, place) {
    if (!env.ORS_API_KEY) return { source: "openrouteservice", status: "not_configured", reason: "missing_api_key", data: null };
    return cached("openrouteservice", `route:${coordinateKey(location)}:${place.id}:${place.latitude},${place.longitude}`, 24 * 3600_000, async () => {
      const result = await request("https://api.openrouteservice.org/v2/directions/foot-walking", {
        method: "POST", headers: { "content-type": "application/json", Authorization: env.ORS_API_KEY },
        body: JSON.stringify({ coordinates: [[location.longitude, location.latitude], [place.longitude, place.latitude],
          [location.longitude, location.latitude]], instructions: false })
      });
      const summary = result.routes?.[0]?.summary;
      if (!Number.isFinite(summary?.duration) || summary.duration < 0 || !Number.isFinite(summary?.distance) || summary.distance < 0) throw new Error("invalid_route_response");
      return { travelMinutes: Math.ceil(summary.duration / 60), distanceMeters: Math.round(summary.distance),
        attribution: "Routing: openrouteservice / OpenStreetMap", estimate: true };
    });
  }
  async function gather(context, log, { preferredTemplate = null } = {}) {
    if (!context.location) {
      const skipped = ["open-meteo", "open-meteo-air", "overpass", "openrouteservice"].map(source => ({ source, status: "skipped", reason: "no_location" }));
      skipped.forEach(result => log("source", result));
      return { weather: null, airQuality: null, places: [], sources: skipped, locationAvailable: false };
    }
    const radius = Math.max(200, Math.min(1500, Math.floor(context.minutes / 2 * 65)));
    if (context.location.approximate) {
      const [w, a] = await Promise.all([weather(context.location, context.minutes), airQuality(context.location)]);
      const sources = [w, a].map(({ data, ...status }) => status);
      sources.push(...["overpass", "openrouteservice"].map(source => ({ source, status: "skipped", reason: "area_location_only" })));
      sources.forEach(result => log("source", result));
      return { weather: w.data, airQuality: a.data, places: [], sources, locationAvailable: true };
    }
    const [w, a, p] = await Promise.all([weather(context.location, context.minutes), airQuality(context.location), places(context.location, radius)]);
    const routeTargets = selectRouteDestinations(p.data?.places || [], context, { preferredTemplate });
    const routeIds = new Set(routeTargets.map(p => p.id));
    log("route_selection", { limit: 3, placeIds: [...routeIds], goal: context.goal });
    const routed = await Promise.all((p.data?.places || []).map(async place => ({ ...place,
      route: routeIds.has(place.id) ? await route(context.location, place) : { source: "openrouteservice", status: "skipped", reason: "route_budget", data: null } })));
    const sources = [w, a, p].map(({ data, ...status }) => status);
    const routes = routed.filter(place => routeIds.has(place.id)).map(place => {
      const { data, ...status } = place.route;
      return { ...status, placeId: place.id, placeName: place.name, placeKind: place.kind,
        travelMinutes: data?.travelMinutes ?? null, distanceMeters: data?.distanceMeters ?? null };
    });
    sources.push(...(!env.ORS_API_KEY ? [{ source: "openrouteservice", status: "not_configured", reason: "missing_api_key" }]
      : routes.length ? routes : [{ source: "openrouteservice", status: "skipped", reason: p.status === "unavailable" ? "places_unavailable" : "no_destination" }]));
    sources.forEach(result => log("source", result));
    return { weather: w.data, airQuality: a.data, places: routed, sources, locationAvailable: true };
  }
  async function geocode(query) {
    if (typeof query !== "string" || query.trim().length < 2 || query.length > 100) throw inputError("Enter a town or city (2 to 100 characters).");
    return cached("open-meteo-geocoding", `geocode:${query.trim().toLowerCase()}`, 7 * 24 * 3600_000, async () => {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.search = new URLSearchParams({ name: query.trim(), count: "5", language: "en", format: "json" }).toString();
      const result = await request(url);
      return { locations: (result.results || []).map(item => ({ latitude: item.latitude, longitude: item.longitude,
        label: [item.name, item.admin1, item.country].filter(Boolean).join(", "), approximate: true })) };
    });
  }
  async function reverseGeocode(value) {
    const location = validateContext({ minutes: 5, location: value }).location;
    if (!location) throw inputError("Location coordinates are required.");
    if (!env.ORS_API_KEY) return { source: "openrouteservice-geocoding", status: "not_configured", reason: "missing_api_key", data: null };
    return cached("openrouteservice-geocoding", `reverse:${coordinateKey(location)}`, 7 * 24 * 3600_000, async () => {
      const url = new URL("https://api.openrouteservice.org/geocode/reverse");
      url.search = new URLSearchParams({ "point.lat": location.latitude, "point.lon": location.longitude,
        layers: "neighbourhood,locality,borough", size: "1" }).toString();
      const result = await request(url, { headers: { Authorization: env.ORS_API_KEY } });
      const properties = result.features?.[0]?.properties;
      const area = properties?.label || properties?.name;
      if (typeof area !== "string" || !area.trim()) throw new Error("invalid_geocoding_response");
      return { area: area.trim().slice(0, 160), layer: properties.layer || null,
        attribution: "Area names: openrouteservice / Pelias / OpenStreetMap" };
    });
  }
  return { gather, geocode, reverseGeocode, weather, airQuality, places, route };
}
