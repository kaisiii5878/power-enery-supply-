/**
 * Announcements.
 *
 * Drafts stay invisible to citizens; publishing is a deliberate act. Audience
 * decides whether a notice reaches citizens, crews or everyone.
 */

import { useMemo, useState } from "react";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { adminApi } from "../../lib/api.js";
import { useAsync } from "../../lib/hooks.js";
import { formatDateTime, formatRelative } from "../../lib/format.js";
import { useApp } from "../../app/AppContext.jsx";
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
  Textarea,
  useToast
} from "../../components/ui/index.js";

const AUDIENCES = [
  { value: "all", label: "Everyone" },
  { value: "client", label: "Citizens" },
  { value: "subcontractor", label: "Field crews" }
];

function AnnouncementForm({ announcement, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    title: announcement?.title || "",
    body: announcement?.body || "",
    audience: announcement?.audience || "all",
    published: announcement ? Number(announcement.published) === 1 : true
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (announcement) await adminApi.updateAnnouncement(announcement.id, form);
      else await adminApi.createAnnouncement(form);
      toast.success(announcement ? "Announcement updated" : "Announcement saved", form.title);
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
      title={announcement ? "Edit announcement" : "New announcement"}
      description="Published notices appear on the citizen home screen."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            busy={busy}
            disabled={form.title.trim().length < 3 || form.body.trim().length < 5}
          >
            {form.published ? "Save and publish" : "Save as draft"}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextInput
          label="Title"
          value={form.title}
          onChange={(event) => set({ title: event.target.value })}
          required
          maxLength={180}
          placeholder="e.g. Planned maintenance in Bastos"
        />
        <Textarea
          label="Message"
          hint="Say what is happening, when, and what residents should do."
          value={form.body}
          onChange={(event) => set({ body: event.target.value })}
          required
          rows={5}
          maxLength={4000}
          placeholder="Scheduled works on 28 September 2026 from 08:00 to 14:00."
        />
        <Select
          label="Audience"
          value={form.audience}
          onChange={(event) => set({ audience: event.target.value })}
        >
          {AUDIENCES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.published}
            onChange={(event) => set({ published: event.target.checked })}
          />
          <span>Publish immediately (unpublished notices stay as drafts)</span>
        </label>
        {error ? (
          <Alert tone="danger" title="We could not save the announcement">
            {error}
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}

export { AnnouncementForm };

export function AnnouncementsPanel() {
  const toast = useToast();
  const { announcements: publicAnnouncements } = useApp();
  const [term, setTerm] = useState("");
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = useAsync(async () => {
    const result = await adminApi.announcements();
    return result.announcements || [];
  }, []);

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (list.data || []).filter(
      (item) => !needle || `${item.title} ${item.body}`.toLowerCase().includes(needle)
    );
  }, [list.data, term]);

  const published = (list.data || []).filter((item) => Number(item.published) === 1).length;

  async function remove() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await adminApi.deleteAnnouncement(pendingDelete.id);
      toast.success("Announcement deleted", pendingDelete.title);
      setPendingDelete(null);
      list.reload();
    } catch (error) {
      toast.error("Could not delete the announcement", error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Announcements"
        subtitle="Planned maintenance and public notices."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New announcement
          </Button>
        }
      />

      {list.error ? (
        <ErrorState title="We could not load the announcements" error={list.error} onRetry={list.reload} />
      ) : null}

      <StatGrid>
        <StatCard icon={Megaphone} label="Published" value={published} hint="Visible to citizens" />
        <StatCard label="Drafts" value={(list.data || []).length - published} hint="Not yet visible" />
        <StatCard
          label="Visible to citizens now"
          value={publicAnnouncements.length}
          hint="What the public API is serving"
        />
      </StatGrid>

      <Alert tone="info" title="Who sees what">
        A notice with the Citizen or Everyone audience appears on the citizen home screen as soon as it is
        published. Crew notices appear only in the field app.
      </Alert>

      <FilterBar summary={`${rows.length} of ${(list.data || []).length} announcements`}>
        <SearchInput
          value={term}
          onChange={setTerm}
          placeholder="Title or message"
          label="Search announcements"
        />
      </FilterBar>

      <Card>
        <CardHeader title="All announcements" headingLevel={2} />
        {list.loading ? (
          <CardBody>
            <ListSkeleton rows={3} />
          </CardBody>
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={Megaphone}
            title="No announcements yet"
            message="Publish a notice to tell residents about planned works or a restoration."
            actions={
              <Button variant="outline" onClick={() => setCreating(true)}>
                Write the first announcement
              </Button>
            }
          />
        ) : (
          <ul className="list">
            {rows.map((item) => (
              <li className="list__row" key={item.id}>
                <span className="list__main">
                  <span className="list__title">{item.title}</span>
                  <span className="list__meta">
                    <span
                      className="badge"
                      data-tone={Number(item.published) ? "success" : "neutral"}
                    >
                      {Number(item.published) ? "Published" : "Draft"}
                    </span>
                    <span>
                      {AUDIENCES.find((audience) => audience.value === item.audience)?.label || item.audience}
                    </span>
                    <span>{formatRelative(item.created_at)}</span>
                    <span>by {item.created_by}</span>
                  </span>
                  <span className="text-secondary">{item.body}</span>
                </span>
                <span className="list__aside">
                  <Button size="sm" variant="outline" icon={Pencil} onClick={() => setEditing(item)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    icon={Trash2}
                    onClick={() => setPendingDelete(item)}
                  >
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating ? (
        <AnnouncementForm key="new" onClose={() => setCreating(false)} onSaved={list.reload} />
      ) : null}
      {editing ? (
        <AnnouncementForm
          key={editing.id}
          announcement={editing}
          onClose={() => setEditing(null)}
          onSaved={list.reload}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={remove}
        title="Delete this announcement"
        message={`“${pendingDelete?.title}” will be removed from the citizen home screen. This cannot be undone.`}
        confirmLabel="Delete announcement"
        busy={busy}
      />

      {list.data?.length ? (
        <p className="text-caption">
          Last updated {formatDateTime(list.data[0].updated_at || list.data[0].created_at)}.
        </p>
      ) : null}
    </div>
  );
}
