/**
 * Guided outage report — the citizen view.
 *
 * Four short steps plus a real confirmation screen: after submitting, the user
 * gets the reference, the time, the approximate place, the current status and a
 * way to follow the case, instead of a toast that disappears.
 */

import { CheckCircle2, LocateFixed, MapPin, Search, Send, TriangleAlert } from "lucide-react";
import { useReportCategories } from "../../app/AppContext.jsx";
import { REGIONS, citiesFor, quartersFor } from "../../domain/cameroon.js";
import { formatDateTime } from "../../lib/format.js";
import { LocationPicker } from "../../components/map/MapView.jsx";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  KeyValueList,
  PageHeader,
  ProgressSteps,
  Select,
  StatusBadge,
  TextInput,
  Textarea
} from "../../components/ui/index.js";
import { STEPS, useReportFlow } from "./reportFlowState.js";

/** Post-submit screen. Carries the reference and the next step. */
export function ReportSuccess({ receipt, onTrack, onAnother, onHome }) {
  return (
    <div className="page">
      <Card>
        <CardBody className="stack">
          <span className="state__icon" data-tone="info" aria-hidden="true">
            <CheckCircle2 size={22} />
          </span>
          <div className="stack stack--sm">
            <h1 className="page-title">Report submitted</h1>
            <p className="text-secondary">
              Your outage report has been received. Nearby reports for the same area are grouped together
              automatically.
            </p>
          </div>

          <KeyValueList
            items={[
              { label: "Reference", value: <span className="mono">{receipt.reference}</span> },
              { label: "Submitted", value: formatDateTime(receipt.submittedAt) },
              { label: "Approximate location", value: receipt.district },
              { label: "Status", value: <StatusBadge status={receipt.incident_status} /> },
              { label: "Reports in this area", value: `${receipt.reports_count || 1}` },
              { label: "Severity assessed", value: receipt.severity }
            ]}
          />

          <Alert tone="info" title="What happens next">
            {receipt.matched_existing
              ? "Your report joined an existing outage cluster. SOCADEL will validate it and dispatch a crew if needed."
              : "This area is collecting reports. Once enough neighbours confirm the outage it goes to SOCADEL for validation and crew dispatch."}
          </Alert>

          <div className="inline-row">
            <Button variant="primary" onClick={onTrack}>
              Track this report
            </Button>
            <Button variant="outline" onClick={onAnother}>
              Report another problem
            </Button>
            <Button variant="ghost" onClick={onHome}>
              Back to home
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export function ReportFlow({ onSent, onCancel, reporterName = "" }) {
  const categories = useReportCategories();
  const flow = useReportFlow({ reporterName, onSent });
  const { draft, errors } = flow;

  function onRegionChange(region) {
    const city = citiesFor(region)[0] || "";
    flow.update({ region, city, quarter: quartersFor(region, city)[0] || "" });
  }

  return (
    <div className="page">
      <PageHeader
        breadcrumb={
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <button type="button" onClick={onCancel}>
              ← Cancel report
            </button>
          </nav>
        }
        title="Report an outage"
        subtitle="It takes about a minute. Location first, then what is wrong."
      />

      <ProgressSteps steps={STEPS} currentIndex={flow.step} label="Report progress" />

      <Card>
        <CardHeader
          title={STEPS[flow.step]}
          subtitle={
            flow.step === 0
              ? "Where is the problem? GPS is optional — you can always place the pin yourself."
              : flow.step === 1
                ? "What kind of problem are you seeing?"
                : flow.step === 2
                  ? "Anything else that helps the crew, and how to reach you."
                  : "Check the details before sending."
          }
          headingLevel={2}
        />
        <CardBody className="stack">{renderStep()}</CardBody>
      </Card>

      <div className="inline-row">
        {flow.step > 0 ? (
          <Button variant="outline" onClick={flow.back}>
            Back
          </Button>
        ) : null}
        {flow.step < STEPS.length - 1 ? (
          <Button variant="primary" onClick={flow.next}>
            Continue
          </Button>
        ) : (
          <Button variant="primary" icon={Send} busy={flow.busy} onClick={flow.submit}>
            Submit report
          </Button>
        )}
        <span className="text-caption">
          Step {flow.step + 1} of {STEPS.length}
        </span>
      </div>
    </div>
  );

  function renderStep() {
    if (flow.step === 0) return <LocationStep flow={flow} onRegionChange={onRegionChange} />;
    if (flow.step === 1) return <DetailsStep flow={flow} categories={categories} />;
    if (flow.step === 2) return <ExtraStep flow={flow} signedIn={Boolean(reporterName)} />;
    return <ReviewStep flow={flow} />;
  }
}

/* ---- step 2: outage details -------------------------------------------- */

function DetailsStep({ flow, categories }) {
  const { draft, errors } = flow;

  return (
    <>
      <Select
        label="What is happening?"
        value={draft.category}
        onChange={(event) => flow.update({ category: event.target.value })}
        error={errors.category}
      >
        {categories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </Select>

      <Textarea
        label="Describe the problem (optional)"
        hint="Anything useful: when it started, how many houses are affected, whether you saw or heard anything."
        value={draft.description}
        onChange={(event) => flow.update({ description: event.target.value })}
        maxLength={1000}
        rows={4}
        placeholder="e.g. No power since 18:30, the whole block is dark."
      />

      <Alert tone="info" title="How severity is decided">
        You do not choose a severity. PowerWatch measures how many reports arrive nearby and how far they
        spread, then rates the cluster from low to critical.
      </Alert>
    </>
  );
}

/* ---- step 3: extra information ----------------------------------------- */

function ExtraStep({ flow, signedIn }) {
  const { draft } = flow;

  return (
    <>
      {signedIn ? (
        <Alert tone="info" title="You are signed in">
          Your report is attached to your account, so you can follow it from “My reports”.
        </Alert>
      ) : (
        <TextInput
          label="Your name (optional)"
          hint="Leave blank to report anonymously. Your name is never shown on the public map."
          value={draft.reporterName}
          onChange={(event) => flow.update({ reporterName: event.target.value })}
          maxLength={120}
          placeholder="e.g. Aida N."
        />
      )}

      <TextInput
        label="Phone number (optional)"
        hint="Only visible to SOCADEL and the crew, in case they need to reach you."
        type="tel"
        value={draft.phone}
        onChange={(event) => flow.update({ phone: event.target.value })}
        maxLength={40}
        placeholder="+237 6 00 00 00 00"
      />

      <Alert tone="info" title="Your location stays private">
        Your exact coordinates are used to group nearby reports. The public map only ever shows the
        approximate incident area, never your address.
      </Alert>
    </>
  );
}

/* ---- step 4: review ---------------------------------------------------- */

function ReviewStep({ flow }) {
  const { draft } = flow;

  return (
    <>
      <KeyValueList
        items={[
          { label: "Location", value: flow.district },
          {
            label: "Pin",
            value:
              draft.latitude != null
                ? `${draft.latitude.toFixed(4)}, ${draft.longitude.toFixed(4)}`
                : "Not placed"
          },
          { label: "Problem", value: draft.category },
          { label: "Description", value: draft.description || "—" },
          { label: "Reported by", value: draft.reporterName || "Anonymous citizen" },
          { label: "Phone", value: draft.phone || "Not provided" }
        ]}
      />

      {flow.submitError ? (
        <Alert tone="danger" title="We could not send your report">
          {flow.submitError}
        </Alert>
      ) : null}

      <Alert tone="info" icon={TriangleAlert} title="Before you send">
        Check the location: grouping with neighbours depends on the pin. You can go back and adjust it
        without losing anything you have typed.
      </Alert>
    </>
  );
}

/* ---- step 1: location -------------------------------------------------- */

function LocationStep({ flow, onRegionChange }) {
  const { draft, errors } = flow;

  return (
    <>
      <div className="inline-row">
        <Button variant="secondary" icon={LocateFixed} onClick={flow.useCurrentLocation}>
          Use my location
        </Button>
        <Button
          variant="outline"
          icon={Search}
          onClick={flow.lookupPlace}
          busy={flow.searching}
          disabled={!draft.quarter.trim() || draft.quarter.trim().length < 3}
        >
          Find this quarter on the map
        </Button>
        {draft.latitude != null ? (
          <span className="badge" data-tone="success">
            Pin placed
          </span>
        ) : null}
      </div>

      {flow.locationNotice ? (
        <Alert tone={errors.location ? "warning" : "info"}>{flow.locationNotice}</Alert>
      ) : null}

      {errors.location ? <Alert tone="warning" title="Location needed">{errors.location}</Alert> : null}

      <div className="locationFields" style={{ display: "grid", gap: "var(--space-3)" }}>
        <Select label="Region" value={draft.region} onChange={(event) => onRegionChange(event.target.value)}>
          {REGIONS.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </Select>

        <TextInput
          label="City or town"
          list="report-cities"
          value={draft.city}
          onChange={(event) => flow.update({ city: event.target.value })}
          placeholder="e.g. Douala"
          error={errors.city}
        />
        <datalist id="report-cities">
          {citiesFor(draft.region).map((city) => (
            <option key={city} value={city} />
          ))}
        </datalist>

        <TextInput
          label="Quarter or neighbourhood"
          hint="Suggestions are offered for all ten regions, and any name can be typed."
          list="report-quarters"
          value={draft.quarter}
          onChange={(event) => flow.update({ quarter: event.target.value })}
          placeholder="e.g. Akwa"
          error={errors.quarter}
        />
        <datalist id="report-quarters">
          {quartersFor(draft.region, draft.city).map((quarter) => (
            <option key={quarter} value={quarter} />
          ))}
        </datalist>
      </div>

      {flow.places.length ? (
        <div className="stack stack--sm" role="list" aria-label="Mapped place matches">
          {flow.places.map((place, index) => (
            <Button
              key={`${place.latitude}-${place.longitude}-${index}`}
              variant="outline"
              block
              onClick={() => flow.choosePlace(place)}
            >
              <span className="stack stack--sm" style={{ textAlign: "left" }}>
                <strong>{place.name}</strong>
                <span className="text-caption">{place.displayName}</span>
              </span>
            </Button>
          ))}
        </div>
      ) : null}

      <div className="stack stack--sm">
        <span className="field__label">Pin the exact spot</span>
        <LocationPicker
          value={draft.latitude != null ? { latitude: draft.latitude, longitude: draft.longitude } : null}
          onChange={(position) => {
            if (!position) {
              flow.update({ latitude: null, longitude: null });
              return;
            }
            flow.update(position);
            flow.setLocationNotice("Pin placed. You can tap again to move it.");
          }}
          centre={flow.centre}
          label="Tap anywhere on the map to place the pin"
        />
        {draft.latitude != null ? (
          <p className="text-caption">
            <MapPin size={13} aria-hidden="true" /> Pin at {draft.latitude.toFixed(4)},{" "}
            {draft.longitude.toFixed(4)} — only your district is ever published.
          </p>
        ) : null}
      </div>
    </>
  );
}

