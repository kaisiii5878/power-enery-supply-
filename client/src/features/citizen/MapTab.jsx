/**
 * Citizen map.
 *
 * Filter by severity and status, then tap an incident in the list or on the map.
 * Selecting an incident flies the camera to it and highlights it, so the list and
 * the map always describe the same thing.
 */

import { useMemo, useState } from "react";
import { MapPinned, Palette } from "lucide-react";
import { useApp } from "../../app/AppContext.jsx";
import { ACTIVE_STATUSES, SEVERITY_ORDER, severityLabel, statusLabel } from "../../domain/incidents.js";
import { formatRelative, pluralise } from "../../lib/format.js";
import { MapCanvas, MapAttribution } from "../../components/map/MapView.jsx";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
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

/** Statuses worth offering as a filter; "active" already covers the live ones. */
const STATUS_FILTERS = [
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

export function MapTab({ onOpenIncident, focusIncidentId, onFocusHandled }) {
  const { incidents, feedLoading, feedError, reloadFeed } = useApp();
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("active");
  const [term, setTerm] = useState("");
  const [selectedId, setSelectedId] = useState(focusIncidentId || null);

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return incidents.filter((incident) => {
      if (severity !== "all" && incident.severity !== severity) return false;
      if (status === "active" && !ACTIVE_STATUSES.includes(incident.status)) return false;
      if (status !== "active" && status !== "all" && incident.status !== status) return false;
      if (
        needle &&
        !`${incident.reference} ${incident.district} ${incident.title || ""}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [incidents, severity, status, term]);

  const selected = visible.find((incident) => String(incident.id) === String(selectedId)) || null;
  const filtersActive = severity !== "all" || status !== "active" || Boolean(term);

  function select(id) {
    setSelectedId(id);
    onFocusHandled?.();
  }

  return (
    <div className="page">
      <PageHeader
        title="Outage map"
        subtitle="Published incident areas, rated by severity. Positions are approximate by design."
      />

      <FilterBar
        summary={`${visible.length} of ${incidents.length} incidents shown`}
        actions={
          filtersActive ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSeverity("all");
                setStatus("active");
                setTerm("");
              }}
            >
              Reset filters
            </Button>
          ) : null
        }
      >
        <SearchInput
          value={term}
          onChange={setTerm}
          placeholder="Reference, district or title"
          label="Search incidents"
        />
        <Select label="Severity" value={severity} onChange={(event) => setSeverity(event.target.value)}>
          <option value="all">All severities</option>
          {SEVERITY_ORDER.map((value) => (
            <option key={value} value={value}>
              {severityLabel(value)}
            </option>
          ))}
        </Select>
        <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="active">Active only</option>
          <option value="all">Every status</option>
          {STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
        </Select>
      </FilterBar>

      {feedError ? (
        <ErrorState title="We could not load the map feed" error={feedError} onRetry={reloadFeed} />
      ) : null}

      <div className="monitor">
        <Card className="monitor__list">
          <CardHeader
            title="Incidents"
            subtitle={selected ? `${selected.reference} selected` : "Tap one to focus the map"}
            headingLevel={2}
          />
          {feedLoading && !incidents.length ? (
            <CardBody>
              <StatSkeleton count={4} />
            </CardBody>
          ) : visible.length === 0 ? (
            <EmptyState
              compact
              icon={MapPinned}
              title="No incidents match these filters"
              message="Try widening the severity or status filter."
            />
          ) : (
            <List>
              {visible.map((incident) => (
                <ListRow
                  key={incident.id}
                  as="button"
                  type="button"
                  selected={String(selectedId) === String(incident.id)}
                  onClick={() => select(incident.id)}
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
            focusId={focusIncidentId || null}
            onSelectIncident={select}
            label="Outage map of Cameroon"
            overlay={
              selected ? (
                <Button size="sm" variant="secondary" onClick={() => onOpenIncident(selected.id)}>
                  Open {selected.reference}
                </Button>
              ) : null
            }
          />
          <MapAttribution />
          <p className="text-caption">
            <Palette size={12} aria-hidden="true" /> Colour shows severity (
            {SEVERITY_ORDER.map(severityLabel).join(", ")}); circle size shows the estimated area affected.
          </p>
        </div>
      </div>
    </div>
  );
}
