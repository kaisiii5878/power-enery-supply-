/**
 * Place search proxy for the report form.
 *
 * Proxied through the server so the citizen's search text is not sent straight
 * from the browser to a third party, and so results can be cached and filtered
 * to Cameroon. Requests are serialised and throttled to respect the public
 * Photon API usage policy.
 */

const express = require("express");
const { badRequest } = require("../http/errors");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 1100;
const CACHE_MAX_ENTRIES = 500;

function createGeocoder({ log = console } = {}) {
  const cache = new Map();
  let queue = Promise.resolve();
  let lastRequestAt = 0;

  function request(url) {
    const run = queue.then(async () => {
      const waitMs = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      lastRequestAt = Date.now();
      const response = await fetch(url, { headers: { "User-Agent": "PowerWatchCameroon/1.0 (community electricity incident reporting)" } });
      if (!response.ok) throw new Error(`Place search returned HTTP ${response.status}.`);
      return response.json();
    });
    queue = run.catch(() => {}); // a failed lookup must not jam the queue
    return run;
  }

  async function search(query) {
    const clean = String(query || "").trim().slice(0, 180);
    if (clean.length < 3) throw badRequest("Enter at least 3 characters to search for a place.");
    const key = clean.toLocaleLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return { places: cached.places, cached: true };

    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", `${clean}, Cameroon`);
    url.searchParams.set("limit", "10");
    url.searchParams.set("lang", "en");
    url.searchParams.append("layer", "locality");
    url.searchParams.append("layer", "district");

    const result = await request(url);
    const places = (result.features || [])
      .filter(feature => {
        const code = String(feature.properties?.countrycode || "").toUpperCase();
        const country = String(feature.properties?.country || "").toLowerCase();
        return code === "CM" || country === "cameroon";
      })
      .map(feature => {
        const properties = feature.properties || {};
        const [longitude, latitude] = feature.geometry?.coordinates || [];
        const name = properties.name || properties.district || properties.city || "Unnamed place";
        return {
          name,
          district: properties.district || properties.locality || "",
          city: properties.city || properties.county || "",
          region: properties.state || "",
          displayName: [name, properties.district, properties.city, properties.state]
            .filter((part, index, all) => part && all.indexOf(part) === index)
            .join(", "),
          latitude: Number(latitude),
          longitude: Number(longitude)
        };
      })
      .filter(place => Number.isFinite(place.latitude) && Number.isFinite(place.longitude));

    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { places, expiresAt: Date.now() + CACHE_TTL_MS });
    return { places, cached: false };
  }

  return {
    async searchPlaces(query) {
      try {
        return await search(query);
      } catch (error) {
        if (error.status) throw error;
        log.warn?.(`[geocode] place lookup unavailable: ${error.message}`);
        const unavailable = new Error("Place lookup is temporarily unavailable. You can still enter a quarter and pin it on the map.");
        unavailable.status = 502;
        throw unavailable;
      }
    }
  };
}

module.exports = function createGeocodeRoutes({ auth, log } = {}) {
  const geocoder = createGeocoder({ log });
  const router = express.Router();

  /** Rate-limited per account (or per IP for guests) to keep the public API fair. */
  const buckets = new Map();
  function throttle(req, res, next) {
    const key = String(req.auth?.id || req.ip);
    const now = Date.now();
    const bucket = buckets.get(key) || { count: 0, resetAt: now + 60_000 };
    if (bucket.resetAt < now) { bucket.count = 0; bucket.resetAt = now + 60_000; }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > 20) {
      const error = new Error("Too many place lookups. Try again in a minute.");
      error.status = 429;
      return next(error);
    }
    return next();
  }

  router.get("/quarters", auth.optionalAuth, throttle, async (req, res, next) => {
    try {
      res.json(await geocoder.searchPlaces(req.query.q));
    } catch (error) {
      next(error);
    }
  });

  return router;
};

module.exports.createGeocoder = createGeocoder;
