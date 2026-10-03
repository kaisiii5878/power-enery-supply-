/**
 * Notification inbox.
 *
 * Notifications are audience-scoped by the API: a citizen never sees operator
 * alerts. This module owns the polling, the unread count and the presentation,
 * so all three roles share one experience.
 */

import { useCallback, useMemo, useState } from "react";
import { Bell, BellDot, CheckCheck, Radio } from "lucide-react";
import { sessionApi } from "../../lib/api.js";
import { usePoll } from "../../lib/hooks.js";
import { formatRelative } from "../../lib/format.js";
import { notificationKind } from "../../domain/incidents.js";
import { useApp } from "../../app/AppContext.jsx";
import {
  Alert,
  Button,
  CountPill,
  EmptyState,
  ErrorState,
  List,
  ListRow,
  ListSkeleton
} from "../../components/ui/index.js";

const POLL_MS = 20_000;

/** Polls the inbox and exposes the unread count plus a "mark all read" action. */
export function useNotifications() {
  const { user } = useApp();
  const enabled = Boolean(user);

  const feed = usePoll(
    async () => {
      if (!enabled) return [];
      const result = await sessionApi.notifications();
      return result.notifications || [];
    },
    enabled ? POLL_MS : 0,
    [enabled]
  );

  const notifications = feed.data || [];
  const unread = useMemo(() => notifications.filter((item) => !Number(item.is_read)).length, [notifications]);

  const markAllRead = useCallback(async () => {
    if (!unread) return;
    await sessionApi.markNotificationsRead();
    feed.setData((current) => (current || []).map((item) => ({ ...item, is_read: 1 })));
  }, [unread, feed]);

  return {
    notifications,
    unread,
    loading: feed.loading && enabled,
    error: feed.error,
    reload: feed.reload,
    markAllRead,
    enabled
  };
}

/** Top-bar bell. Renders nothing when there is no signed-in account. */
export function NotificationBell({ onOpen }) {
  const { enabled, unread } = useNotifications();
  if (!enabled) return null;
  return (
    <button
      type="button"
      className="shell__icon-button"
      onClick={onOpen}
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      title="Notifications"
    >
      {unread ? <BellDot size={20} aria-hidden="true" /> : <Bell size={20} aria-hidden="true" />}
      <CountPill count={unread} label="unread notifications" />
    </button>
  );
}

/**
 * The inbox itself. Read and unread items differ by marker and by weight, not
 * only by colour, and each row can open the incident it is about.
 */
export function NotificationsPanel({ onOpenIncident, emptyMessage }) {
  const { notifications, unread, loading, error, reload, markAllRead } = useNotifications();
  const [filter, setFilter] = useState("all");

  const visible = filter === "unread" ? notifications.filter((item) => !Number(item.is_read)) : notifications;

  return (
    <section className="stack" aria-label="Notifications">
      <div className="split">
        <div className="inline-row" role="group" aria-label="Filter notifications">
          <Button size="sm" variant={filter === "all" ? "secondary" : "ghost"} onClick={() => setFilter("all")}>
            All
          </Button>
          <Button size="sm" variant={filter === "unread" ? "secondary" : "ghost"} onClick={() => setFilter("unread")}>
            Unread{unread ? ` (${unread})` : ""}
          </Button>
        </div>
        <Button size="sm" variant="outline" icon={CheckCheck} onClick={markAllRead} disabled={!unread}>
          Mark all read
        </Button>
      </div>

      <div className="card">
        {loading ? (
          <div className="card__body">
            <ListSkeleton rows={4} />
          </div>
        ) : error ? (
          <ErrorState compact title="We could not load your notifications" error={error} onRetry={reload} />
        ) : visible.length === 0 ? (
          <EmptyState
            compact
            icon={Bell}
            title={filter === "unread" ? "Nothing unread" : "No notifications yet"}
            message={
              emptyMessage ||
              "Assignments, validations and restoration confirmations appear here as they happen."
            }
          />
        ) : (
          <List>
            {visible.map((item) => {
              const kind = notificationKind(item.event_type);
              const isUnread = !Number(item.is_read);
              const clickable = Boolean(onOpenIncident && item.incident_id);
              return (
                <ListRow
                  key={item.id}
                  as={clickable ? "button" : "div"}
                  type={clickable ? "button" : undefined}
                  onClick={clickable ? () => onOpenIncident(item.incident_id) : undefined}
                  title={
                    <span className="inline-row" style={{ gap: "var(--space-2)" }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          display: "inline-block",
                          flex: "0 0 auto",
                          background: isUnread ? "var(--brand-600)" : "var(--neutral-300)"
                        }}
                      />
                      {item.title}
                      {isUnread ? <span className="sr-only"> (unread)</span> : null}
                    </span>
                  }
                  meta={
                    <>
                      <span className="badge" data-tone={kind.tone}>
                        {kind.label}
                      </span>
                      <span>{item.message}</span>
                      <span>{formatRelative(item.created_at)}</span>
                    </>
                  }
                  aside={clickable ? <Radio size={14} aria-hidden="true" /> : null}
                />
              );
            })}
          </List>
        )}
      </div>

      {!loading && !error && unread > 0 ? (
        <Alert tone="info" title={`${unread} unread`}>
          Opening an incident from here keeps the notification in your history.
        </Alert>
      ) : null}
    </section>
  );
}

