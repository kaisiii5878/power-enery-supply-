/**
 * Operational zones.
 *
 * A zone is a named circle the clustering engine uses to tag new incidents. The
 * centre and the radius are what matter operationally, so they get the prominence.
 */

import { useMemo, useState } from "react";
import { MapPinned, Pencil, Plus, Trash2 } from "lucide-react";
import { adminApi } from "../../lib/api.js";
import { useAsync } from "../../lib/hooks.js";
import { formatDistance } from "../../lib/format.js";
import { REGIONS } from "../../domain/cameroon.js";
import { MapCanvas, MapAttribution } from "../../components/map/MapView.jsx";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterBar,
  ListSkeleton,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  StatGrid,
  TextInput,
  useToast
} from "../../components/ui/index.js";

const DEFAULT_CENTRE = { latitude: "4.0511", longitude: "9.7679" };

function ZoneForm({ zone, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() =>
    zone
      ? {
          name: zone.name,
          description: zone.description || "",
          region: zone.region || "Littoral",
          latitude: String(zone.latitude),
          longitude: String(zone.longitude),
          radius_m: String(zone.radius_m)
        }
      : { name: "", description: "", region: "Littoral", radius_m: "7000", ...DEFAULT_CENTRE }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function submit() {
    setBusy(true);
    setError("");
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      region: form.region,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      radius_m: Number(form.radius_m)
    };
    try {
      if (zone) await adminApi.updateZone(zone.id, payload);
      else await adminApi.createZone(payload);
      toast.success(zone ? "Zone updated" : "Zone created", `${payload.name} saved.`);
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={zone ? `Edit ${zone.name}` : "Create a zone"}
      description="Incidents that fall inside this circle are tagged with the zone."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={form.name.trim().length < 2}>
            Save zone
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextInput
          label="Zone name"
          hint="Must be unique — it is how operators refer to the area."
          value={form.name}
          onChange={(event) => set({ name: event.target.value })}
          required
          maxLength={120}
          placeholder="e.g. Douala Wouri"
        />
        <Select label="Region" value={form.region} onChange={(event) => set({ region: event.target.value })}>
          {REGIONS.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </Select>
        <div className="grid-2">
          <TextInput
            label="Centre latitude"
            type="number"
            step="0.0001"
            value={form.latitude}
            onChange={(event) => set({ latitude: event.target.value })}
            required
          />
          <TextInput
            label="Centre longitude"
            type="number"
            step="0.0001"
            value={form.longitude}
            onChange={(event) => set({ longitude: event.target.value })}
            required
          />
        </div>
        <TextInput
          label="Radius (metres)"
          hint="At least 100 m. A zone is a broad area, not an address."
          type="number"
          min="100"
          step="100"
          value={form.radius_m}
          onChange={(event) => set({ radius_m: event.target.value })}
          required
        />
        <TextInput
          label="Description (optional)"
          value={form.description}
          onChange={(event) => set({ description: event.target.value })}
          maxLength={255}
          placeholder="e.g. Akwa, Bonamoussadi and Deido feeders"
        />
        {error ? (
          <Alert tone="danger" title="We could not save the zone">
            {error}
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}

export { ZoneForm };

export function ZonesPanel() {
  const toast = useToast();
  const [term, setTerm] = useState("");
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const zones = useAsync(async () => {
    const result = await adminApi.zones();
    return result.zones || [];
  }, []);

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (zones.data || []).filter(
      (zone) => !needle || `${zone.name} ${zone.region || ""}`.toLowerCase().includes(needle)
    );
  }, [zones.data, term]);

  /**
   * Zones are drawn with the same map component as incidents by adapting them to
   * the incident shape the map expects, so the map stays a single implementation.
   */
  const mapZones = useMemo(
    () =>
      rows.map((zone) => ({
        id: `zone-${zone.id}`,
        reference: zone.name,
        district: zone.region || "",
        latitude: zone.latitude,
        longitude: zone.longitude,
        radius_m: zone.radius_m,
        reports_count: 0,
        severity: "low",
        status: "pending"
      })),
    [rows]
  );

  async function remove() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await adminApi.deleteZone(pendingDelete.id);
      toast.success("Zone deleted", `${pendingDelete.name} removed.`);
      setPendingDelete(null);
      zones.reload();
    } catch (error) {
      toast.error("Could not delete the zone", error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Zones"
        subtitle="Named areas used to tag incidents as they are reported."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New zone
          </Button>
        }
      />

      {zones.error ? (
        <ErrorState title="We could not load the zones" error={zones.error} onRetry={zones.reload} />
      ) : null}

      <StatGrid>
        <StatCard icon={MapPinned} label="Zones configured" value={(zones.data || []).length} />
        <StatCard
          label="Regions covered"
          value={new Set((zones.data || []).map((zone) => zone.region).filter(Boolean)).size}
        />
      </StatGrid>

      <FilterBar summary={`${rows.length} of ${(zones.data || []).length} zones`}>
        <SearchInput value={term} onChange={setTerm} placeholder="Zone or region" label="Search zones" />
      </FilterBar>

      <div className="grid-2">
        <Card>
          <CardHeader title="Configured zones" headingLevel={2} />
          {zones.loading ? (
            <CardBody>
              <ListSkeleton rows={3} />
            </CardBody>
          ) : rows.length === 0 ? (
            <EmptyState
              compact
              icon={MapPinned}
              title="No zones yet"
              message="Incidents are still clustered by distance and time; zones simply add a human-readable area label."
              actions={
                <Button variant="outline" onClick={() => setCreating(true)}>
                  Create the first zone
                </Button>
              }
            />
          ) : (
            <ul className="list">
              {rows.map((zone) => (
                <li className="list__row" key={zone.id}>
                  <span className="list__main">
                    <span className="list__title">{zone.name}</span>
                    <span className="list__meta">
                      <span>{zone.region || "No region"}</span>
                      <span>{formatDistance(zone.radius_m)} radius</span>
                      <span>
                        {Number(zone.latitude).toFixed(3)}, {Number(zone.longitude).toFixed(3)}
                      </span>
                    </span>
                    {zone.description ? <span className="text-secondary">{zone.description}</span> : null}
                  </span>
                  <span className="list__aside">
                    <Button size="sm" variant="outline" icon={Pencil} onClick={() => setEditing(zone)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger-ghost"
                      icon={Trash2}
                      onClick={() => setPendingDelete(zone)}
                    >
                      Delete
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="stack">
          <MapCanvas
            incidents={mapZones}
            variant="panel"
            showLocate={false}
            showLegend={false}
            label="Configured operational zones"
          />
          <MapAttribution />
        </div>
      </div>

      {creating ? (
        <ZoneForm key="new" onClose={() => setCreating(false)} onSaved={zones.reload} />
      ) : null}
      {editing ? (
        <ZoneForm key={editing.id} zone={editing} onClose={() => setEditing(null)} onSaved={zones.reload} />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={remove}
        title="Delete this zone"
        message={`${pendingDelete?.name} will be removed. Incidents already tagged to it keep their history but lose the label.`}
        confirmLabel="Delete zone"
        busy={busy}
      />
    </div>
  );
}
