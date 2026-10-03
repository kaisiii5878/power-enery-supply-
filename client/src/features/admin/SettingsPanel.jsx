/**
 * Settings.
 *
 * Own account, own password, and the state of the services the console depends
 * on. Nothing here changes other people's access — that lives on the accounts
 * screen.
 */

import { useState } from "react";
import { Database, Globe, KeyRound, Server } from "lucide-react";
import { authApi, request } from "../../lib/api.js";
import { useAsync } from "../../lib/hooks.js";
import { formatDateTime, formatRelative, initials } from "../../lib/format.js";
import { ROLE_LABEL } from "../../lib/session.js";
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

function ChangePasswordForm() {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password changed", "Use the new password the next time you sign in.");
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <TextInput
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        required
      />
      <TextInput
        label="New password"
        hint="At least 8 characters. Other sessions continue until their token expires."
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        required
        minLength={8}
        maxLength={128}
        error={error || undefined}
      />
      <div>
        <Button type="submit" variant="primary" icon={KeyRound} busy={busy}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export function SettingsPanel() {
  const { user, config } = useApp();
  const role = user?.role || user?.user_role || null;
  const health = useAsync(() => request("/health", { anonymous: true }), []);

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        subtitle="Your account and the services behind the console."
        actions={
          <Button variant="outline" icon={Server} onClick={health.reload} busy={health.loading}>
            Check services
          </Button>
        }
      />

      <StatGrid>
        <StatCard
          icon={Database}
          label="Storage engine"
          value={health.data?.database === "mysql" ? "MySQL" : health.data ? "In-memory" : "—"}
          hint={
            health.data?.database === "mysql"
              ? "Data survives restarts"
              : "Demonstration data resets when the server restarts"
          }
        />
        <StatCard
          icon={Server}
          label="Server"
          value={health.data?.ok ? "Healthy" : health.error ? "Unreachable" : "—"}
          hint={
            health.data?.uptime_seconds !== undefined
              ? `Up ${Math.round(health.data.uptime_seconds / 60)} minutes`
              : undefined
          }
        />
        <StatCard
          icon={Globe}
          label="Environment"
          value={health.data?.environment || "—"}
          hint="Reported by the API"
        />
      </StatGrid>

      {health.error ? (
        <ErrorState
          title="The API is not responding"
          error={health.error}
          message="The console cannot read or write anything until the server is reachable."
          onRetry={health.reload}
        />
      ) : null}

      <div className="grid-2">
        <Card>
          <CardHeader title="Your account" headingLevel={2} />
          <CardBody className="stack">
            <div className="inline-row">
              <span className="state__icon" data-tone="info" aria-hidden="true">
                <strong>{initials(user?.name || user?.username)}</strong>
              </span>
              <div className="stack stack--sm">
                <span className="section-title">{user?.name || user?.username}</span>
                <span className="text-secondary">
                  @{user?.username} · {ROLE_LABEL[role] || role}
                </span>
              </div>
            </div>
            <KeyValueList
              items={[
                { label: "Username", value: user?.username },
                { label: "Role", value: ROLE_LABEL[role] || role },
                { label: "Account created", value: formatDateTime(user?.created_at) },
                { label: "Last change", value: user?.updated_at ? formatRelative(user.updated_at) : null }
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Password" subtitle="Change the password for this account" headingLevel={2} />
          <CardBody>
            <ChangePasswordForm />
          </CardBody>
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader
            title="Public configuration"
            subtitle="What the citizen app is told"
            headingLevel={2}
          />
          <CardBody>
            {health.loading && !config ? (
              <ListSkeleton rows={4} />
            ) : (
              <KeyValueList
                items={[
                  { label: "Report categories", value: (config?.report_categories || []).join(", ") || "—" },
                  {
                    label: "Clustering distance",
                    value: config?.clustering ? `${config.clustering.cluster_distance_m} m` : "—"
                  },
                  {
                    label: "Time window",
                    value: config?.clustering ? `${config.clustering.cluster_window_minutes} min` : "—"
                  },
                  {
                    label: "Qualifying reports",
                    value: config?.clustering ? String(config.clustering.min_reports_to_qualify) : "—"
                  },
                  { label: "Field provider", value: config?.subcontractor_name || "—" },
                  { label: "Published precision", value: `${config?.location_precision ?? "—"} decimals` }
                ]}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Where to change what" headingLevel={2} />
          <CardBody className="stack stack--sm">
            <Alert tone="info" title="Keep these together">
              Accounts and dispatch access live under Field agents. The rules that decide when reports become
              an incident live under Detection rules. Zones, announcements and this screen cover the rest.
            </Alert>
            <p className="text-secondary">
              Sessions last until the token expires. Signing out clears the token from this browser only;
              other devices keep their own sessions.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
