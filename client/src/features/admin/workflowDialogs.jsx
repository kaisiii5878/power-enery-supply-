/**
 * Incident workflow dialogs for the operations console.
 *
 * The server returns `next_statuses` on the incident detail and rejects anything
 * else with INVALID_TRANSITION, so the buttons come from that list rather than
 * from the client's own idea of the state machine. Every step that needs input
 * opens a form — nothing is written on a single unexplained click.
 */

import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { adminApi, incidentsApi } from "../../lib/api.js";
import { useAsync } from "../../lib/hooks.js";
import { Alert, Button, Modal, Select, Textarea, TextInput, useToast } from "../../components/ui/index.js";

/** Assign: pick a crew account from the ones that actually exist. */
export function AssignDialog({ open, onClose, onDone, incident }) {
  const toast = useToast();
  const crews = useAsync(async () => {
    const result = await adminApi.contractors();
    return (result.contractors || []).filter((crew) => Number(crew.is_active));
  }, [open]);
  const [contractor, setContractor] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await incidentsApi.assign(incident.id, contractor);
      toast.success("Work order issued", `${contractor} has been notified.`);
      setContractor("");
      onDone();
      onClose();
    } catch (error) {
      toast.error("Could not assign the incident", error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign a field crew"
      description={`Issue a work order for ${incident.reference} in ${incident.district}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={!contractor}>
            Send work order
          </Button>
        </>
      }
    >
      <div className="stack">
        {crews.loading ? (
          <p className="text-secondary">Loading crew accounts…</p>
        ) : crews.error ? (
          <Alert tone="danger" title="Could not load crew accounts">
            {crews.error.message}
          </Alert>
        ) : (crews.data || []).length === 0 ? (
          <Alert tone="warning" title="No active crew accounts">
            Create a subcontractor account under Field agents before dispatching work.
          </Alert>
        ) : (
          <Select
            label="Field crew"
            value={contractor}
            onChange={(event) => setContractor(event.target.value)}
            hint="Only validated incidents can be assigned."
          >
            <option value="">Choose a crew…</option>
            {(crews.data || []).map((crew) => (
              <option key={crew.id} value={crew.name}>
                {crew.name} (@{crew.username})
              </option>
            ))}
          </Select>
        )}
      </div>
    </Modal>
  );
}

/** Generic "needs a written reason" dialog — used for both reject and reopen. */
export function ReasonDialog({ open, onClose, onDone, title, description, label, hint, cta, incident, action }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await action(reason);
      toast.success(`${title} recorded`, `${incident.reference} updated.`);
      setReason("");
      onDone();
      onClose();
    } catch (error) {
      toast.error(`Could not record “${title}”`, error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={reason.trim().length < 5}>
            {cta}
          </Button>
        </>
      }
    >
      <Textarea
        label={label}
        hint={hint}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={4}
        maxLength={500}
        placeholder="At least a short sentence — this is stored in the audit trail."
      />
    </Modal>
  );
}

/** Closing needs a summary, and an explicit override when nobody confirmed. */
export function CloseDialog({ open, onClose, onDone, incident, restoredConfirmations }) {
  const toast = useToast();
  const [summary, setSummary] = useState(incident.resolution || "");
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const unverified = Number(restoredConfirmations || 0) < 1;

  async function submit() {
    setBusy(true);
    try {
      await incidentsApi.close(incident.id, { summary, override });
      toast.success("Incident closed", `${incident.reference} is complete.`);
      onDone();
      onClose();
    } catch (error) {
      toast.error("Could not close the incident", error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Close the incident"
      description={`${incident.reference} · ${incident.district}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={unverified && !override}>
            Close incident
          </Button>
        </>
      }
    >
      <div className="stack">
        {unverified ? (
          <Alert tone="warning" title="No citizen has confirmed restoration">
            Closing anyway is an operator override, and it is recorded in the audit trail.
          </Alert>
        ) : (
          <Alert tone="success" title="Restoration confirmed">
            {restoredConfirmations} citizen confirmation(s) recorded for this outage.
          </Alert>
        )}

        <Textarea
          label="Closure summary"
          hint="Shown to citizens on the public incident page."
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="e.g. Fuse replaced, supply restored and verified."
        />

        {unverified ? (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={override}
              onChange={(event) => setOverride(event.target.checked)}
            />
            <span>Close with an operator override</span>
          </label>
        ) : null}
      </div>
    </Modal>
  );
}

/** Validate needs an optional root cause and agency report. */
export function ValidateDialog({ open, onClose, onDone, incident }) {
  const toast = useToast();
  const [agencyReport, setAgencyReport] = useState(incident.agency_report || "");
  const [rootCause, setRootCause] = useState(incident.root_cause || "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await incidentsApi.validate(incident.id, { agencyReport, rootCause });
      toast.success("Incident validated", `${incident.reference} can now be assigned.`);
      onDone();
      onClose();
    } catch (error) {
      toast.error("Could not validate the incident", error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Validate this incident"
      description="Confirming turns a cluster of reports into a real outage that can be dispatched."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} busy={busy} icon={ClipboardCheck}>
            Validate incident
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextInput
          label="Root cause (optional)"
          hint="What operations believe caused the outage."
          value={rootCause}
          onChange={(event) => setRootCause(event.target.value)}
          maxLength={180}
          placeholder="e.g. Feeder F3 trip confirmed by SCADA"
        />
        <Textarea
          label="Agency report (optional)"
          hint="Visible to the assigned crew as part of the work order."
          value={agencyReport}
          onChange={(event) => setAgencyReport(event.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="What the operator checked before dispatch."
        />
      </div>
    </Modal>
  );
}

