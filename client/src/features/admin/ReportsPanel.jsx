/**
 * Citizen reports, grouped the way the API exposes them.
 *
 * The server scopes report rows to an incident (`/incidents/:id`) or to the
 * reporter (`/incidents/mine`); there is no "all reports" collection. So this
 * panel shows real volume per incident — from the analytics endpoint — and opens
 * the incident drawer for the individual rows. Nothing is invented.
 */

import { useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { adminApi } from "../../lib/api.js";
import { usePoll } from "../../lib/hooks.js";
import { formatDayShort, formatNumber, pluralise } from "../../lib/format.js";
import { SEVERITY_ORDER, severityLabel } from "../../domain/incidents.js";
import { useApp } from "../../app/AppContext.jsx";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  FilterBar,
  ListSkeleton,
  PageHeader,
  SearchInput,
  Select,
  SeverityBadge,
  StatCard,
  StatGrid,
  StatSkeleton,
  StatusBadge
} from "../../components/ui/index.js";
import { BarChart } from "./Charts.jsx";
import { AdminIncidentDetail } from "./IncidentDetail.jsx";

export function ReportsPanel() {
  const { incidents } = useApp();
  const analytics = usePoll(() => adminApi.analytics(14), 60_000);
  const [term, setTerm] = useState("");
  const [severity, setSeverity] = useState("all");
  const [openId, setOpenId] = useState(null);

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return incidents
      .filter((incident) => severity === "all" || incident.severity === severity)
      .filter(
        (incident) =>
          !needle ||
          `${incident.reference} ${incident.district} ${incident.title || ""}`.toLowerCase().includes(needle)
      )
      .sort((a, b) => Number(b.reports_count || 0) - Number(a.reports_count || 0));
  }, [incidents, term, severity]);

  const totalReports = incidents.reduce((sum, incident) => sum + Number(incident.reports_count || 0), 0);
  const kpis = analytics.data?.kpis;
  const windowDays = analytics.data?.window_days || 14;

  const columns = [
    { key: "reference", header: "Reference", render: (row) => <span className="mono">{row.reference}</span> },
    { key: "district", header: "Area", render: (row) => row.district },
    {
      key: "reports_count",
      header: "Reports",
      numeric: true,
      render: (row) => formatNumber(row.reports_count || 0)
    },
    { key: "severity", header: "Severity", render: (row) => <SeverityBadge severity={row.severity} /> },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "actions",
      header: "",
      label: "Actions",
      actions: true,
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => setOpenId(row.id)}>
          Open
        </Button>
      )
    }
  ];

  return (
    <div className="page">
      <PageHeader
        title="Reports"
        subtitle="How much is arriving, and where."
        actions={
          <Button variant="outline" onClick={analytics.reload} busy={analytics.loading}>
            Refresh figures
          </Button>
        }
      />

      {analytics.error ? (
        <ErrorState
          title="We could not load the report figures"
          error={analytics.error}
          onRetry={analytics.reload}
        />
      ) : null}

      {analytics.loading && !kpis ? (
        <StatSkeleton count={4} />
      ) : (
        <StatGrid>
          <StatCard
            icon={ClipboardList}
            label="Reports received"
            value={formatNumber(kpis?.reports_total ?? totalReports)}
            hint="All time"
          />
          <StatCard
            label="In the last window"
            value={formatNumber(kpis?.reports_in_window ?? 0)}
            hint={`Over ${windowDays} days`}
          />
          <StatCard
            label="Incidents opened"
            value={formatNumber(kpis?.incidents_in_window ?? 0)}
            hint="From those reports"
          />
          <StatCard
            label="Reports per incident"
            value={incidents.length ? (totalReports / incidents.length).toFixed(1) : "0"}
            hint="Average across all incidents"
          />
        </StatGrid>
      )}

      <Card>
        <CardHeader
          title="Daily volume"
          subtitle="Reports received per day, including quiet days"
          headingLevel={2}
        />
        <CardBody>
          {analytics.loading && !analytics.data ? (
            <ListSkeleton rows={4} />
          ) : (
            <BarChart
              data={analytics.data?.trend}
              valueKey="reports"
              formatLabel={formatDayShort}
              unit="reports"
            />
          )}
        </CardBody>
      </Card>

      <FilterBar summary={`${rows.length} of ${incidents.length} incidents`}>
        <SearchInput
          value={term}
          onChange={setTerm}
          placeholder="Reference, area or title"
          label="Search incidents by area"
        />
        <Select label="Severity" value={severity} onChange={(event) => setSeverity(event.target.value)}>
          <option value="all">All severities</option>
          {SEVERITY_ORDER.map((value) => (
            <option key={value} value={value}>
              {severityLabel(value)}
            </option>
          ))}
        </Select>
      </FilterBar>

      <Alert tone="info" title="Where individual reports live">
        Reporter names and phone numbers belong to an incident, not to a global list, so they are shown inside
        the incident detail. That keeps every read of personal data tied to the case it belongs to.
      </Alert>

      <Card>
        <CardHeader
          title="Reports by incident"
          subtitle={`${pluralise(totalReports, "report")} across ${pluralise(incidents.length, "incident")}`}
          headingLevel={2}
        />
        <DataTable
          columns={columns}
          rows={rows}
          onRowClick={(row) => setOpenId(row.id)}
          emptyState={
            <EmptyState
              compact
              icon={ClipboardList}
              title="No reports match these filters"
              message="Clear the search or pick a different severity."
            />
          }
        />
      </Card>

      <Drawer
        open={Boolean(openId)}
        onClose={() => setOpenId(null)}
        title="Incident reports"
        description="Every citizen report grouped into this incident"
        width="min(720px, 100%)"
      >
        {openId ? <AdminIncidentDetail incidentId={openId} onBack={() => setOpenId(null)} /> : null}
      </Drawer>
    </div>
  );
}
