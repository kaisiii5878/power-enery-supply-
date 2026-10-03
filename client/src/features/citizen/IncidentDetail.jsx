/**
 * Incident detail — the citizen-facing case view.
 *
 * Sections are ordered the way a resident needs them: what is happening, where,
 * how far along the response is, and what they can still do. Coordinates shown
 * here are the coarse ones the API publishes, never a reporter's exact position.
 */

import { useCallback, useState } from "react";
import {
  CheckCircle2,
  Clock,
  MapPin,
  Radio,
  ThumbsUp,
  Users
} from "lucide-react";
import { publicApi } from "../../lib/api.js";
import { useAsync } from "../../lib/hooks.js";
import { getDeviceId } from "../../lib/session.js";
import { formatApproximate, formatDateTime, formatRelative, pluralise } from "../../lib/format.js";
import { buildTimeline, statusLabel } from "../../domain/incidents.js";
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
  EmptyState,
  ErrorState,
  KeyValueList,
  ListSkeleton,
  PageHeader,
  SeverityBadge,
  StatusBadge,
  Textarea,
  Timeline
} from "../../components/ui/index.js";

/** "Me too" / "power is back" — one confirmation per person per kind. */
function ConfirmationForm({ incidentId, onRecorded, canConfirmAffected, canConfirmRestored }) {
  const { user } = useApp();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);

  async function confirm(type) {
    setBusy(type);
    setNotice(null);
    try {
      const result = await publicApi.confirm(incidentId, {
        type,
        deviceId: user ? undefined : getDeviceId(),
        comment: comment || undefined
      });
      setComment("");
      setNotice({ tone: "success", text: type === "restored" ? "Thank you — restoration recorded." : "Thank you — your report has been added." });
      onRecorded?.(result.confirmations);
    } catch (error) {
      setNotice({ tone: "warning", text: error.message });
    } finally {
      setBusy("");
    }
  }

  if (!canConfirmAffected && !canConfirmRestored) return null;

  return (
    <div className="stack stack--sm">
      <Textarea
        label="Add a short comment (optional)"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={500}
        rows={2}
        placeholder="e.g. Still dark on our street, or power came back at noon."
      />
      <div className="inline-row">
        {canConfirmAffected ? (
          <Button variant="secondary" icon={ThumbsUp} busy={busy === "also_affected"} onClick={() => confirm("also_affected")}>
            We are affected too
          </Button>
        ) : null}
        {canConfirmRestored ? (
          <Button variant="primary" icon={CheckCircle2} busy={busy === "restored"} onClick={() => confirm("restored")}>
            Power is back
          </Button>
        ) : null}
      </div>
      {notice ? (
        <Alert tone={notice.tone} icon={notice.tone === "success" ? CheckCircle2 : undefined}>
          {notice.text}
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * Orchestrates the detail screen and keeps the information blocks — where it is,
 * how far along it is, what happened, and what the reader can still do —
 * visually separate instead of stacking everything into one block.
 */
export function IncidentDetail({ incidentId, onBack, backLabel = "Back to reports" }) {
  const detail = useAsync(() => publicApi.incident(incidentId), [incidentId]);
  const data = detail.data;
  const incident = data?.incident;

  if (detail.loading) {
    return (
      <div className="page stack">
        <ListSkeleton rows={6} />
      </div>
    );
  }

  if (detail.error || !incident) {
    return (
      <div className="page stack">
        <ErrorState
          title="We could not open this incident"
          error={detail.error}
          message={detail.error ? undefined : "This incident may have been removed."}
          onRetry={detail.reload}
        />
        <div className="inline-row">
          <Button variant="outline" onClick={onBack}>
            {backLabel}
          </Button>
        </div>
      </div>
    );
  }

  const confirmations = data.confirmations || { also_affected: 0, restored: 0 };

  return (
    <div className="page">
      <PageHeader
        breadcrumb={<Breadcrumb onBack={onBack} label={backLabel} />}
        title={incident.district || incident.title}
        subtitle={
          <span className="inline-row">
            <span className="mono">{incident.reference}</span>
            <StatusBadge status={incident.status} />
            <SeverityBadge severity={incident.severity} />
          </span>
        }
        actions={
          <span className="text-caption">
            <Clock size={13} aria-hidden="true" /> Updated{" "}
            {formatRelative(incident.updated_at || incident.created_at)}
          </span>
        }
      />

      {incident.status === "rejected" ? (
        <Alert tone="warning" title="Closed without dispatch">
          {incident.rejection_reason ||
            "Reviewers looked into this area and did not find an outage that needs a crew."}
        </Alert>
      ) : null}

      {incident.status === "closed" ? (
        <Alert tone="success" title="Supply restored">
          {incident.resolution || "This outage has been resolved and the case closed."}
        </Alert>
      ) : null}

      <div className="grid-2">
        <div className="stack">
          <Card>
            <CardHeader title="Where" subtitle="Published incident area — approximate by design" headingLevel={2} />
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
                  { label: "Area", value: incident.district },
                  {
                    label: "Approximate centre",
                    value: formatApproximate(incident.latitude, incident.longitude)
                  },
                  { label: "Estimated radius", value: `${Math.round(Number(incident.radius_m || 0))} m` }
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Progress" subtitle="What has happened so far" headingLevel={2} />
            <CardBody>
              <Timeline steps={buildTimeline(incident)} formatAt={formatDateTime} />
            </CardBody>
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="Case summary" headingLevel={2} />
            <CardBody>
              <KeyValueList
                items={[
                  { label: "Status", value: statusLabel(incident.status) },
                  {
                    label: "Citizen reports",
                    value: (
                      <span className="inline-row">
                        <Users size={14} aria-hidden="true" /> {pluralise(data.reports_count ?? 0, "report")}
                      </span>
                    )
                  },
                  { label: "Root cause", value: incident.root_cause },
                  { label: "Latest update", value: incident.resolution },
                  { label: "Crew", value: incident.assignee },
                  { label: "Reported", value: formatDateTime(incident.first_report_at || incident.created_at) },
                  { label: "Restored", value: incident.restored_at ? formatDateTime(incident.restored_at) : null },
                  { label: "Closed", value: incident.closed_at ? formatDateTime(incident.closed_at) : null }
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Neighbours" subtitle="How the area has responded" headingLevel={2} />
            <CardBody className="stack">
              <KeyValueList
                items={[
                  { label: "Also affected", value: `${confirmations.also_affected || 0} confirmed` },
                  { label: "Power restored", value: `${confirmations.restored || 0} confirmed` }
                ]}
              />
              {incident.status === "verification_pending" ? (
                <Alert tone="info" icon={Radio} title="Can you check?">
                  The crew reports the work is finished. Confirm whether your power is back so the case can close.
                </Alert>
              ) : null}
              <ConfirmationForm
                incidentId={incident.id}
                canConfirmAffected={data.can_confirm_affected}
                canConfirmRestored={data.can_confirm_restored}
                onRecorded={(counts) => detail.setData((current) => ({ ...current, confirmations: counts }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Messages" subtitle="Visible to you and the responding team" headingLevel={2} />
            <CardBody>
              <MessageThread
                incidentId={incident.id}
                messages={data.messages || []}
                onPosted={detail.reload}
                placeholder="Share anything that helps the crew."
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
