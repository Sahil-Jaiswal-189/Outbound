export function requestTimeout(env, name, fallback) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value >= 1000 && value <= 120000 ? Math.floor(value) : fallback;
}
