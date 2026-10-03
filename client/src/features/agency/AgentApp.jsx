/**
 * Field agent workspace.
 *
 * Built around the crew's actual order of work: open an assignment, check where
 * it is and how bad it is, start travel, begin intervention, fill in the
 * technical report, complete. The queue is the landing screen and the next action
 * is always a single button — nothing critical lives behind a menu.
 */

import { useCallback, useMemo, useState } from "react";
import { ClipboardCheck, History, Inbox, ListChecks, MapPinned, Send, UserRound, Wrench } from "lucide-react";
import { incidentsApi, sessionApi } from "../../lib/api.js";
import { useAsync, usePoll } from "../../lib/hooks.js";
import { useApp } from "../../app/AppContext.jsx";
import { ACTIVE_STATUSES, byOperationalPriority, statusLabel } from "../../domain/incidents.js";
import { formatRelative, pluralise } from "../../lib/format.js";
import { AppShell } from "../../components/layout/AppShell.jsx";
import { NotificationBell, NotificationsPanel, useNotifications } from "../notifications/Notifications.jsx";
import { ProfileTab } from "../citizen/ProfileTab.jsx";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  List,
  ListRow,
  ListSkeleton,
  PageHeader,
  SeverityBadge,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs
} from "../../components/ui/index.js";
import { AgentJobDetail } from "./AgentJobDetail.jsx";

/** One queue row. The whole row is the tap target. */
function JobRow({ entry, onOpen }) {
  const incident = entry.incident || {};
  return (
    <ListRow
      as="button"
      type="button"
      onClick={() => onOpen(incident.id)}
      title={incident.district || incident.title}
      meta={
        <>
          <span className="mono">{incident.reference}</span>
          <span>{pluralise(incident.reports_count || 0, "report")}</span>
          <span>{entry.assigned_at ? `Issued ${formatRelative(entry.assigned_at)}` : null}</span>
        </>
      }
      aside={
        <>
          <SeverityBadge severity={incident.severity} showMeter={false} />
          <StatusBadge status={incident.status} />
        </>
      }
    />
  );
}

export function AgentApp() {
  const { user } = useApp();
  const { unread } = useNotifications();
  const [tab, setTab] = useState("queue");
  const [openJobId, setOpenJobId] = useState(null);
  const [scope, setScope] = useState("active");

  const crewName = user?.company || user?.name;

  const queue = usePoll(async () => {
    const result = await sessionApi.workQueue();
    return result.work || [];
  }, 25_000);

  /** Closed work leaves the live queue, so history comes from the incident list. */
  const closed = useAsync(async () => {
    const result = await incidentsApi.list({});
    return (result.incidents || []).filter(
      (incident) => incident.assignee === crewName && !ACTIVE_STATUSES.includes(incident.status)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewName]);

  const work = queue.data || [];
  const active = work.filter((entry) => ACTIVE_STATUSES.includes(entry.incident?.status));
  const history = closed.data || [];

  const stats = useMemo(() => {
    const needsTravel = active.filter((entry) => entry.incident?.status === "assigned").length;
    const onSite = active.filter((entry) =>
      ["on_the_way", "under_intervention"].includes(entry.incident?.status)
    ).length;
    return { needsTravel, onSite };
  }, [active]);

  const openJob = work.find((entry) => String(entry.incident?.id) === String(openJobId)) || null;

  const leaveJob = useCallback(() => {
    setOpenJobId(null);
    queue.reload();
  }, [queue]);

  const navItems = [
    { key: "queue", label: "Assignments", shortLabel: "Work", icon: Wrench },
    { key: "history", label: "Work history", shortLabel: "History", icon: History },
    { key: "updates", label: "Updates", icon: Send, badge: unread },
    { key: "profile", label: "Profile", icon: UserRound }
  ];

  function renderContent() {
    if (openJob) {
      return (
        <AgentJobDetail
          incidentId={openJob.incident.id}
          onBack={leaveJob}
          onChanged={() => {
            queue.reload();
            closed.reload();
          }}
        />
      );
    }

    if (tab === "updates") {
      return (
        <div className="page">
          <NotificationsPanel
            onOpenIncident={(id) => setOpenJobId(id)}
            emptyMessage="New work orders and citizen updates will appear here."
          />
        </div>
      );
    }

    if (tab === "history") {
      return (
        <div className="page">
          <PageHeader title="Work history" subtitle="Jobs closed out under your crew." />
          <Card>
            <CardHeader title="Completed and closed" subtitle={`${history.length} total`} headingLevel={2} />
            {closed.loading ? (
              <CardBody>
                <ListSkeleton rows={3} />
              </CardBody>
            ) : closed.error ? (
              <ErrorState
                compact
                title="Could not load your history"
                error={closed.error}
                onRetry={closed.reload}
              />
            ) : history.length === 0 ? (
              <EmptyState
                compact
                icon={ClipboardCheck}
                title="Nothing closed yet"
                message="Jobs you complete and verify will be listed here."
              />
            ) : (
              <List>
                {history.map((incident) => (
                  <ListRow
                    key={incident.id}
                    title={incident.district}
                    meta={
                      <>
                        <span className="mono">{incident.reference}</span>
                        <span>{statusLabel(incident.status)}</span>
                        <span>{incident.closed_at ? formatRelative(incident.closed_at) : null}</span>
                      </>
                    }
                    aside={<SeverityBadge severity={incident.severity} showMeter={false} />}
                  />
                ))}
              </List>
            )}
          </Card>
        </div>
      );
    }

    if (tab === "profile") {
      return <ProfileTab unread={unread} onOpenNotifications={() => setTab("updates")} />;
    }

    return <QueueScreen queue={queue} active={active} work={work} scope={scope} setScope={setScope} stats={stats} historyCount={history.length} onOpen={setOpenJobId} name={user?.name} />;
  }

  return (
    <AppShell
      brand={{ title: "PowerWatch Field", subtitle: crewName || "Field agent" }}
      items={navItems}
      active={tab}
      onNavigate={(key) => {
        setOpenJobId(null);
        setTab(key);
      }}
      bottomKeys={["queue", "history", "updates", "profile"]}
      contentLabel="Field agent workspace"
      topbarActions={<NotificationBell onOpen={() => setTab("updates")} />}
    >
      {renderContent()}
    </AppShell>
  );
}

/** The landing screen: everything the crew needs before leaving. */
function QueueScreen({ queue, active, work, scope, setScope, stats, historyCount, onOpen, name }) {
  const rows = (scope === "active" ? active : work)
    .slice()
    .sort((a, b) => byOperationalPriority(a.incident || {}, b.incident || {}));

  return (
    <div className="page">
      <PageHeader
        title={name || "Field operations"}
        subtitle="Your assigned work orders."
        actions={
          <Button variant="outline" icon={ListChecks} onClick={queue.reload}>
            Refresh
          </Button>
        }
      />

      <StatGrid>
        <StatCard icon={Inbox} tone="warning" label="Ready to start travel" value={stats.needsTravel} />
        <StatCard icon={MapPinned} tone="info" label="On the way or on site" value={stats.onSite} />
        <StatCard icon={ClipboardCheck} tone="success" label="Closed by your crew" value={historyCount} />
      </StatGrid>

      <Alert tone="info" title="How work reaches you">
        Only incidents validated by SOCADEL and assigned to your crew appear here. Citizen clusters are never
        dispatched automatically.
      </Alert>

      <Card>
        <CardHeader
          title="Work orders"
          subtitle={`${active.length} open`}
          headingLevel={2}
          actions={
            <Tabs
              label="Work order scope"
              value={scope}
              onChange={setScope}
              tabs={[
                { value: "active", label: "Open", count: active.length || undefined },
                { value: "all", label: "All", count: work.length || undefined }
              ]}
            />
          }
        />
        {queue.loading && !work.length ? (
          <CardBody>
            <ListSkeleton rows={3} />
          </CardBody>
        ) : queue.error ? (
          <ErrorState
            compact
            title="Could not load your work queue"
            error={queue.error}
            onRetry={queue.reload}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={Wrench}
            title="No open work orders"
            message="When SOCADEL assigns an incident to your crew it will appear here immediately."
          />
        ) : (
          <List>
            {rows.map((entry) => (
              <JobRow key={entry.id} entry={entry} onOpen={onOpen} />
            ))}
          </List>
        )}
      </Card>
    </div>
  );
}
