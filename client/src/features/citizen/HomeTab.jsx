/**
 * Citizen home.
 *
 * Deliberately short: one primary action, what is happening near the user, the
 * latest update on a live incident, and service announcements. No statistics a
 * resident cannot act on.
 */

import { AlertTriangle, ArrowRight, Bell, MapPinned, Megaphone, Send } from "lucide-react";
import { useApp } from "../../app/AppContext.jsx";
import { ACTIVE_STATUSES, byOperationalPriority, statusLabel } from "../../domain/incidents.js";
import { formatRelative, pluralise } from "../../lib/format.js";
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
  SeverityBadge,
  StatSkeleton,
  StatusBadge
} from "../../components/ui/index.js";

/** Greeting that respects the time of day, using the account name when present. */
function greeting(name) {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name.split(" ")[0]}` : part;
}

export function HomeTab({ onReport, onOpenMap, onOpenIncidents, onOpenIncident, onOpenNotifications, unread }) {
  const { user, incidents, announcements, feedLoading, feedError, reloadFeed } = useApp();

  const active = incidents
    .filter((incident) => ACTIVE_STATUSES.includes(incident.status))
    .sort(byOperationalPriority);
  const latest = active[0];
  const critical = active.filter((incident) => ["high", "critical"].includes(incident.severity)).length;

  return (
    <div className="page">
      <section className="stack stack--sm">
        <h1 className="page-title">{greeting(user?.name || user?.full_name)}</h1>
        <p className="text-secondary">
          {active.length
            ? `${pluralise(active.length, "outage")} being tracked across the network right now.`
            : "No outages are being tracked right now."}
        </p>
      </section>

      <Card>
        <CardBody className="stack">
          <div className="stack stack--sm">
            <h2 className="section-title">Something wrong with your power?</h2>
            <p className="text-secondary">
              Tell us where and what you see. Nearby reports are grouped automatically so crews know where
              to go first.
            </p>
          </div>
          <div className="inline-row">
            <Button variant="primary" size="lg" icon={Send} onClick={onReport}>
              Report an outage
            </Button>
            <Button variant="outline" size="lg" icon={MapPinned} onClick={onOpenMap}>
              See the map
            </Button>
          </div>
        </CardBody>
      </Card>

      {feedError ? (
        <ErrorState title="We could not load the outage feed" error={feedError} onRetry={reloadFeed} />
      ) : null}

      <Card>
        <CardHeader
          title="Active outages"
          subtitle={critical ? `${critical} rated high or critical` : "Across all monitored zones"}
          headingLevel={2}
          actions={
            <Button size="sm" variant="ghost" iconAfter={ArrowRight} onClick={onOpenIncidents}>
              View all
            </Button>
          }
        />
        {feedLoading && !incidents.length ? (
          <CardBody>
            <StatSkeleton count={3} />
          </CardBody>
        ) : active.length === 0 ? (
          <EmptyState
            compact
            icon={AlertTriangle}
            title="No active outages"
            message="There are no active outage incidents being tracked in the monitored zones."
            actions={
              <Button variant="outline" onClick={onOpenMap}>
                View map
              </Button>
            }
          />
        ) : (
          <List>
            {active.slice(0, 4).map((incident) => (
              <ListRow
                key={incident.id}
                as="button"
                type="button"
                onClick={() => onOpenIncident(incident.id)}
                title={incident.district}
                meta={
                  <>
                    <span className="mono">{incident.reference}</span>
                    <span>{pluralise(incident.reports_count || 0, "report")}</span>
                    <span>Updated {formatRelative(incident.last_report_at || incident.updated_at)}</span>
                  </>
                }
                aside={
                  <>
                    <SeverityBadge severity={incident.severity} showMeter={false} />
                    <StatusBadge status={incident.status} />
                  </>
                }
              />
            ))}
          </List>
        )}
      </Card>

      {latest ? (
        <Card>
          <CardHeader title="Latest update" headingLevel={2} />
          <CardBody className="stack stack--sm">
            <div className="split">
              <span className="list__title">{latest.district}</span>
              <StatusBadge status={latest.status} />
            </div>
            <p className="text-secondary">{latest.root_cause || "The cause is still being confirmed."}</p>
            <div className="inline-row">
              <Button size="sm" variant="outline" onClick={() => onOpenIncident(latest.id)}>
                Open this incident
              </Button>
              <span className="text-caption">{statusLabel(latest.status)}</span>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Announcements"
          subtitle="Published by SOCADEL"
          headingLevel={2}
          actions={
            unread ? (
              <Button size="sm" variant="ghost" icon={Bell} onClick={onOpenNotifications}>
                {unread} unread
              </Button>
            ) : null
          }
        />
        {announcements.length === 0 ? (
          <EmptyState
            compact
            icon={Megaphone}
            title="No announcements"
            message="Planned maintenance and restoration notices will be published here."
          />
        ) : (
          <List>
            {announcements.slice(0, 3).map((announcement) => (
              <ListRow
                key={announcement.id}
                title={announcement.title}
                meta={
                  <>
                    <span>{announcement.body}</span>
                    <span>{formatRelative(announcement.created_at)}</span>
                  </>
                }
              />
            ))}
          </List>
        )}
      </Card>

      {!user ? (
        <Alert tone="info" title="Get more from PowerWatch">
          Create a free account to keep your reports together, be notified when a crew is assigned, and
          confirm when your power is back. You can also keep reporting anonymously.
        </Alert>
      ) : null}
    </div>
  );
}

