/**
 * Report flow controller.
 *
 * Owns the guided report state machine: which step is open, the draft, per-step
 * validation, the optional place lookup and the submit call. Keeping it out of
 * the view means the steps can be reordered or tested without touching JSX.
 */

import { useCallback, useMemo, useState } from "react";
import { publicApi } from "../../lib/api.js";
import { CAMEROON_CENTRE, citiesFor, composeDistrict, matchRegion, quartersFor } from "../../domain/cameroon.js";

export const STEPS = ["Location", "Outage details", "Extra information", "Review"];

function emptyDraft(region = "Littoral", reporterName = "") {
  const city = citiesFor(region)[0] || "";
  return {
    region,
    city,
    quarter: quartersFor(region, city)[0] || "",
    latitude: null,
    longitude: null,
    category: "Total outage",
    description: "",
    phone: "",
    reporterName
  };
}

export function useReportFlow({ reporterName = "", onSent }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => emptyDraft("Littoral", reporterName));
  const [errors, setErrors] = useState({});
  const [places, setPlaces] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locationNotice, setLocationNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const district = useMemo(() => composeDistrict(draft), [draft]);
  const centre = draft.latitude != null ? [draft.latitude, draft.longitude] : CAMEROON_CENTRE;

  const update = useCallback((patch) => setDraft((current) => ({ ...current, ...patch })), []);
  const clearError = useCallback(
    (key) => setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current)),
    []
  );

  /** Validates one step and explains exactly what is missing and how to fix it. */
  const validate = useCallback(
    (target = step) => {
      const found = {};
      if (target === 0) {
        if (draft.latitude == null || draft.longitude == null) {
          found.location = "Place the pin with “Use my location” or by tapping the map.";
        }
        if (!draft.quarter.trim()) found.quarter = "Enter the quarter or neighbourhood of the outage.";
        if (!draft.city.trim()) found.city = "Enter the city or town.";
      }
      if (target === 1 && !draft.category) {
        found.category = "Choose what kind of problem you are reporting.";
      }
      setErrors((current) => ({ ...current, ...found }));
      return Object.keys(found).length === 0;
    },
    [draft, step]
  );

  const next = useCallback(() => {
    if (!validate(step)) return false;
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, validate]);

  const back = useCallback(() => {
    setErrors({});
    setStep((current) => Math.max(0, current - 1));
  }, []);

  /** Optional GPS capture. A refusal only changes the instruction, never blocks. */
  const useCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationNotice("This browser cannot share a location. Tap the map to place the pin instead.");
      return;
    }
    setLocationNotice("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        update({ latitude: coords.latitude, longitude: coords.longitude });
        setLocationNotice("Location captured. You can still adjust the pin on the map.");
        clearError("location");
      },
      () => setLocationNotice("Location permission was refused. Tap the map to place the pin instead."),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 }
    );
  }, [update, clearError]);

  /** Optional place lookup, proxied by our own server. */
  const lookupPlace = useCallback(async () => {
    const query = [draft.quarter, draft.city, draft.region].filter(Boolean).join(", ");
    if (query.trim().length < 3) return;
    setSearching(true);
    setPlaces([]);
    try {
      const result = await publicApi.geocode(query);
      const rows = result.places || [];
      setPlaces(rows);
      setLocationNotice(
        rows.length
          ? "Choose a mapped match, or keep your own wording and place the pin yourself."
          : "No mapped match found. Keep your own quarter name and place the pin on the map."
      );
    } catch (error) {
      setLocationNotice(error.message);
    } finally {
      setSearching(false);
    }
  }, [draft.quarter, draft.city, draft.region]);

  const choosePlace = useCallback(
    (place) => {
      update({
        region: matchRegion(place.region) || draft.region,
        city: place.city || draft.city,
        quarter: place.name || draft.quarter,
        latitude: place.latitude,
        longitude: place.longitude
      });
      setPlaces([]);
      setLocationNotice(`Location set to ${place.displayName}.`);
      clearError("location");
    },
    [update, draft.region, draft.city, draft.quarter, clearError]
  );

  /** Sends the report and hands the server's reference back to the caller. */
  const submit = useCallback(async () => {
    if (!validate(0)) {
      setStep(0);
      return;
    }
    setBusy(true);
    setSubmitError("");
    try {
      const result = await publicApi.submitReport({
        latitude: draft.latitude,
        longitude: draft.longitude,
        category: draft.category,
        district,
        description: draft.description || undefined,
        phone: draft.phone || undefined,
        reporterName: draft.reporterName || undefined
      });
      onSent({
        ...result,
        submittedAt: new Date().toISOString(),
        district,
        category: draft.category
      });
    } catch (error) {
      setSubmitError(error.message);
    } finally {
      setBusy(false);
    }
  }, [validate, draft, district, onSent]);

  return {
    step,
    setStep,
    draft,
    update,
    errors,
    district,
    centre,
    places,
    searching,
    locationNotice,
    setLocationNotice,
    busy,
    submitError,
    next,
    back,
    validate,
    useCurrentLocation,
    lookupPlace,
    choosePlace,
    submit
  };
}
