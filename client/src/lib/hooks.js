/**
 * Shared React hooks.
 *
 * `useAsync` is the workhorse behind every data screen: it exposes loading,
 * error and retry so no page has to hand-roll the same three states.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Runs an async loader and tracks { data, error, loading }.
 *
 * @param loader   async function; receiving no arguments
 * @param deps     dependency list controlling when the loader re-runs
 * @param options  { immediate = true, initialData = null }
 */
export function useAsync(loader, deps = [], { immediate = true, initialData = null } = {}) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const [reloadCount, setReloadCount] = useState(0);
  const mounted = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!immediate && reloadCount === 0) return undefined;
    let cancelled = false;
    setLoading(true);
    Promise.resolve()
      .then(() => loaderRef.current())
      .then((result) => {
        if (cancelled || !mounted.current) return;
        setData(result);
        setError(null);
      })
      .catch((caught) => {
        if (cancelled || !mounted.current) return;
        if (caught?.name === "AbortError") return;
        setError(caught);
      })
      .finally(() => {
        if (cancelled || !mounted.current) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadCount, immediate]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);
  return { data, error, loading, reload, setData };
}

/**
 * Re-runs a loader on an interval. Used by the live monitor and the
 * notification badge; the interval is skipped while the tab is hidden so a
 * background tab does not poll the API.
 */
export function usePoll(loader, intervalMs, deps = []) {
  const { data, error, loading, reload, setData } = useAsync(loader, deps);
  const [paused, setPaused] = useState(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (paused || !intervalMs) return undefined;
    const timer = setInterval(() => {
      loaderRef.current()
        .then((result) => setData(result))
        .catch(() => {
          /* a failed poll keeps the last good data on screen */
        });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [paused, intervalMs, setData]);

  return { data, error, loading, reload, setData };
}

/**
 * Wraps a mutation with a busy flag and a normalised error, so buttons can
 * disable themselves and show a spinner without repeating the pattern.
 */
export function useAsyncAction(action) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(
    async (...args) => {
      setBusy(true);
      setError(null);
      try {
        return await action(...args);
      } catch (caught) {
        setError(caught);
        throw caught;
      } finally {
        setBusy(false);
      }
    },
    [action]
  );

  return { run, busy, error, clearError: () => setError(null) };
}

export function useDebounced(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Locks body scroll while a modal, drawer or sheet is open. */
export function useBodyScrollLock(locked) {
  useEffect(() => {
    if (!locked) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [locked]);
}

/** Calls `onClose` on Escape — shared by modal, drawer and sheet. */
export function useEscapeKey(onClose, active) {
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, active]);
}

/** Case-insensitive, multi-field text match used by every search box. */
export function useTextMatch(rows, term, fields) {
  return useMemo(() => {
    const needle = String(term || "").trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      fields.some((field) => String(row?.[field] ?? "").toLowerCase().includes(needle))
    );
  }, [rows, term, fields]);
}
