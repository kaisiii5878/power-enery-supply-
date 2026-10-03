/**
 * Incidents — the table view.
 *
 * The monitor is map-first; this is scan-first. A scannable table with pagination
 * for working through the whole backlog, opening the full detail view when an
 * operator needs to act on one.
 */

import { useMemo, useState } from "react";
import { FilterX, Table2 } from "lucide-react";
import { useApp } from "../../app/AppContext.jsx";
import {
  ACTIVE_STATUSES,
  SEVERITY_ORDER,
  byOperationalPriority,
  severityLabel,
  statusLabel
} from "../../domain/incidents.js";
import { formatDateTime, formatRelative, pluralise } from "../../lib/format.js";
import {
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  ListSkeleton,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  SeverityBadge,
  StatusBadge
} from "../../components/ui/index.js";

const STATUS_OPTIONS = [
  "pending",
  "pending_validation",
  "validated",
  "assigned",
  "on_the_way",
  "under_intervention",
  "verification_pending",
  "closed",
  "rejected"
];

const EMPTY_FILTERS = { term: "", severity: "all", status: "active" };

export function IncidentsPanel({ onOpenIncident }) {
  const { incidents, feedLoading, feedError, reloadFeed } = useApp();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filtered = useMemo(() => {
    const needle = filters.term.trim().toLowerCase();
    return incidents
      .filter((incident) => {
        if (filters.severity !== "all" && incident.severity !== filters.severity) return false;
        if (filters.status === "active" && !ACTIVE_STATUSES.includes(incident.status)) return false;
        if (filters.status !== "active" && filters.status !== "all" && incident.status !== filters.status) {
          return false;
        }
        if (
          needle &&
          !`${incident.reference} ${incident.district} ${incident.title || ""}`.toLowerCase().includes(needle)
        ) {
          return false;
        }
        return true;
      })
      .sort(byOperationalPriority);
  }, [incidents, filters]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);
  const dirty = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  function set(patch) {
    setPage(1);
    setFilters((current) => ({ ...current, ...patch }));
  }

  function clearFilters() {
    setPage(1);
    setFilters({ ...EMPTY_FILTERS });
  }

  const columns = [
    {
      key: "reference",
      header: "Reference",
      render: (row) => (
        <span className="stack stack--sm">
          <span className="mono">{row.reference}</span>
          <span className="text-caption">{formatDateTime(row.created_at)}</span>
        </span>
      )
    },
    {
      key: "district",
      header: "Area",
      render: (row) => (
        <span className="stack stack--sm">
          <span>{row.district}</span>
          <span className="text-caption clamp-2">{row.title}</span>
        </span>
      )
    },
    { key: "reports_count", header: "Reports", numeric: true, render: (row) => row.reports_count || 0 },
    { key: "severity", header: "Severity", render: (row) => <SeverityBadge severity={row.severity} /> },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "assignee",
      header: "Crew",
      render: (row) => row.assignee || <span className="text-caption">Unassigned</span>
    },
    {
      key: "updated_at",
      header: "Updated",
      label: "Updated",
      render: (row) => formatRelative(row.updated_at || row.last_report_at)
    },
    {
      key: "actions",
      header: "",
      label: "Actions",
      actions: true,
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => onOpenIncident(row.id)}>
          Open
        </Button>
      )
    }
  ];

  return (
    <div className="page">
      <PageHeader
        title="Incidents"
        subtitle="Every clustered outage, newest activity first."
        actions={
          <Button variant="outline" onClick={reloadFeed} busy={feedLoading}>
            Sync now
          </Button>
        }
      />

      {feedError ? (
        <ErrorState title="We could not load the incidents" error={feedError} onRetry={reloadFeed} />
      ) : null}

      <FilterBar
        summary={`${filtered.length} of ${incidents.length} incidents`}
        actions={
          dirty ? (
            <Button size="sm" variant="ghost" icon={FilterX} onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null
        }
      >
        <SearchInput
          value={filters.term}
          onChange={(term) => set({ term })}
          placeholder="Reference, area or title"
          label="Search incidents"
        />
        <Select
          label="Severity"
          value={filters.severity}
          onChange={(event) => set({ severity: event.target.value })}
        >
          <option value="all">All severities</option>
          {SEVERITY_ORDER.map((value) => (
            <option key={value} value={value}>
              {severityLabel(value)}
            </option>
          ))}
        </Select>
        <Select label="Status" value={filters.status} onChange={(event) => set({ status: event.target.value })}>
          <option value="active">Active only</option>
          <option value="all">Every status</option>
          {STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
        </Select>
      </FilterBar>

      <Card>
        <CardHeader title="All incidents" subtitle={pluralise(filtered.length, "incident")} headingLevel={2} />
        {feedLoading && !incidents.length ? (
          <div className="card__body">
            <ListSkeleton rows={6} />
          </div>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              onRowClick={(row) => onOpenIncident(row.id)}
              emptyState={
                <EmptyState
                  compact
                  icon={Table2}
                  title="No incidents match these filters"
                  message="Clear the filters to see the full backlog."
                />
              }
            />
            {filtered.length > pageSize ? (
              <Pagination
                page={currentPage}
                pageSize={pageSize}
                total={filtered.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
