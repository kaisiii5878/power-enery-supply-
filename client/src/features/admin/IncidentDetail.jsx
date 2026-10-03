/**
 * Incident detail for the operations console.
 *
 * The same component serves the monitoring drawer and the incidents list, so an
 * operator sees one consistent case view. Actions are generated from the
 * server's `next_statuses`, and the audit trail is shown inline because that is
 * the evidence for every decision made here.
 */

import { useState } from "react";
import { Clock, History, RotateCcw, Truck, Wrench } from "lucide-react";
import { incidentsApi } from "../../lib/api.js";
import { useAsync } from "../../lib/hooks.js";
import { formatDateTime, formatDistance, humanise, pluralise } from "../../lib/format.js";
import { TRANSITION_ACTIONS, buildTimeline } from "../../domain/incidents.js";
import { MapCanvas, MapAttribution } from "../../components/map/MapView.jsx";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  KeyValueList,
  ListSkeleton,
  SeverityBadge,
  StatusBadge,
  Timeline,
  ConfirmDialog,
  useToast
} from "../../components/ui/index.js";
import { AssignDialog, CloseDialog, ReasonDialog, ValidateDialog } from "./workflowDialogs.jsx";
import { MessageThread } from "../incidents/MessageThread.jsx";

/** Operator action bar, driven entirely by the incident's legal transitions. */
function WorkflowActions({ incident, nextStatuses, restoredConfirmations, onDone }) {
  const toast = useToast();
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const allowed = nextStatuses || [];

  async function simple(status) {
    setBusy(true);
    try {
      await incidentsApi.fieldStatus(incident.id, { status });
      toast.success("Field status updated", `${incident.reference} is now “${status.replace(/_/g, " ")}”.`);
      setDialog(null);
      onDone();
    } catch (error) {
      toast.error("Could not update the field status", error.message);
    } finally {
      setBusy(false);
    }
  }

  const actions = allowed
    .map((status) => ({ status, meta: TRANSITION_ACTIONS[status] }))
    .filter((entry) => entry.meta);

  if (!actions.length) {
    return (
      <Alert tone="info" title="No further action available">
        {incident.status === "closed" || incident.status === "rejected"
          ? "This incident is closed and cannot be changed."
          : "This incident is waiting on the field crew."}
      </Alert>
    );
  }

  return (
    <>
      <div className="inline-row">
        {actions.map(({ status, meta }) => (
          <Button
            key={status}
            variant={meta.variant}
            icon={
              meta.intent === "validate"
                ? undefined
                : meta.intent === "on_the_way"
                  ? Truck
                  : meta.intent === "under_intervention"
                    ? Wrench
                    : undefined
            }
            onClick={() => setDialog(meta.intent)}
            busy={busy && dialog === meta.intent}
          >
            {meta.label}
          </Button>
        ))}
      </div>

      <ValidateDialog
        open={dialog === "validate"}
        incident={incident}
        onClose={() => setDialog(null)}
        onDone={onDone}
      />

      <AssignDialog
        open={dialog === "assign"}
        incident={incident}
        onClose={() => setDialog(null)}
        onDone={onDone}
      />

      <ReasonDialog
        open={dialog === "reject"}
        incident={incident}
        title="Reject this cluster"
        description="No crew will be dispatched. Citizens who reported it will be told why."
        label="Reason for rejecting"
        hint="Shown to citizens on the public incident page."
        cta="Reject cluster"
        action={(reason) => incidentsApi.reject(incident.id, reason)}
        onClose={() => setDialog(null)}
        onDone={onDone}
      />

      <CloseDialog
        open={dialog === "close"}
        incident={incident}
        restoredConfirmations={restoredConfirmations}
        onClose={() => setDialog(null)}
        onDone={onDone}
      />

      <ConfirmDialog
        open={dialog === "on_the_way" || dialog === "under_intervention" || dialog === "completed"}
        onCancel={() => setDialog(null)}
        onConfirm={() => simple(dialog)}
        title="Operator update"
        message={`You are about to set ${incident.reference} to “${dialog?.replace(/_/g, " ")}”. The field crew normally does this; it will be recorded against your account.`}
        confirmLabel="Update status"
        tone="primary"
        busy={busy}
      />
    </>
  );
}

/* ---- detail view ------------------------------------------------------- */

const REPORT_COLUMNS = [
  {
    key: "category",
    header: "Category",
    render: (row) => <span className="text-label">{row.category}</span>
  },
  {
    key: "reporter",
    header: "Reporter",
    render: (row) => (
      <span className="stack stack--sm">
        <span>{row.reporter_name || "Anonymous"}</span>
        {row.phone ? (
          <a className="text-caption" href={`tel:${row.phone}`}>
            {row.phone}
          </a>
        ) : null}
      </span>
    )
  },
  { key: "district", header: "District", render: (row) => row.district },
  {
    key: "description",
    header: "Description",
    render: (row) => <span className="clamp-2">{row.description || "—"}</span>
  },
  {
    key: "created_at",
    header: "Received",
    label: "Received",
    render: (row) => formatDateTime(row.created_at)
  }
];

const AUDIT_COLUMNS = [
  { key: "created_at", header: "When", render: (row) => formatDateTime(row.created_at) },
  { key: "actor", header: "Actor", render: (row) => row.actor },
  { key: "action", header: "Action", render: (row) => humanise(row.action.replace(/\./g, " ")) }
];

export function AdminIncidentDetail({ incidentId, onBack }) {
  const detail = useAsync(() => incidentsApi.detail(incidentId), [incidentId]);
  const data = detail.data;
  const incident = data?.incident;

  if (detail.loading) {
    return (
      <div className="stack">
        <ListSkeleton rows={6} />
      </div>
    );
  }

  if (detail.error || !incident) {
    return (
      <ErrorState
        title="We could not open this incident"
        error={detail.error}
        message={detail.error ? undefined : "This incident no longer exists."}
        onRetry={detail.reload}
      />
    );
  }

  const confirmations = data.confirmations || { also_affected: 0, restored: 0 };

  return (
    <div className="stack stack--lg">
      <div className="page-header">
        <div className="page-header__text">
          <h2 className="page-title">{incident.district || incident.title}</h2>
          <div className="inline-row">
            <span className="mono">{incident.reference}</span>
            <StatusBadge status={incident.status} />
            <SeverityBadge severity={incident.severity} />
            <span className="text-caption">
              <Clock size={13} aria-hidden="true" /> {pluralise(incident.reports_count || 0, "report")}
            </span>
          </div>
        </div>
        {onBack ? (
          <div className="page-header__actions">
            <Button variant="outline" onClick={onBack}>
              Close
            </Button>
          </div>
        ) : null}
      </div>

      {incident.status === "pending" ? (
        <Alert tone="warning" title="Still collecting reports">
          This cluster is below the qualifying threshold. It is promoted for validation automatically once
          enough neighbours report the same area.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Actions"
          subtitle="Only the transitions the workflow allows right now are offered"
          headingLevel={2}
        />
        <CardBody>
          <WorkflowActions
            incident={incident}
            nextStatuses={data.next_statuses}
            restoredConfirmations={confirmations.restored}
            onDone={detail.reload}
          />
        </CardBody>
      </Card>

      <div className="grid-2">
        <div className="stack">
          <Card>
            <CardHeader
              title="Location"
              subtitle="Incident area, rounded to the published precision"
              headingLevel={2}
            />
            <CardBody className="stack stack--sm">
              <MapCanvas
                incidents={[incident]}
                variant="panel"
                focusId={incident.id}
                showLegend={false}
                label={`Map of ${incident.district}`}
              />
              <MapAttribution />
              <KeyValueList
                items={[
                  { label: "District", value: incident.district },
                  {
                    label: "Coordinates",
                    value: `${Number(incident.latitude).toFixed(3)}, ${Number(incident.longitude).toFixed(3)}`
                  },
                  { label: "Radius", value: formatDistance(incident.radius_m || 500) },
                  { label: "Zone", value: incident.zone_id ? `Zone #${incident.zone_id}` : "Not in a zone" }
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Timeline" headingLevel={2} />
            <CardBody>
              <Timeline steps={buildTimeline(incident)} formatAt={formatDateTime} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Citizen reports"
              subtitle={`${data.reports_total || 0} attached`}
              headingLevel={2}
            />
            <DataTable
              columns={REPORT_COLUMNS}
              rows={data.reports || []}
              caption="Reporter names and phone numbers are visible to signed-in staff only."
              emptyState={
                <EmptyState
                  compact
                  title="No reports attached"
                  message="Reports grouped into this incident will be listed here."
                />
              }
            />
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="Case data" headingLevel={2} />
            <CardBody>
              <KeyValueList
                items={[
                  { label: "Crew", value: incident.assignee },
                  { label: "Root cause", value: incident.root_cause },
                  { label: "Resolution", value: incident.resolution },
                  { label: "Agency report", value: incident.agency_report },
                  { label: "Rejection reason", value: incident.rejection_reason },
                  { label: "Validated by", value: incident.validated_by },
                  { label: "First report", value: formatDateTime(incident.first_report_at) },
                  {
                    label: "Validated",
                    value: incident.validated_at ? formatDateTime(incident.validated_at) : null
                  },
                  {
                    label: "Work finished",
                    value: incident.completed_at ? formatDateTime(incident.completed_at) : null
                  },
                  { label: "Restored", value: incident.restored_at ? formatDateTime(incident.restored_at) : null },
                  { label: "Closed", value: incident.closed_at ? formatDateTime(incident.closed_at) : null },
                  {
                    label: "Citizen confirmations",
                    value: `Also affected ${confirmations.also_affected || 0} · Restored ${confirmations.restored || 0}`
                  }
                ]}
              />
            </CardBody>
          </Card>

          {data.work_request ? (
            <Card>
              <CardHeader title="Work order" headingLevel={2} />
              <CardBody>
                <KeyValueList
                  items={[
                    { label: "Crew", value: data.work_request.contractor },
                    { label: "Work status", value: data.work_request.status },
                    { label: "Issued by", value: data.work_request.assigned_by },
                    { label: "Diagnosis", value: data.work_request.diagnosis },
                    { label: "Equipment", value: data.work_request.equipment },
                    { label: "Replaced", value: data.work_request.replaced_components }
                  ]}
                />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Audit trail"
              subtitle="Every workflow decision recorded for this incident"
              headingLevel={2}
            />
            <CardBody>
              {(data.audit || []).length === 0 ? (
                <p className="text-secondary">Nothing recorded for this incident yet.</p>
              ) : (
                <DataTable columns={AUDIT_COLUMNS} rows={data.audit || []} />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Messages"
              subtitle="Visible to the operator, the crew and the citizen"
              headingLevel={2}
            />
            <CardBody>
              <MessageThread incidentId={incident.id} messages={data.messages || []} onPosted={detail.reload} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

export { WorkflowActions };
