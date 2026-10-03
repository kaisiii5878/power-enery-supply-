/**
 * Application entry point.
 *
 * Mounts the app and points MapLibre at its Vite-managed worker. Everything
 * else lives in feature folders under client/src, so this file stays a wiring
 * file rather than an application.
 */

import { BrowserRouter } from "react-router-dom";
import { createRoot } from "react-dom/client";
import { setWorkerUrl } from "maplibre-gl";
import mapLibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

import App from "./App.jsx";

// MapLibre parses tiles in a worker; Vite has to be told where that worker is.
setWorkerUrl(mapLibreWorkerUrl);

const container = document.getElementById("root");
createRoot(container).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

