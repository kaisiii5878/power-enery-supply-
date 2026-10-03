/**
 * My reports.
 *
 * Signed-in citizens see the reports the API attributes to their account. Guests
 * cannot be listed — the server holds no identity for them — so they get a
 * reference lookup against the public feed instead, which is the honest option.
 */

import { useState } from "react";
import { ClipboardList, FileSearch, LogIn } from "lucide-react";
import { incidentsApi } from "../../lib/api.js";
import { useAsync, useDebounced } from "../../lib/hooks.js";
import { useApp } from "../../app/AppContext.jsx";
import { formatDateTime, pluralise } from "../../lib/format.js";
import { ACTIVE_STATUSES } from "../../domain/incidents.js";
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
  SearchInput,
  SeverityBadge,
  StatusBadge,
  Tabs
} from "../../components/ui/index.js";

/** Reference lookup for guests, working against the public incident feed. */
function TrackByReference({ onOpenIncident }) {
  const { incidents } = useApp();
  const [term, setTerm] = useState("");
  const debounced = useDebounced(term, 250);

  const needle = debounced.trim().toLowerCase();
  const matches = needle
    ? incidents.filter((incident) =>
        `${incident.reference} ${incident.district}`.toLowerCase().includes(needle)
      )
    : [];

  return (
    <div className="stack">
      <SearchInput
        value={term}
        onChange={setTerm}
        placeholder="e.g. INC-2026-0047"
        label="Find an incident by reference or district"
      />

      {needle && matches.length === 0 ? (
        <Alert tone="info" title="Nothing found">
          Check the reference from your confirmation screen, or search by district name.
        </Alert>
      ) : null}

      {matches.length ? (
        <List>
          {matches.slice(0, 8).map((incident) => (
            <ListRow
              key={incident.id}
              as="button"
              type="button"
              onClick={() => onOpenIncident(incident.id)}
              title={incident.district || incident.title}
              meta={
                <>
                  <span className="mono">{incident.reference}</span>
                  <span>{pluralise(incident.reports_count || 0, "report")}</span>
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
      ) : null}
    </div>
  );
}

export function ReportsTab({ onOpenIncident, onReport, onSignIn }) {
  const { user } = useApp();
  const [scope, setScope] = useState("open");

  const mine = useAsync(
    async () => {
      if (!user) return { reports: [], total: 0 };
      return incidentsApi.mine();
    },
    [user?.id]
  );

  const reports = mine.data?.reports || [];
  const open = reports.filter((report) => ACTIVE_STATUSES.includes(report.status));
  const visible = scope === "open" ? open : reports;

  return (
    <div className="page">
      <PageHeader
        title="Reports"
        subtitle={user ? "Your outage reports and their progress." : "Find an incident by its reference."}
        actions={
          <Button variant="primary" icon={ClipboardList} onClick={onReport}>
            New report
          </Button>
        }
      />

      {!user ? (
        <>
          <Alert tone="info" title="Sign in to keep your reports together">
            Reports sent without an account are still received and acted on, but they cannot be listed here
            afterwards. Sign in to follow every report you send.
          </Alert>
          <Card>
            <CardHeader
              title="Track by reference"
              subtitle="Use the reference from your confirmation screen"
              headingLevel={2}
            />
            <CardBody>
              <TrackByReference onOpenIncident={onOpenIncident} />
            </CardBody>
            <div className="card__footer">
              <Button variant="outline" icon={LogIn} onClick={onSignIn}>
                Sign in or create an account
              </Button>
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader
            title="Your reports"
            subtitle={`${reports.length} total`}
            headingLevel={2}
            actions={
              <Tabs
                label="Report scope"
                value={scope}
                onChange={setScope}
                tabs={[
                  { value: "open", label: "Open", count: open.length || undefined },
                  { value: "all", label: "All", count: reports.length || undefined }
                ]}
              />
            }
          />

          {mine.loading ? (
            <CardBody>
              <ListSkeleton rows={4} />
            </CardBody>
          ) : mine.error ? (
            <ErrorState
              compact
              title="We could not load your reports"
              error={mine.error}
              onRetry={mine.reload}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              compact
              icon={FileSearch}
              title={scope === "open" ? "No open reports" : "No reports yet"}
              message={
                scope === "open"
                  ? "None of your reports are waiting on an outcome right now."
                  : "Your outage reports will appear here as soon as you send one."
              }
              actions={
                <Button variant="outline" onClick={onReport}>
                  Report an outage
                </Button>
              }
            />
          ) : (
            <List>
              {visible.map((report) => (
                <ListRow
                  key={report.id}
                  as={report.incident_id ? "button" : "div"}
                  type={report.incident_id ? "button" : undefined}
                  onClick={report.incident_id ? () => onOpenIncident(report.incident_id) : undefined}
                  title={report.district}
                  meta={
                    <>
                      <span>{report.category}</span>
                      <span>{formatDateTime(report.created_at)}</span>
                      {report.description ? <span className="clamp-2">{report.description}</span> : null}
                    </>
                  }
                  aside={
                    <>
                      <SeverityBadge severity={report.severity} showMeter={false} />
                      <StatusBadge status={report.status} />
                    </>
                  }
                />
              ))}
            </List>
          )}
        </Card>
      )}
    </div>
  );
}
