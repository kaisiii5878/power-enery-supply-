/**
 * Citizen profile.
 *
 * A guest sees one clear invitation to create an account. A signed-in citizen
 * sees who they are, can change their password, and can reach the staff
 * workspaces if they have one.
 */

import { useState } from "react";
import { KeyRound, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { authApi } from "../../lib/api.js";
import { useApp } from "../../app/AppContext.jsx";
import { useToast } from "../../components/ui/index.js";
import { initials } from "../../lib/format.js";
import { ROLES, ROLE_LABEL } from "../../lib/session.js";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  KeyValueList,
  PageHeader,
  TextInput
} from "../../components/ui/index.js";

function ChangePassword() {
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
        hint="At least 8 characters."
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
        <Button type="submit" variant="outline" icon={KeyRound} busy={busy}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export function ProfileTab({ onOpenNotifications, unread }) {
  const { user, signOut } = useApp();
  const role = user?.role || user?.user_role || null;

  if (!user) {
    return (
      <div className="page">
        <PageHeader title="Profile" subtitle="You are using PowerWatch as a guest." />
        <Card>
          <CardBody className="stack">
            <Alert tone="info" title="Create a free citizen account">
              Signing in keeps your reports together, notifies you when a crew is assigned, and lets you
              confirm when your power is back. You can keep reporting anonymously without an account.
            </Alert>
            <div className="inline-row">
              <Button variant="primary" icon={LogIn} onClick={() => window.location.assign("/client")}>
                Sign in or register
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Profile"
        subtitle="Your PowerWatch account."
        actions={
          <Button variant="outline" icon={LogOut} onClick={signOut}>
            Sign out
          </Button>
        }
      />

      <Card>
        <CardBody className="stack">
          <div className="inline-row">
            <span className="state__icon" data-tone="info" aria-hidden="true">
              <strong>{initials(user.name || user.full_name)}</strong>
            </span>
            <div className="stack stack--sm">
              <span className="section-title">{user.name || user.full_name}</span>
              <span className="text-secondary">
                @{user.username} · {ROLE_LABEL[role] || role}
              </span>
            </div>
          </div>
          <KeyValueList
            items={[
              { label: "Username", value: user.username },
              { label: "Role", value: ROLE_LABEL[role] || role },
              { label: "Phone", value: user.phone },
              { label: "Email", value: user.email },
              { label: "Notifications", value: unread ? `${unread} unread` : "All read" }
            ]}
          />
          {onOpenNotifications ? (
            <div>
              <Button variant="outline" onClick={onOpenNotifications}>
                Open notifications
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Security" subtitle="Change the password for this account" headingLevel={2} />
        <CardBody>
          <ChangePassword />
        </CardBody>
      </Card>

      {role !== ROLES.CITIZEN ? (
        <Card>
          <CardHeader title="Staff workspaces" headingLevel={2} />
          <CardBody className="stack stack--sm">
            <p className="text-secondary">
              This account also has staff access. Open the workspace for your role.
            </p>
            <div className="inline-row">
              <Button
                variant="outline"
                icon={ShieldCheck}
                onClick={() => window.location.assign(role === ROLES.OPERATOR ? "/admin" : "/agency")}
              >
                {role === ROLES.OPERATOR ? "Operations console" : "Field agent app"}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
