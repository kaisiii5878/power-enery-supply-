/**
 * Analytics.
 *
 * Decision-support only: report throughput, the workflow distribution, which
 * districts generate the most work, and how crews are performing. The window is
 * selectable and every series comes straight from the analytics endpoint.
 */

import { useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { adminApi } from "../../lib/api.js";
import { usePoll } from "../../lib/hooks.js";
import { formatDayShort, formatHours, formatNumber, formatRelative } from "../../lib/format.js";
import { SEVERITY_COLOR, SEVERITY_ORDER, severityLabel, statusLabel } from "../../domain/incidents.js";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageHeader,
  Select,
  StatCard,
  StatGrid,
  StatSkeleton
} from "../../components/ui/index.js";
import { BarChart, BreakdownList } from "./Charts.jsx";

const WINDOWS = [7, 14, 30, 60, 90];

const DISTRICT_COLUMNS = [
  { key: "district", header: "District", render: (row) => row.district },
  { key: "reports", header: "Reports", numeric: true, render: (row) => formatNumber(row.reports) },
  { key: "incidents", header: "Incidents", numeric: true, render: (row) => formatNumber(row.incidents) },
  {
    key: "worst_severity",
    header: "Worst severity",
    render: (row) => (
      <span className="inline-row">
        <span
          className="legend__swatch"
          style={{ background: SEVERITY_COLOR[row.worst_severity] }}
          aria-hidden="true"
        />
        {severityLabel(row.worst_severity)}
      </span>
    )
  }
];

const CREW_COLUMNS = [
  { key: "contractor", header: "Crew", render: (row) => row.contractor },
  { key: "jobs", header: "Jobs", numeric: true, render: (row) => formatNumber(row.jobs) },
  {
    key: "in_progress",
    header: "In progress",
    numeric: true,
    render: (row) => formatNumber(row.in_progress)
  },
  {
    key: "avg_travel_hours",
    header: "Avg travel",
    numeric: true,
    render: (row) => formatHours(row.avg_travel_hours)
  },
  {
    key: "avg_repair_hours",
    header: "Avg repair",
    numeric: true,
    render: (row) => formatHours(row.avg_repair_hours)
  }
];

export function AnalyticsPanel() {
  const [days, setDays] = useState(14);
  const analytics = usePoll(() => adminApi.analytics(days), 60_000, [days]);

  const data = analytics.data;
  const kpis = data?.kpis;

  return (
    <div className="page">
      <PageHeader
        title="Analytics"
        subtitle={
          data
            ? `Window of ${data.window_days} days, generated ${formatRelative(data.generated_at)}`
            : "Trends and crew performance"
        }
        actions={
          <>
            <Select label="Window" value={days} onChange={(event) => setDays(Number(event.target.value))}>
              {WINDOWS.map((value) => (
                <option key={value} value={value}>
                  Last {value} days
                </option>
              ))}
            </Select>
            <Button variant="outline" icon={RefreshCw} onClick={analytics.reload} busy={analytics.loading}>
              Refresh
            </Button>
          </>
        }
      />

      {analytics.error ? (
        <ErrorState
          title="We could not load the analytics"
          error={analytics.error}
          onRetry={analytics.reload}
        />
      ) : null}

      {analytics.loading && !kpis ? (
        <StatSkeleton count={6} />
      ) : (
        <StatGrid>
          <StatCard
            icon={BarChart3}
            label="Reports in window"
            value={formatNumber(kpis?.reports_in_window ?? 0)}
            hint={`All time ${formatNumber(kpis?.reports_total ?? 0)}`}
          />
          <StatCard
            label="Incidents in window"
            value={formatNumber(kpis?.incidents_in_window ?? 0)}
            hint={`${formatNumber(kpis?.active_incidents ?? 0)} still active`}
          />
          <StatCard
            label="Average validation"
            value={formatHours(kpis?.avg_validation_hours)}
            hint="First report to validation"
          />
          <StatCard
            label="Average restoration"
            value={formatHours(kpis?.avg_restoration_hours)}
            hint="Validation to power restored"
          />
          <StatCard label="Closed" value={formatNumber(kpis?.closed_total ?? 0)} hint="Verified with citizens" />
          <StatCard
            label="Rejected"
            value={formatNumber(kpis?.rejected_total ?? 0)}
            hint="Reviewed, no dispatch needed"
          />
        </StatGrid>
      )}

      <Card>
        <CardHeader
          title="Throughput"
          subtitle="Reports and incidents opened per day, including quiet days"
          headingLevel={2}
        />
        <CardBody className="stack">
          {analytics.loading && !data ? (
            <ListSkeleton rows={4} />
          ) : (
            <>
              <BarChart data={data?.trend} valueKey="reports" formatLabel={formatDayShort} unit="reports" />
              <BarChart
                data={data?.trend}
                valueKey="incidents"
                formatLabel={formatDayShort}
                unit="incidents"
              />
            </>
          )}
        </CardBody>
      </Card>

      <div className="grid-2">
        <Card>
          <CardHeader title="Severity mix" subtitle="Incidents by assessed severity" headingLevel={2} />
          <CardBody>
            <BreakdownList
              items={SEVERITY_ORDER.map((severity) => ({
                label: severityLabel(severity),
                value:
                  (data?.severity_distribution || []).find((row) => row.severity === severity)?.incidents || 0,
                color: SEVERITY_COLOR[severity]
              }))}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Workflow mix" subtitle="Incidents by current status" headingLevel={2} />
          <CardBody>
            <BreakdownList
              items={(data?.status_distribution || []).map((row) => ({
                label: statusLabel(row.status),
                value: row.total
              }))}
            />
          </CardBody>
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader title="Districts" subtitle="Top 10 by report volume" headingLevel={2} />
          <DataTable
            columns={DISTRICT_COLUMNS}
            rows={data?.districts || []}
            emptyState={
              <EmptyState
                compact
                title="No district data yet"
                message="Volume appears once citizen reports start arriving."
              />
            }
          />
        </Card>

        <Card>
          <CardHeader
            title="Crew performance"
            subtitle="Work orders handled and how long they took"
            headingLevel={2}
          />
          <DataTable
            columns={CREW_COLUMNS}
            rows={data?.contractors || []}
            emptyState={
              <EmptyState
                compact
                title="No work orders yet"
                message="Assign an incident to a crew to see performance figures."
              />
            }
          />
        </Card>
      </div>

      {kpis?.accounts ? (
        <Card>
          <CardHeader title="Accounts" subtitle="Who is using PowerWatch" headingLevel={2} />
          <CardBody>
            <BreakdownList
              items={[
                { label: "Citizens", value: kpis.accounts.client, color: "var(--brand-600)" },
                { label: "Field agents", value: kpis.accounts.subcontractor, color: "var(--brand-800)" },
                { label: "Administrators", value: kpis.accounts.socadel, color: "var(--brand-900)" }
              ]}
            />
            <p className="text-caption">{formatNumber(kpis.accounts.total)} accounts in total.</p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
