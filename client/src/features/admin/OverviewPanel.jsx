/**
 * Operations overview.
 *
 * Every figure here answers an operational question: how much is arriving, what
 * is waiting on the desk, what is in the field, and how long restoration takes.
 * The analytics endpoint supplies all of it, including a 14-day trend with the
 * zero days already filled in.
 */

import {
  Activity,
  CheckCircle2,
  ClipboardList,
  Clock,
  RadioTower,
  RefreshCw,
  ShieldQuestion,
  Timer,
  Wrench
} from "lucide-react";
import { adminApi } from "../../lib/api.js";
import { usePoll } from "../../lib/hooks.js";
import { formatDayShort, formatHours, formatNumber, formatRelative, pluralise } from "../../lib/format.js";
import { ACTIVE_STATUSES, SEVERITY_COLOR, byOperationalPriority, statusLabel } from "../../domain/incidents.js";
import { useApp } from "../../app/AppContext.jsx";
import { MapCanvas, MapAttribution } from "../../components/map/MapView.jsx";
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
  StatSkeleton,
  StatusBadge
} from "../../components/ui/index.js";
import { BarChart, BreakdownList } from "./Charts.jsx";

const STATUS_COLOURS = {
  pending: "var(--neutral-400)",
  pending_validation: "var(--warning)",
  validated: "var(--brand-600)",
  assigned: "var(--brand-700)",
  on_the_way: "var(--brand-800)",
  under_intervention: "var(--brand-900)",
  verification_pending: "var(--warning)",
  closed: "var(--success)",
  rejected: "var(--neutral-300)"
};

export function OverviewPanel({ onOpenIncident, onNavigate }) {
  const { incidents } = useApp();
  const analytics = usePoll(() => adminApi.analytics(14), 30_000);

  const data = analytics.data;
  const kpis = data?.kpis;

  const activeIncidents = incidents
    .filter((incident) => ACTIVE_STATUSES.includes(incident.status))
    .sort(byOperationalPriority);

  return (
    <div className="page">
      <PageHeader
        title="Operations overview"
        subtitle={
          data?.generated_at
            ? `Network state ${formatRelative(data.generated_at)}, window of ${data.window_days} days`
            : "Network state and workload"
        }
        actions={
          <Button variant="outline" icon={RefreshCw} onClick={analytics.reload} busy={analytics.loading}>
            Refresh
          </Button>
        }
      />

      {analytics.error ? (
        <ErrorState
          title="We could not load the operational figures"
          error={analytics.error}
          onRetry={analytics.reload}
        />
      ) : null}

      {analytics.loading && !data ? (
        <StatSkeleton count={6} />
      ) : kpis ? (
        <StatGrid>
          <StatCard
            icon={ClipboardList}
            label="Total citizen reports"
            value={formatNumber(kpis.reports_total)}
            hint="Every report received"
          />
          <StatCard
            icon={Activity}
            tone="warning"
            label="Active incidents"
            value={formatNumber(kpis.active_incidents)}
            hint="Not closed and not rejected"
            onClick={() => onNavigate("monitor")}
          />
          <StatCard
            icon={ShieldQuestion}
            tone="warning"
            label="Awaiting validation"
            value={formatNumber(kpis.awaiting_validation)}
            hint="Waiting on the operations desk"
            onClick={() => onNavigate("monitor")}
          />
          <StatCard
            icon={Wrench}
            tone="info"
            label="Under intervention"
            value={formatNumber(kpis.in_intervention)}
            hint="Assigned, en route or on site"
            onClick={() => onNavigate("monitor")}
          />
          <StatCard
            icon={CheckCircle2}
            tone="success"
            label="Restored and closed"
            value={formatNumber(kpis.closed_total)}
            hint="Verified with citizens"
          />
          <StatCard
            icon={Timer}
            label="Average restoration"
            value={formatHours(kpis.avg_restoration_hours)}
            hint="Validation to power restored"
          />
          <StatCard
            icon={Clock}
            label="Average validation"
            value={formatHours(kpis.avg_validation_hours)}
            hint="First report to validation"
          />
          <StatCard
            icon={RadioTower}
            label="Awaiting verification"
            value={formatNumber(kpis.awaiting_verification)}
            hint="Crew finished, citizens confirming"
          />
        </StatGrid>
      ) : null}

      <div className="grid-2">
        <Card>
          <CardHeader
            title="Report volume"
            subtitle={data ? `Citizen reports per day over ${data.window_days} days` : "Citizen reports per day"}
            headingLevel={2}
          />
          <CardBody>
            {analytics.loading && !data ? (
              <ListSkeleton rows={4} />
            ) : (
              <BarChart data={data?.trend} valueKey="reports" formatLabel={formatDayShort} unit="reports" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Where incidents stand"
            subtitle="Distribution across the workflow"
            headingLevel={2}
          />
          <CardBody>
            {analytics.loading && !data ? (
              <ListSkeleton rows={4} />
            ) : (
              <BreakdownList
                items={(data?.status_distribution || []).map((row) => ({
                  label: statusLabel(row.status),
                  value: row.total,
                  color: STATUS_COLOURS[row.status] || "var(--brand-600)"
                }))}
              />
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Live incident map"
          subtitle={`${activeIncidents.length} active incidents plotted by severity`}
          headingLevel={2}
        />
        <CardBody className="stack stack--sm">
          {incidents.length === 0 ? (
            <EmptyState
              compact
              title="No incidents on the map"
              message="Incidents appear as soon as citizen reports are clustered."
            />
          ) : (
            <>
              <MapCanvas
                incidents={activeIncidents}
                onSelectIncident={onOpenIncident}
                label="Active incidents across Cameroon"
              />
              <MapAttribution />
            </>
          )}
        </CardBody>
      </Card>

      <div className="grid-2">
        <Card>
          <CardHeader
            title="Needs attention"
            subtitle="Active incidents, worst first"
            headingLevel={2}
            actions={
              <Button size="sm" variant="ghost" onClick={() => onNavigate("monitor")}>
                Open monitor
              </Button>
            }
          />
          {activeIncidents.length === 0 ? (
            <EmptyState
              compact
              icon={CheckCircle2}
              title="Nothing outstanding"
              message="No active incidents are waiting on the operations desk."
            />
          ) : (
            <List>
              {activeIncidents.slice(0, 6).map((incident) => (
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
                      <span>{formatRelative(incident.last_report_at || incident.updated_at)}</span>
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

        <div className="stack">
          <Card>
            <CardHeader title="Busiest districts" subtitle="Top 10 by report volume" headingLevel={2} />
            <CardBody>
              {(data?.districts || []).length === 0 ? (
                <EmptyState compact title="No district data yet" message="Figures appear once reports arrive." />
              ) : (
                <ul className="list">
                  {data.districts.map((row) => (
                    <li className="list__row" key={row.district}>
                      <span className="list__main">
                        <span className="list__title">{row.district}</span>
                        <span className="list__meta">
                          <span>{pluralise(row.reports, "report")}</span>
                          <span>{pluralise(row.incidents, "incident")}</span>
                        </span>
                      </span>
                      <span className="list__aside">
                        <span
                          className="legend__swatch"
                          style={{ background: SEVERITY_COLOR[row.worst_severity] }}
                          aria-hidden="true"
                        />
                        <span className="text-caption">{row.worst_severity}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Field crew performance" subtitle="Work orders handled" headingLevel={2} />
            <CardBody>
              {(data?.contractors || []).length === 0 ? (
                <EmptyState
                  compact
                  icon={Wrench}
                  title="No work orders yet"
                  message="Crew figures appear once incidents are assigned."
                />
              ) : (
                <ul className="list">
                  {data.contractors.map((row) => (
                    <li className="list__row" key={row.contractor}>
                      <span className="list__main">
                        <span className="list__title">{row.contractor}</span>
                        <span className="list__meta">
                          <span>{pluralise(row.jobs, "job")}</span>
                          <span>{row.in_progress} in progress</span>
                        </span>
                      </span>
                      <span className="list__aside">
                        <span className="text-caption">{formatHours(row.avg_repair_hours)} repair</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {kpis?.accounts ? (
            <Alert tone="info" title="Accounts">
              {kpis.accounts.total} accounts in total: {kpis.accounts.client} citizens,{" "}
              {kpis.accounts.subcontractor} field agents, {kpis.accounts.socadel} administrators.
            </Alert>
          ) : null}
        </div>
      </div>
    </div>
  );
}
