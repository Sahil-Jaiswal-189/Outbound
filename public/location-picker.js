import { coordinateLabel } from "./location-labels.js";

export function openStartingPointPicker({ el, api, initial, onSave, onClose }) {
  let map = null, marker = null, selected = null, searching = false;
  let lookupTimer = null, lookupPromise = null, selectionId = 0, closed = false;
  const latitude = el("input", { type: "number", name: "latitude", min: -90, max: 90, step: "any", required: "" });
  const longitude = el("input", { type: "number", name: "longitude", min: -180, max: 180, step: "any", required: "" });
  const label = el("input", { name: "pointLabel", maxlength: 100, placeholder: "Optional nickname, e.g. home or park gate" });
  const areaName = el("strong", {}, "No starting point selected");
  const areaCoordinates = el("span");
  const selectedArea = el("div", { class: "map-area", role: "status" }, [areaName, areaCoordinates]);
  const saveButton = el("button", { class: "button", type: "submit" }, "Use starting point");
  const mapNode = el("div", { class: "location-map", "aria-label": "Starting point map" });
  const mapStatus = el("p", { class: "map-status", role: "status" });
  const results = el("div", { class: "location-results" });
  const query = el("input", { name: "pointSearch", minlength: 2, maxlength: 100, placeholder: "Town or city", required: "" });
  const searchButton = el("button", { class: "button secondary", type: "submit" }, "Search");
  function resolveArea(point, id) {
    return api("/api/location/reverse", point).then(result => {
      if (closed || id !== selectionId) return;
      point.area = result.area || "";
      areaName.textContent = point.area || coordinateLabel(point);
      areaCoordinates.textContent = point.area ? coordinateLabel(point) : "Area name unavailable";
    }).catch(() => {
      if (closed || id !== selectionId) return;
      areaName.textContent = coordinateLabel(point);
      areaCoordinates.textContent = "Area name unavailable";
    });
  }
  function choose(lat, lon, area = "") {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) return;
    clearTimeout(lookupTimer); lookupTimer = null; lookupPromise = null;
    const id = ++selectionId;
    selected = { latitude: lat, longitude: lon, area };
    areaName.textContent = area || "Finding area...";
    areaCoordinates.textContent = coordinateLabel(selected);
    if (!area) {
      const point = selected;
      lookupTimer = setTimeout(() => { lookupTimer = null; lookupPromise = resolveArea(point, id); }, 350);
    }
    latitude.value = lat.toFixed(6); longitude.value = lon.toFixed(6);
    if (map) {
      if (marker) marker.setLatLng([lat, lon]);
      else {
        marker = window.L.marker([lat, lon], { draggable: true, title: "Starting point" }).addTo(map);
        marker.on("dragend", () => { const point = marker.getLatLng().wrap(); choose(point.lat, point.lng); });
      }
    }
  }
  function updateFromCoordinates() {
    if (!latitude.value || !longitude.value || !latitude.checkValidity() || !longitude.checkValidity()) return;
    choose(Number(latitude.value), Number(longitude.value));
    map?.setView([selected.latitude, selected.longitude], 15);
  }
  latitude.addEventListener("change", updateFromCoordinates);
  longitude.addEventListener("change", updateFromCoordinates);
  const modal = el("div", { class: "modal-backdrop" }, el("section", { class: "modal location-picker" }, [
    el("header", {}, [el("h2", {}, "Set starting point"), el("button", { class: "button ghost", onclick: onClose }, "Close")]),
    el("div", { class: "modal-body" }, [
      el("form", { class: "point-search", onsubmit: async event => {
        event.preventDefault();
        if (searching) return;
        searching = true; searchButton.disabled = true; mapStatus.textContent = "Searching...";
        try {
          const data = await api("/api/location", { query: query.value });
          if (!modal.isConnected) return;
          results.replaceChildren(...data.locations.map(location => el("button", { class: "button secondary", type: "button", onclick: () => {
            map?.setView([location.latitude, location.longitude], 15);
            results.replaceChildren();
            mapStatus.textContent = "Area found. Starting point not selected.";
          } }, location.label)));
          mapStatus.textContent = data.locations.length ? "" : "No areas found.";
        } catch { mapStatus.textContent = "Area search is unavailable."; }
        finally { searching = false; searchButton.disabled = false; }
      } }, [el("label", { class: "field" }, ["Find area", query]), searchButton]),
      results, mapNode, mapStatus, selectedArea,
      el("form", { class: "point-form", onsubmit: async event => {
        event.preventDefault();
        if (!latitude.value || !longitude.value || !latitude.checkValidity() || !longitude.checkValidity()) return;
        const lat = Number(latitude.value), lon = Number(longitude.value);
        if (!selected || selected.latitude !== lat || selected.longitude !== lon) choose(lat, lon);
        const point = selected, id = selectionId;
        if (lookupTimer) {
          clearTimeout(lookupTimer); lookupTimer = null;
          lookupPromise = resolveArea(point, id);
        }
        saveButton.disabled = true;
        await lookupPromise;
        saveButton.disabled = false;
        if (closed || id !== selectionId) return;
        const alias = label.value.trim();
        onSave({ ...point, alias, label: point.area ? (alias ? `${alias} / ${point.area}` : point.area) : (alias || coordinateLabel(point)),
          approximate: false, method: "manual" });
      } }, [
        el("div", { class: "point-coordinates" }, [el("label", { class: "field" }, ["Latitude", latitude]), el("label", { class: "field" }, ["Longitude", longitude])]),
        el("label", { class: "field" }, ["Place name", label]),
        saveButton
      ])
    ])
  ]));
  document.body.append(modal);
  if (window.L) {
    map = window.L.map(mapNode, { worldCopyJump: true }).setView(initial ? [initial.latitude, initial.longitude] : [20, 0], initial ? 14 : 2);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).on("tileerror", () => { mapStatus.textContent = "Map tiles are unavailable. Coordinate entry is available."; }).addTo(map);
    map.on("click", event => { choose(event.latlng.lat, event.latlng.wrap().lng); mapStatus.textContent = "Starting point selected."; });
    map.invalidateSize();
  } else mapStatus.textContent = "Map is unavailable. Coordinate entry is available.";
  // A city centre only positions the map; it never becomes a precise starting point automatically.
  if (initial && !initial.approximate) {
    choose(initial.latitude, initial.longitude, initial.area);
    label.value = initial.alias || (!initial.area && !/^(my starting point|current location|sample place)$/i.test(initial.label || "") ? initial.label || "" : "");
  }
  return () => { closed = true; ++selectionId; clearTimeout(lookupTimer); map?.remove(); map = null; modal.remove(); };
}
