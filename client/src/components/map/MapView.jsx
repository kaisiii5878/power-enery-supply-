/**
 * Map components.
 *
 * One canvas serves the citizen map, the console monitor and the report form.
 * Incidents render as severity-coloured circles sized by the incident radius,
 * the user's own position is a separate blue marker, and the controls are plain
 * React overlays so they follow the design system and stay keyboard reachable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, CircleMarker, MapContainer, Popup, useMap, useMapEvents } from "react-leaflet";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { Crosshair, Layers } from "lucide-react";
import { CAMEROON_CENTRE, CAMEROON_ZOOM } from "../../domain/cameroon.js";
import { SEVERITY_COLOR } from "../../domain/incidents.js";
import { formatDistance, pluralise } from "../../lib/format.js";
import { StatusBadge } from "../ui/Badge.jsx";
import { Button } from "../ui/Button.jsx";

const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

/** Basemap tiles. Attribution is rendered by the shell that owns the map. */
function Basemap() {
  const map = useMap();
  useEffect(() => {
    const layer = maplibreGL({ style: BASEMAP_STYLE, interactive: false });
    layer.addTo(map);
    return () => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    };
  }, [map]);
  return null;
}

/** Exposes the Leaflet instance so overlay buttons can drive the camera. */
function MapHandle({ onReady }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
    return () => onReady(null);
  }, [map, onReady]);
  return null;
}

/** Fits the view to the visible incidents, once per distinct data set. */
function FitToIncidents({ incidents, enabled, focusId }) {
  const map = useMap();
  const lastSignature = useRef("");

  useEffect(() => {
    if (!enabled || focusId) return;
    const signature = incidents.map((item) => `${item.id}:${item.latitude},${item.longitude}`).join("|");
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;

    const points = incidents
      .map((item) => [Number(item.latitude), Number(item.longitude)])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

    if (!points.length) {
      map.setView(CAMEROON_CENTRE, CAMEROON_ZOOM);
      return;
    }
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds(points, { padding: [40, 40], maxZoom: 13 });
  }, [incidents, enabled, focusId, map]);

  return null;
}

/** Flies to the selected incident without dropping the user's zoom level. */
function FlyToIncident({ incidents, focusId }) {
  const map = useMap();
  useEffect(() => {
    if (!focusId) return;
    const incident = incidents.find((item) => String(item.id) === String(focusId));
    if (!incident) return;
    const lat = Number(incident.latitude);
    const lng = Number(incident.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    map.flyTo([lat, lng], Math.max(map.getZoom(), 13), { duration: 0.6 });
  }, [focusId, incidents, map]);
  return null;
}

/** "Locate me" behaviour with an explicit, non-blocking failure message. */
function useLocate() {
  const [message, setMessage] = useState("");
  const locate = useCallback((map, zoom = 14) => {
    if (!map) return;
    if (!navigator.geolocation) {
      setMessage("This browser cannot share your location. You can move the map instead.");
      return;
    }
    setMessage("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        map.flyTo([coords.latitude, coords.longitude], zoom, { duration: 0.7 });
        setMessage("");
      },
      () => setMessage("Location access was refused. You can move the map instead."),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 }
    );
  }, []);
  return { locate, message };
}

/** Camera controls; kept off to one side so they never hide the outages. */
function MapTools({ onLocate, onReset, message, extra }) {
  return (
    <div className="map-overlay map-overlay--top-right">
      <div className="map-tools">
        <Button size="sm" variant="outline" icon={Crosshair} onClick={onLocate}>
          Locate me
        </Button>
        <Button size="sm" variant="outline" icon={Layers} onClick={onReset}>
          Whole country
        </Button>
        {extra}
      </div>
      {message ? <small role="status">{message}</small> : null}
    </div>
  );
}

/**
 * The shared incident map.
 *
 * @param incidents        rows from /public/incidents or /incidents
 * @param focusId          incident to fly to
 * @param selectedId       incident to highlight
 * @param onSelectIncident reports the id of the clicked marker
 * @param variant          "canvas" | "panel" | "compact"
 * @param showLocate       offer the geolocation button
 * @param showLegend       show the severity key inside the map
 * @param overlay          extra controls, rendered under the camera buttons
 */
export function MapCanvas({
  incidents = [],
  focusId = null,
  selectedId = null,
  onSelectIncident,
  variant = "canvas",
  showLocate = true,
  showLegend = true,
  overlay,
  label = "Outage map"
}) {
  const [map, setMap] = useState(null);
  const [userPosition, setUserPosition] = useState(null);
  const { locate, message } = useLocate();

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) {
      locate(map);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserPosition([coords.latitude, coords.longitude]);
        locate(map, 13);
      },
      () => locate(map),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 }
    );
  }, [map, locate]);

  const points = useMemo(
    () =>
      incidents
        .map((item) => [Number(item.latitude), Number(item.longitude)])
        .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)),
    [incidents]
  );

  const reset = useCallback(() => {
    if (!map) return;
    if (points.length > 1) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 13 });
      return;
    }
    map.flyTo(CAMEROON_CENTRE, CAMEROON_ZOOM, { duration: 0.6 });
  }, [map, points]);

  const severityLegend = useMemo(
    () =>
      Object.entries(SEVERITY_COLOR).map(([severity, color]) => ({
        label: severity.charAt(0).toUpperCase() + severity.slice(1),
        color
      })),
    []
  );

  return (
    <div className={`map-shell map-shell--${variant}`} role="region" aria-label={label}>
      <MapContainer center={CAMEROON_CENTRE} zoom={CAMEROON_ZOOM} scrollWheelZoom className="map">
        <Basemap />
        <MapHandle onReady={setMap} />
        <FitToIncidents incidents={incidents} enabled={!focusId} focusId={focusId} />
        <FlyToIncident incidents={incidents} focusId={focusId} />

        {incidents.map((incident) => {
          const lat = Number(incident.latitude);
          const lng = Number(incident.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const selected = String(selectedId) === String(incident.id);
          const color = SEVERITY_COLOR[incident.severity] || "#64748b";
          return (
            <Circle
              key={incident.id}
              center={[lat, lng]}
              radius={Number(incident.radius_m || 500)}
              eventHandlers={{ click: () => onSelectIncident?.(incident.id) }}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: selected ? 0.42 : 0.26,
                weight: selected ? 3 : 1.5
              }}
            >
              <Popup>
                <div className="stack stack--sm">
                  <strong>{incident.reference}</strong>
                  <span>{incident.district}</span>
                  <span>
                    {pluralise(incident.reports_count || 0, "report")} ·{" "}
                    {formatDistance(incident.radius_m || 500)} radius
                  </span>
                  <StatusBadge status={incident.status} />
                  {onSelectIncident ? (
                    <Button size="sm" variant="secondary" onClick={() => onSelectIncident(incident.id)}>
                      View details
                    </Button>
                  ) : null}
                </div>
              </Popup>
            </Circle>
          );
        })}

        {userPosition ? (
          <CircleMarker
            center={userPosition}
            radius={8}
            pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#1d4ed8", fillOpacity: 1 }}
          >
            <Popup>Your position</Popup>
          </CircleMarker>
        ) : null}
      </MapContainer>

      {showLocate || overlay ? (
        <MapTools onLocate={handleLocate} onReset={reset} message={message} extra={overlay} />
      ) : null}

      {showLegend ? (
        <div className="map-overlay map-overlay--bottom-right">
          <div className="map-panel">
            <div className="map-chip-row">
              {severityLegend.map((item) => (
                <span className="legend__item" key={item.label}>
                  <span className="legend__swatch" style={{ background: item.color }} aria-hidden="true" />
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Reports a click on the map as a candidate coordinate. */
function ClickToPin({ onPick }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    }
  });
  return null;
}

/** Keeps the pin picker centred on the current choice. */
function CentreOn({ position, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (!position) return;
    map.setView(position, zoom);
  }, [map, position?.[0], position?.[1], zoom]);
  return null;
}

/**
 * Pin picker for the report form. The whole map is the control: a tap moves the
 * pin, which is far easier on a phone than dragging a marker.
 */
export function LocationPicker({ value, onChange, centre, zoom = 11, label = "Tap the map to set the outage location" }) {
  const [map, setMap] = useState(null);
  const { locate, message } = useLocate();
  const position = value ? [value.latitude, value.longitude] : null;

  return (
    <div className="map-shell map-shell--panel" role="region" aria-label="Outage location picker">
      <MapContainer center={centre || CAMEROON_CENTRE} zoom={zoom} scrollWheelZoom className="map">
        <Basemap />
        <MapHandle onReady={setMap} />
        <CentreOn position={position} zoom={15} />
        <ClickToPin onPick={(latitude, longitude) => onChange({ latitude, longitude })} />
        {position ? (
          <CircleMarker
            center={position}
            radius={9}
            pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#0e7490", fillOpacity: 1 }}
          >
            <Popup>Selected outage location</Popup>
          </CircleMarker>
        ) : null}
      </MapContainer>

      <div className="map-overlay map-overlay--top-right">
        <div className="map-tools">
          <Button
            size="sm"
            variant="outline"
            icon={Crosshair}
            onClick={() =>
              navigator.geolocation?.getCurrentPosition(
                ({ coords }) => {
                  onChange({ latitude: coords.latitude, longitude: coords.longitude });
                  locate(map, 15);
                },
                () => locate(map)
              )
            }
          >
            Use my location
          </Button>
          {value ? (
            <Button size="sm" variant="outline" onClick={() => onChange(null)}>
              Clear pin
            </Button>
          ) : null}
        </div>
        <small role="status">{message || label}</small>
      </div>
    </div>
  );
}

export function MapAttribution() {
  return null;
}

