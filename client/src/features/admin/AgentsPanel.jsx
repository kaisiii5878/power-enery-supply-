/**
 * Field agents and accounts.
 *
 * Staff accounts are created here, never through public sign-up, and deactivating
 * an account locks it out immediately because the server re-reads the account on
 * every request.
 */

import { Alert, Button, Modal, Select, TextInput, useToast } from "../../components/ui/index.js";
import { useMemo, useState } from "react";
import { ShieldCheck, ShieldOff, UserPlus, Users } from "lucide-react";
import { adminApi } from "../../lib/api.js";
import { useAsync } from "../../lib/hooks.js";
import { formatDateTime, pluralise } from "../../lib/format.js";
import { ROLE_LABEL } from "../../lib/session.js";
import { useApp } from "../../app/AppContext.jsx";
import {
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  ListSkeleton,
  PageHeader,
  SearchInput,
  StatCard,
  StatGrid
} from "../../components/ui/index.js";

const ROLE_OPTIONS = [
  { value: "subcontractor", label: "Field agent (subcontractor)" },
  { value: "socadel", label: "Administrator (SOCADEL)" },
  { value: "client", label: "Citizen" }
];

const EMPTY_NEW_USER = { username: "", fullName: "", role: "subcontractor", password: "" };

/** Staff account creation. The password is chosen here and never shown again. */
function CreateUserDialog({ open, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_NEW_USER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await adminApi.createUser(form);
      toast.success("Account created", `${form.fullName} can now sign in.`);
      setForm(EMPTY_NEW_USER);
      onCreated();
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create an account"
      description="Field crew and operator accounts are created by an administrator."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} busy={busy} icon={UserPlus}>
            Create account
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextInput
          label="Full name"
          hint="For a field crew this doubles as the company name work orders are addressed to."
          value={form.fullName}
          onChange={(event) => set({ fullName: event.target.value })}
          required
          maxLength={120}
          placeholder="e.g. Ledinergy Crew 1"
        />
        <TextInput
          label="Username"
          hint="3–40 characters: lowercase letters, numbers, dot, dash or underscore."
          value={form.username}
          onChange={(event) => set({ username: event.target.value.trim().toLowerCase() })}
          required
          minLength={3}
          maxLength={40}
          placeholder="e.g. ledinergy.crew1"
        />
        <Select label="Role" value={form.role} onChange={(event) => set({ role: event.target.value })}>
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <TextInput
          label="Initial password"
          hint="At least 8 characters. Share it securely; the holder should change it after signing in."
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(event) => set({ password: event.target.value })}
          required
          minLength={8}
          maxLength={128}
        />
        {error ? (
          <Alert tone="danger" title="We could not create the account">
            {error}
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}

export function AgentsPanel() {
  const toast = useToast();
  const { user } = useApp();
  const [role, setRole] = useState("subcontractor");
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingToggle, setPendingToggle] = useState(null);
  const [busy, setBusy] = useState(false);

  const users = useAsync(async () => {
    const result = await adminApi.users({});
    return result.users || [];
  }, []);

  const crews = useAsync(async () => {
    const result = await adminApi.contractors();
    return result.contractors || [];
  }, []);

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (users.data || [])
      .filter((row) => role === "all" || row.user_role === role)
      .filter(
        (row) => !needle || `${row.username} ${row.full_name || ""}`.toLowerCase().includes(needle)
      );
  }, [users.data, role, term]);

  const counts = useMemo(() => {
    const all = users.data || [];
    return {
      total: all.length,
      agents: all.filter((row) => row.user_role === "subcontractor").length,
      operators: all.filter((row) => row.user_role === "socadel").length,
      citizens: all.filter((row) => row.user_role === "client").length
    };
  }, [users.data]);

  async function toggleActive() {
    if (!pendingToggle) return;
    setBusy(true);
    try {
      await adminApi.setUserActive(pendingToggle.id, !Number(pendingToggle.is_active));
      toast.success(
        Number(pendingToggle.is_active) ? "Account deactivated" : "Account reactivated",
        `${pendingToggle.username} updated.`
      );
      setPendingToggle(null);
      users.reload();
      crews.reload();
    } catch (error) {
      toast.error("Could not update the account", error.message);
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    {
      key: "full_name",
      header: "Name",
      render: (row) => (
        <span className="stack stack--sm">
          <span className="text-strong">{row.full_name || "—"}</span>
          <span className="mono">@{row.username}</span>
        </span>
      )
    },
    { key: "role", header: "Role", render: (row) => ROLE_LABEL[row.user_role] || row.user_role },
    {
      key: "state",
      header: "State",
      render: (row) => (
        <span className="badge" data-tone={Number(row.is_active) ? "success" : "neutral"}>
          {Number(row.is_active) ? "Active" : "Deactivated"}
        </span>
      )
    },
    {
      key: "contact",
      header: "Contact",
      render: (row) => (
        <span className="stack stack--sm">
          <span>{row.phone || "—"}</span>
          <span className="text-caption">{row.email || ""}</span>
        </span>
      )
    },
    {
      key: "created_at",
      header: "Created",
      label: "Created",
      render: (row) => formatDateTime(row.created_at)
    },
    {
      key: "actions",
      header: "",
      label: "Actions",
      actions: true,
      render: (row) =>
        Number(row.id) === Number(user?.id) ? (
          <span className="text-caption">This is you</span>
        ) : (
          <Button
            size="sm"
            variant={Number(row.is_active) ? "danger-ghost" : "outline"}
            icon={Number(row.is_active) ? ShieldOff : ShieldCheck}
            onClick={() => setPendingToggle(row)}
          >
            {Number(row.is_active) ? "Deactivate" : "Reactivate"}
          </Button>
        )
    }
  ];

  return (
    <div className="page">
      <PageHeader
        title="Field agents and accounts"
        subtitle="Who can sign in, and what they are allowed to do."
        actions={
          <Button variant="primary" icon={UserPlus} onClick={() => setCreating(true)}>
            New account
          </Button>
        }
      />

      {users.error ? (
        <ErrorState title="We could not load the accounts" error={users.error} onRetry={users.reload} />
      ) : null}

      <StatGrid>
        <StatCard icon={Users} label="Accounts" value={counts.total} hint="Citizens and staff" />
        <StatCard label="Field agents" value={counts.agents} hint="Subcontractor crews" />
        <StatCard label="Administrators" value={counts.operators} hint="SOCADEL operators" />
        <StatCard label="Citizens" value={counts.citizens} hint="Public reporting accounts" />
      </StatGrid>

      <Alert tone="info" title="How accounts are created">
        Public sign-up can only create citizen accounts. Crew and operator accounts are created here, so
        dispatch access is always a deliberate decision.
      </Alert>

      <FilterBar summary={`${rows.length} of ${counts.total} accounts`}>
        <SearchInput value={term} onChange={setTerm} placeholder="Name or username" label="Search accounts" />
        <Select label="Role" value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="all">Every role</option>
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FilterBar>

      <Card>
        <CardHeader
          title="Accounts"
          subtitle={
            crews.data
              ? `${pluralise(crews.data.filter((crew) => Number(crew.is_active)).length, "crew")} available for dispatch`
              : undefined
          }
          headingLevel={2}
        />
        {users.loading ? (
          <CardBody>
            <ListSkeleton rows={5} />
          </CardBody>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            emptyState={
              <EmptyState
                compact
                icon={Users}
                title="No accounts match"
                message="Try a different role, or clear the search."
              />
            }
          />
        )}
      </Card>

      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onCreated={users.reload} />

      <ConfirmDialog
        open={Boolean(pendingToggle)}
        onCancel={() => setPendingToggle(null)}
        onConfirm={toggleActive}
        title={Number(pendingToggle?.is_active) ? "Deactivate this account" : "Reactivate this account"}
        message={
          Number(pendingToggle?.is_active)
            ? `${pendingToggle?.full_name || pendingToggle?.username} will be locked out immediately. Open work orders stay assigned to them.`
            : `${pendingToggle?.full_name || pendingToggle?.username} will be able to sign in again.`
        }
        confirmLabel={Number(pendingToggle?.is_active) ? "Deactivate" : "Reactivate"}
        tone={Number(pendingToggle?.is_active) ? "danger" : "primary"}
        busy={busy}
      />
    </div>
  );
}

