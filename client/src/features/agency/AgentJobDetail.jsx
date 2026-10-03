/**
 * A single field assignment.
 *
 * Organised as a work card, not a dashboard: where to go, how bad it is, one
 * button for the next allowed step, and the technical report fields the crew must
 * fill in before completing. The action always comes from `fieldStepFor`, which
 * mirrors the server's state machine, so an illegal move cannot be triggered.
 */

import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  MapPin,
  MessageSquare,
  Phone,
  Radio,
  RotateCcw,
  ShieldCheck,
  Truck,
  Wrench
} from "lucide-react";
import { incidentsApi } from "../../lib/api.js";
import { useAsync } from "../../lib/hooks.js";
import { formatApproximate, formatDateTime, formatDistance, pluralise } from "../../lib/format.js";
import { buildTimeline, fieldStepFor, statusLabel } from "../../domain/incidents.js";
import { useApp } from "../../app/AppContext.jsx";
import { MapCanvas, MapAttribution } from "../../components/map/MapView.jsx";
import { MessageThread } from "../incidents/MessageThread.jsx";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  KeyValueList,
  ListSkeleton,
  PageHeader,
  SeverityBadge,
  StatusBadge,
  Textarea,
  TextInput,
  Timeline,
  useToast
} from "../../components/ui/index.js";

/** Citizen reports attached to this incident. Contact details are staff-only. */
function CitizenReports({ reports }) {
  if (!reports.length) {
    return (
      <EmptyState
        compact
        icon={MessageSquare}
        title="No citizen reports attached"
        message="Reports that arrive later are grouped into this incident automatically."
      />
    );
  }

  return (
    <ul className="list">
      {reports.map((report) => (
        <li className="list__row" key={report.id}>
          <span className="list__main">
            <span className="list__title">{report.category}</span>
            <span className="list__meta">
              <span>{report.district}</span>
              <span>{formatDateTime(report.created_at)}</span>
            </span>
            {report.description ? <span className="text-secondary">{report.description}</span> : null}
          </span>
          <span className="list__aside">
            {report.phone ? (
              <a className="btn btn--outline btn--sm" href={`tel:${report.phone}`}>
                <Phone size={14} aria-hidden="true" /> {report.phone}
              </a>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---- technical report -------------------------------------------------- */

const EMPTY_TECHNICAL = { rootCause: "", diagnosis: "", equipment: "", replacedComponents: "", comments: "" };

/** The completion form. Completing without a cause and diagnosis is not allowed. */
function TechnicalReportForm({ busy, onSubmit }) {
  const [form, setForm] = useState(EMPTY_TECHNICAL);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  return (
    <div className="stack">
      <TextInput
        label="Root cause"
        hint="What actually caused the outage, as found on site."
        value={form.rootCause}
        onChange={(event) => set({ rootCause: event.target.value })}
        placeholder="e.g. Blown HV fuse on the Bonanjo distributor"
      />
      <Textarea
        label="Diagnosis and work performed"
        value={form.diagnosis}
        onChange={(event) => set({ diagnosis: event.target.value })}
        rows={3}
        placeholder="What you found, what you did, and the state you left it in."
      />
      <TextInput
        label="Equipment used"
        value={form.equipment}
        onChange={(event) => set({ equipment: event.target.value })}
        placeholder="e.g. Insulation tester, NH fuse kit"
      />
      <TextInput
        label="Components replaced"
        value={form.replacedComponents}
        onChange={(event) => set({ replacedComponents: event.target.value })}
        placeholder="e.g. 2 x NH 400A fuse links"
      />
      <Textarea
        label="Comments for SOCADEL"
        value={form.comments}
        onChange={(event) => set({ comments: event.target.value })}
        rows={2}
        placeholder="Anything the operator should know before closing the case."
      />
      <div>
        <Button
          variant="primary"
          icon={CheckCircle2}
          busy={busy}
          disabled={!form.rootCause.trim() || !form.diagnosis.trim()}
          onClick={() => onSubmit(form)}
        >
          Complete work and submit report
        </Button>
      </div>
      <p className="text-caption">
        Completing the work opens the citizen verification step: neighbours confirm that power is really back
        before SOCADEL closes the incident.
      </p>
    </div>
  );
}

export function AgentJobDetail({ incidentId, onBack, onChanged }) {
  const toast = useToast();
  const { user } = useApp();
  const detail = useAsync(() => incidentsApi.detail(incidentId), [incidentId]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const data = detail.data;
  const incident = data?.incident;
  const workOrder = data?.work_request;

  const step = incident ? fieldStepFor(incident.status) : null;
  const crewName = user?.company || user?.name;
  const isMine = !incident?.assignee || incident.assignee === crewName;

  async function advance() {
    if (!step) return;
    setBusy(true);
    try {
      await incidentsApi.fieldStatus(incident.id, { status: step.status });
      toast.success(
        step.status === "on_the_way" ? "Travel started" : "Marked as on site",
        "The operations desk has been updated."
      );
      setConfirming(false);
      await detail.reload();
      onChanged?.();
    } catch (error) {
      toast.error("Could not update the work order", error.message);
    } finally {
      setBusy(false);
    }
  }

  async function complete(technical) {
    setBusy(true);
    try {
      await incidentsApi.fieldStatus(incident.id, { status: "completed", ...technical });
      toast.success("Work completed", "Citizens nearby are now asked to confirm restoration.");
      await detail.reload();
      onChanged?.();
    } catch (error) {
      toast.error("Could not submit the technical report", error.message);
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    try {
      await incidentsApi.reopen(incident.id, reopenReason);
      toast.info("Incident reopened", "The site is back under intervention.");
      setReopening(false);
      setReopenReason("");
      await detail.reload();
      onChanged?.();
    } catch (error) {
      toast.error("Could not reopen the incident", error.message);
    } finally {
      setBusy(false);
    }
  }

  if (detail.loading) {
    return (
      <div className="page">
        <ListSkeleton rows={6} />
      </div>
    );
  }

  if (detail.error || !incident) {
    return (
      <div className="page stack">
        <ErrorState
          title="We could not open this assignment"
          error={detail.error}
          message={detail.error ? undefined : "This incident may no longer be assigned to you."}
          onRetry={detail.reload}
        />
        <div className="inline-row">
          <Button variant="outline" onClick={onBack}>
            Back to work orders
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        breadcrumb={<Breadcrumb onBack={onBack} label="Back to work orders" />}
        title={incident.district || incident.title}
        subtitle={
          <span className="inline-row">
            <span className="mono">{incident.reference}</span>
            <StatusBadge status={incident.status} />
            <SeverityBadge severity={incident.severity} />
          </span>
        }
        actions={<span className="text-caption">{statusLabel(incident.status)}</span>}
      />

      {!isMine ? (
        <Alert tone="warning" title="Assigned to another crew">
          This work order belongs to {incident.assignee}. You can read it but not change its status.
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Next step" subtitle={step?.hint} headingLevel={2} />
        <CardBody className="stack">
          {step ? (
            <div className="inline-row">
              <Button
                variant="primary"
                size="lg"
                icon={step.status === "on_the_way" ? Truck : Wrench}
                onClick={() => setConfirming(true)}
                disabled={!isMine}
              >
                {step.label}
              </Button>
            </div>
          ) : incident.status === "verification_pending" ? (
            <Alert tone="success" title="Waiting on citizens">
              The repair is recorded. Citizens are confirming restoration; SOCADEL closes the incident once
              they do. If the line is still down, reopen it below.
            </Alert>
          ) : incident.status === "closed" || incident.status === "rejected" ? (
            <Alert tone="info" title={`Incident ${statusLabel(incident.status).toLowerCase()}`}>
              No further field action is required for this incident.
            </Alert>
          ) : (
            <Alert tone="info" title="Waiting on the operations desk">
              This incident is not yet assigned to a crew, so there is nothing to action from the field.
            </Alert>
          )}

          {incident.status === "verification_pending" ? (
            <div>
              <Button
                variant="outline"
                icon={RotateCcw}
                onClick={() => setReopening(true)}
                disabled={!isMine}
              >
                Reopen — the line is still down
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid-2">
        <div className="stack">
          <Card>
            <CardHeader
              title="Where to go"
              subtitle="Coordinates are approximate. Navigate by district."
              headingLevel={2}
            />
            <CardBody className="stack stack--sm">
              <MapCanvas
                incidents={[incident]}
                variant="panel"
                focusId={incident.id}
                showLegend={false}
                label={`Approximate location of ${incident.district}`}
              />
              <MapAttribution />
              <KeyValueList
                items={[
                  {
                    label: "District",
                    value: (
                      <span className="inline-row">
                        <MapPin size={14} aria-hidden="true" /> {incident.district}
                      </span>
                    )
                  },
                  {
                    label: "Approximate centre",
                    value: formatApproximate(incident.latitude, incident.longitude)
                  },
                  { label: "Est. affected radius", value: formatDistance(incident.radius_m || 500) },
                  {
                    label: "Volume",
                    value: `${pluralise(incident.reports_count || 0, "citizen report")} · ${incident.severity}`
                  }
                ]}
              />
              <Alert tone="info" icon={ShieldCheck} title="Location privacy">
                PowerWatch publishes incident areas, not household positions. The district and the circle above
                are what the crew navigates by.
              </Alert>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Progress" headingLevel={2} />
            <CardBody>
              <Timeline steps={buildTimeline(incident)} formatAt={formatDateTime} />
            </CardBody>
          </Card>
        </div>

        <div className="stack">
          {workOrder ? (
            <Card>
              <CardHeader title="Work order" subtitle={`Issued by ${workOrder.assigned_by}`} headingLevel={2} />
              <CardBody>
                <KeyValueList
                  items={[
                    { label: "Crew", value: workOrder.contractor },
                    { label: "Work status", value: workOrder.status },
                    { label: "Issued", value: formatDateTime(workOrder.assigned_at) },
                    {
                      label: "Departed",
                      value: workOrder.departed_at ? formatDateTime(workOrder.departed_at) : null
                    },
                    {
                      label: "On site",
                      value: workOrder.arrival_time ? formatDateTime(workOrder.arrival_time) : null
                    },
                    {
                      label: "Completed",
                      value: workOrder.completion_time ? formatDateTime(workOrder.completion_time) : null
                    },
                    { label: "Root cause", value: workOrder.root_cause },
                    { label: "Diagnosis", value: workOrder.diagnosis },
                    { label: "Equipment", value: workOrder.equipment },
                    { label: "Components replaced", value: workOrder.replaced_components },
                    { label: "Comments", value: workOrder.technical_comments }
                  ]}
                />
              </CardBody>
            </Card>
          ) : null}

          {incident.status === "under_intervention" ? (
            <Card>
              <CardHeader title="Technical report" subtitle="Required to close out the work" headingLevel={2} />
              <CardBody>
                <TechnicalReportForm busy={busy} onSubmit={complete} />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Citizen reports"
              subtitle="Names and phone numbers are visible to staff only"
              headingLevel={2}
            />
            <CardBody>
              <CitizenReports reports={data.reports || []} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Messages" headingLevel={2} />
            <CardBody>
              <MessageThread
                incidentId={incident.id}
                messages={data.messages || []}
                onPosted={detail.reload}
                placeholder="e.g. Access road blocked, arriving via the second junction."
              />
            </CardBody>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={advance}
        title={step?.label || "Update work order"}
        message={step ? `${step.hint} This is recorded against incident ${incident.reference}.` : ""}
        confirmLabel={step?.label || "Confirm"}
        tone="primary"
        busy={busy}
      />

      <ConfirmDialog
        open={reopening}
        onCancel={() => setReopening(false)}
        onConfirm={reopen}
        title="Reopen this incident"
        message={`${incident.district} goes back to “under intervention”. Citizens who already confirmed restoration will see the change.`}
        confirmLabel="Reopen incident"
        busy={busy}
      >
        <Textarea
          label="Why is it being reopened?"
          hint="Recorded in the audit trail and shown to SOCADEL."
          value={reopenReason}
          onChange={(event) => setReopenReason(event.target.value)}
          rows={3}
          maxLength={300}
          placeholder="e.g. Neighbours report the line is still down."
        />
      </ConfirmDialog>
    </div>
  );
}

