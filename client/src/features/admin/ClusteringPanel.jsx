/**
 * Detection rules.
 *
 * The three numbers that decide when scattered reports become an incident worth
 * dispatching. Changing them changes what the whole platform considers an outage,
 * so the effect of each field is spelled out and saving is a deliberate step.
 */

import { useState } from "react";
import { Save, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { adminApi } from "../../lib/api.js";
import { useAsync } from "../../lib/hooks.js";
import { formatDistance } from "../../lib/format.js";
import { useApp } from "../../app/AppContext.jsx";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  KeyValueList,
  ListSkeleton,
  PageHeader,
  StatCard,
  StatGrid,
  TextInput,
  useToast
} from "../../components/ui/index.js";

const FIELDS = [
  {
    key: "cluster_distance_m",
    label: "Clustering distance (metres)",
    hint: "Reports within this distance of each other are treated as the same outage.",
    min: 50,
    max: 10000,
    step: 50
  },
  {
    key: "cluster_window_minutes",
    label: "Time window (minutes)",
    hint: "Only reports from this far back are considered for grouping.",
    min: 5,
    max: 1440,
    step: 5
  },
  {
    key: "min_reports_to_qualify",
    label: "Reports needed to qualify",
    hint: "How many reports a cluster needs before it is sent to SOCADEL for validation.",
    min: 1,
    max: 100,
    step: 1
  }
];

export function ClusteringPanel() {
  const toast = useToast();
  const { config, reloadFeed } = useApp();
  const settings = useAsync(() => adminApi.clusteringConfig(), []);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const current = settings.data;
  const value = draft || current || config?.clustering || {};
  const dirty = current && draft
    ? FIELDS.some((field) => Number(value[field.key]) !== Number(current[field.key]))
    : false;

  async function save() {
    setBusy(true);
    try {
      const saved = await adminApi.saveClusteringConfig({
        cluster_distance_m: Number(value.cluster_distance_m),
        cluster_window_minutes: Number(value.cluster_window_minutes),
        min_reports_to_qualify: Number(value.min_reports_to_qualify)
      });
      toast.success("Detection rules saved", "New reports use these settings immediately.");
      setDraft(saved);
      settings.reload();
      reloadFeed();
    } catch (error) {
      toast.error("Could not save the rules", error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Detection rules"
        subtitle="How scattered citizen reports become a single incident."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={!dirty}>
              Discard changes
            </Button>
            <Button variant="primary" icon={Save} onClick={save} busy={busy} disabled={!dirty}>
              Save rules
            </Button>
          </>
        }
      />

      {settings.error ? (
        <ErrorState
          title="We could not load the current rules"
          error={settings.error}
          onRetry={settings.reload}
        />
      ) : null}

      {settings.loading || !current ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <StatGrid>
            <StatCard
              icon={SlidersHorizontal}
              label="Clustering distance"
              value={formatDistance(current.cluster_distance_m)}
              hint="Reports grouped within this radius"
            />
            <StatCard
              label="Time window"
              value={`${current.cluster_window_minutes} min`}
              hint="How far back reports are considered"
            />
            <StatCard
              label="Qualifying reports"
              value={current.min_reports_to_qualify}
              hint="Before validation is requested"
            />
          </StatGrid>

          {dirty ? (
            <Alert tone="warning" icon={TriangleAlert} title="Unsaved changes">
              This form differs from what is running. New reports keep using the saved values until you save.
            </Alert>
          ) : null}

          <div className="grid-2">
            <Card>
              <CardHeader title="Cluster settings" headingLevel={2} />
              <CardBody className="stack">
                {FIELDS.map((field) => (
                  <TextInput
                    key={field.key}
                    label={field.label}
                    hint={field.hint}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={value[field.key] ?? ""}
                    onChange={(event) =>
                      setDraft({ ...(draft || current), [field.key]: event.target.value })
                    }
                    required
                  />
                ))}
                <p className="text-caption">
                  Each value is validated by the server: a positive number within its allowed range.
                </p>
              </CardBody>
            </Card>

            <div className="stack">
              <Card>
                <CardHeader
                  title="Currently running"
                  subtitle="What the public configuration reports"
                  headingLevel={2}
                />
                <CardBody>
                  <KeyValueList
                    items={[
                      { label: "Distance", value: `${current.cluster_distance_m} m` },
                      { label: "Window", value: `${current.cluster_window_minutes} minutes` },
                      { label: "Qualifying reports", value: String(current.min_reports_to_qualify) },
                      {
                        label: "Public categories",
                        value: (config?.report_categories || []).join(", ") || "—"
                      },
                      { label: "Field provider", value: config?.subcontractor_name || "—" },
                      { label: "Publish precision", value: `${config?.location_precision ?? "—"} decimals` }
                    ]}
                  />
                </CardBody>
              </Card>

              <Alert tone="info" title="Impact of these numbers">
                A larger distance or a longer window groups more reports into one incident, which reduces
                dispatches but can merge unrelated faults. A higher qualifying count means an incident is only
                escalated once more of the neighbourhood has reported.
              </Alert>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
