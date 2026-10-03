/**
 * Application context.
 *
 * Holds the two things every screen needs: the signed-in account and the public
 * operational feed. Keeping the feed here means the map, the citizen home page
 * and the agent app all read one request instead of polling the API separately.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { SESSION_EXPIRED_EVENT, authApi, incidentsApi, publicApi } from "../lib/api.js";
import { usePoll } from "../lib/hooks.js";
import { clearSession, getStoredUser, getToken, ROLES, saveSession } from "../lib/session.js";

const AppContext = createContext(null);

const REFRESH_MS = 15_000;

/** Roles allowed to read the richer console incident rows. */
const STAFF_ROLES = [ROLES.OPERATOR, ROLES.AGENT];

export function AppProvider({ children }) {
  const [user, setUser] = useState(() => (getToken() ? getStoredUser() : null));
  const [authNotice, setAuthNotice] = useState("");
  const role = user?.role || user?.user_role || null;

  /**
   * The public feed is deliberately coarse: no zone tags, no first-report time,
   * no reporter data. Staff screens need the fuller console rows, so the source
   * follows the signed-in role and falls back to the public feed if the staff
   * request is refused. Privacy is unchanged — the server decides, not this code.
   */
  const feed = usePoll(
    async () => {
      const [config, announcements] = await Promise.all([publicApi.config(), publicApi.announcements()]);
      const isStaff = user && STAFF_ROLES.includes(role);

      let incidents = [];
      if (isStaff) {
        try {
          incidents = (await incidentsApi.list({})).incidents || [];
        } catch {
          incidents = (await publicApi.incidents()).incidents || [];
        }
      } else {
        incidents = (await publicApi.incidents()).incidents || [];
      }

      return { config, incidents, announcements: announcements.announcements || [] };
    },
    REFRESH_MS,
    [role]
  );

  /**
   * A token that the server rejects ends the session. The listener lives here so
   * every role returns to its own sign-in screen with the same message.
   */
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setAuthNotice("Your session ended or the server restarted. Please sign in again.");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  /** Re-reads the cached account once on load so a stored session carries role/name. */
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    authApi
      .me()
      .then((result) => {
        if (cancelled || !result?.user) return;
        saveSession({ user: result.user });
        setUser(result.user);
      })
      .catch(() => {
        /* the session-expired listener handles a rejected token */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (session) => {
    saveSession(session);
    setAuthNotice("");
    setUser(session.user);
    // `/auth/login` returns the raw account row. `/auth/me` resolves it into the
    // shape the UI reads — `role`, `name` and, for a crew, `company`. Fetching it
    // once here means no screen has to guess which shape it was given.
    try {
      const fresh = await authApi.me();
      if (fresh?.user) {
        saveSession({ user: fresh.user });
        setUser(fresh.user);
      }
    } catch {
      /* the session from the login response is still usable */
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* a stateless token: logging out locally is enough */
    }
    clearSession();
    setUser(null);
  }, []);

  /** Re-reads the account so a deactivated login is noticed immediately. */
  const refreshUser = useCallback(async () => {
    if (!getToken()) return null;
    try {
      const result = await authApi.me();
      if (result?.user) {
        saveSession({ user: result.user });
        setUser(result.user);
      }
      return result?.user || null;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      role: user?.role || user?.user_role || null,
      isAgent: (user?.role || user?.user_role) === ROLES.AGENT,
      isOperator: (user?.role || user?.user_role) === ROLES.OPERATOR,
      isCitizen: (user?.role || user?.user_role) === ROLES.CITIZEN,
      authNotice,
      setAuthNotice,
      signIn,
      signOut,
      refreshUser,
      config: feed.data?.config || null,
      incidents: feed.data?.incidents || [],
      announcements: feed.data?.announcements || [],
      feedLoading: feed.loading,
      feedError: feed.error,
      reloadFeed: feed.reload
    }),
    [user, authNotice, signIn, signOut, refreshUser, feed.data, feed.loading, feed.error, feed.reload]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside <AppProvider>");
  return context;
}

/** Convenience: the public config, with the server defaults until it arrives. */
export function useClusteringConfig() {
  const { config } = useApp();
  return (
    config?.clustering || {
      cluster_distance_m: 500,
      cluster_window_minutes: 30,
      min_reports_to_qualify: 1
    }
  );
}

export function useReportCategories() {
  const { config } = useApp();
  return config?.report_categories || ["Total outage", "Low voltage", "Flickering", "Sparking / unsafe line", "Meter problem", "Other"];
}
