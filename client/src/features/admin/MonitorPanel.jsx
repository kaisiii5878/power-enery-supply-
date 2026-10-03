/**
 * Live monitoring.
 *
 * Filters at the top, incident list on the left, map on the right. Selecting an
 * incident in either place drives the other, and the detail drawer opens on top so
 * an operator can inspect and act without losing their place in the list.
 */

import { useMemo, useState } from "react";
import { FilterX, MapPin, Radio } from "lucide-react";
import { useApp } from "../../app/AppContext.jsx";
import {
  ACTIVE_STATUSES,
  SEVERITY_ORDER,
  byOperationalPriority,
  severityLabel,
  statusLabel
} from "../../domain/incidents.js";
import { formatRelative, pluralise } from "../../lib/format.js";
import { MapCanvas, MapAttribution } from "../../components/map/MapView.jsx";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Drawer,
  EmptyState,
  ErrorState,
  FilterBar,
  List,
  ListRow,
  PageHeader,
  SearchInput,
  Select,
  SeverityBadge,
  StatSkeleton,
  StatusBadge
} from "../../components/ui/index.js";
import { AdminIncidentDetail } from "./IncidentDetail.jsx";

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

const EMPTY_FILTERS = { term: "", severity: "all", status: "active", zone: "all" };

export function MonitorPanel({ onNavigate }) {
  const { incidents, feedLoading, feedError, reloadFeed } = useApp();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState(null);
  const [drawerId, setDrawerId] = useState(null);

  const zones = useMemo(() => {
    const ids = new Set(incidents.map((incident) => incident.zone_id).filter(Boolean));
    return [...ids].sort((a, b) => a - b);
  }, [incidents]);

  const visible = useMemo(() => {
    const needle = filters.term.trim().toLowerCase();
    return incidents
      .filter((incident) => {
        if (filters.severity !== "all" && incident.severity !== filters.severity) return false;
        if (filters.status === "active" && !ACTIVE_STATUSES.includes(incident.status)) return false;
        if (filters.status !== "active" && filters.status !== "all" && incident.status !== filters.status) {
          return false;
        }
        if (filters.zone !== "all" && String(incident.zone_id || "") !== String(filters.zone)) return false;
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

  const selected = visible.find((incident) => String(incident.id) === String(selectedId)) || null;
  const dirty = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  function set(patch) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  return (
    <div className="page">
      <PageHeader
        title="Live monitoring"
        subtitle="Search, filter and focus the network in one place."
        actions={
          <>
            <Button variant="outline" onClick={reloadFeed} busy={feedLoading}>
              Sync now
            </Button>
            {onNavigate ? (
              <Button variant="ghost" onClick={() => onNavigate("overview")}>
                Overview
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar
        summary={`${visible.length} of ${incidents.length} incidents`}
        actions={
          dirty ? (
            <Button size="sm" variant="ghost" icon={FilterX} onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear filters
            </Button>
          ) : null
        }
      >
        <SearchInput
          value={filters.term}
          onChange={(term) => set({ term })}
          placeholder="Reference, district or title"
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
        <Select label="Zone" value={filters.zone} onChange={(event) => set({ zone: event.target.value })}>
          <option value="all">Every zone</option>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              Zone #{zone}
            </option>
          ))}
        </Select>
      </FilterBar>

      {feedError ? (
        <ErrorState title="We could not load the incident feed" error={feedError} onRetry={reloadFeed} />
      ) : null}

      <div className="monitor">
        <Card className="monitor__list">
          <CardHeader
            title="Incidents"
            subtitle={selected ? `${selected.reference} selected` : "Select one to focus the map"}
            headingLevel={2}
          />
          {feedLoading && !incidents.length ? (
            <CardBody>
              <StatSkeleton count={4} />
            </CardBody>
          ) : visible.length === 0 ? (
            <EmptyState
              compact
              icon={MapPin}
              title="Nothing matches these filters"
              message="Widen the severity, status or zone to see more incidents."
              actions={
                dirty ? (
                  <Button variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
          ) : (
            <List>
              {visible.map((incident) => (
                <ListRow
                  key={incident.id}
                  as="button"
                  type="button"
                  selected={String(selectedId) === String(incident.id)}
                  onClick={() => setSelectedId(incident.id)}
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
          <MapCanvas
            incidents={visible}
            selectedId={selectedId}
            onSelectIncident={setSelectedId}
            label="Live incident monitoring map"
            overlay={
              selected ? (
                <Button size="sm" variant="secondary" icon={Radio} onClick={() => setDrawerId(selected.id)}>
                  Open {selected.reference}
                </Button>
              ) : null
            }
          />
          <MapAttribution />
        </div>
      </div>

      <Drawer
        open={Boolean(drawerId)}
        onClose={() => setDrawerId(null)}
        title="Incident detail"
        description="Inspect and update without leaving the monitor"
        width="min(680px, 100%)"
      >
        {drawerId ? <AdminIncidentDetail incidentId={drawerId} onBack={() => setDrawerId(null)} /> : null}
      </Drawer>
    </div>
  );
}
