export function coordinateLabel(location) {
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
}

export function locationLabel(location) {
  if (!location) return "Not shared";
  if (location.area) return location.alias ? `${location.alias} / ${location.area}` : location.area;
  if (location.label && !/^(my starting point|current location|sample place)$/i.test(location.label)) return location.label;
  return coordinateLabel(location);
}
