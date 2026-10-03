/**
 * Sign-in and registration.
 *
 * The role is part of the URL (/client, /agency, /admin), so the screen always
 * states which workspace it is signing into and lets the user switch to another
 * one instead of guessing. Public sign-up only ever creates citizen accounts —
 * that rule lives on the server, and the UI reflects it.
 */

import { useState } from "react";
import { BadgeCheck, LogIn, ShieldCheck, UserPlus, Wrench } from "lucide-react";
import { ROLES, ROLE_LABEL } from "../../lib/session.js";
import { Alert, Button, Card, TextInput } from "../../components/ui/index.js";
import {
  MIN_PASSWORD_LENGTH,
  REGISTER,
  ROLE_HOME,
  ROLE_INTRO,
  SIGN_IN,
  canSelfRegister,
  headingFor,
  submitCredentials,
  toggleMode,
  validateCredentials
} from "./authForm.js";

const ROLE_ICON = {
  [ROLES.CITIZEN]: BadgeCheck,
  [ROLES.AGENT]: Wrench,
  [ROLES.OPERATOR]: ShieldCheck
};

/**
 * @param initialMode SIGN_IN or REGISTER. Exposed so a deep link can open the
 *                    registration form directly, and so tests can render it.
 */
export function SignInPage({ role = ROLES.OPERATOR, notice = "", onSignedIn, initialMode = SIGN_IN }) {
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const canRegister = canSelfRegister(role);
  const RoleIcon = ROLE_ICON[role] || BadgeCheck;
  const draft = { mode, role, username, password, fullName, phone };

  /** Clearing a message as soon as the field is edited stops the form nagging. */
  function edit(field, value) {
    if (field === "username") setUsername(value);
    else if (field === "password") setPassword(value);
    else if (field === "fullName") setFullName(value);
    else if (field === "phone") setPhone(value);

    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function submit(event) {
    event.preventDefault();

    const problems = validateCredentials(draft);
    setFieldErrors(problems);
    setError("");
    if (Object.keys(problems).length) return;

    setBusy(true);
    try {
      onSignedIn(await submitCredentials(draft));
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  function switchRole(nextRole) {
    if (nextRole === role) return;
    window.location.assign(ROLE_HOME[nextRole]);
  }

  return (
    <main className="auth">
      <Card className="auth__card">
        <div className="auth__brand">
          <span className="auth__brand-mark" aria-hidden="true">
            <BadgeCheck size={22} />
          </span>
          <span className="auth__brand-text">
            <strong>PowerWatch Cameroon</strong>
            <span>SOCADEL outage intelligence</span>
          </span>
        </div>

        <div className="auth__panel-switch">
          <div className="tabs" role="tablist" aria-label="Workspace">
            {[ROLES.CITIZEN, ROLES.AGENT, ROLES.OPERATOR].map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                className="tabs__tab"
                aria-selected={value === role}
                onClick={() => switchRole(value)}
              >
                {ROLE_LABEL[value]}
              </button>
            ))}
          </div>
        </div>

        <div className="auth__heading">
          <p className="eyebrow">{ROLE_LABEL[role]} workspace</p>
          <h1 className="page-title">{headingFor(mode, ROLE_LABEL[role])}</h1>
          <p className="text-secondary">{ROLE_INTRO[role]}</p>
        </div>

        {notice ? (
          <Alert tone="info" title="Session ended">
            {notice}
          </Alert>
        ) : null}

        <form className="auth__form" onSubmit={submit} noValidate>
          {mode === REGISTER ? (
            <>
              <TextInput
                label="Full name"
                name="name"
                autoComplete="name"
                value={fullName}
                onChange={(event) => edit("fullName", event.target.value)}
                error={fieldErrors.fullName}
                required
                maxLength={120}
                placeholder="e.g. Aida Ngombe"
              />
              <TextInput
                label="Phone number"
                hint="Optional. Helps the crew reach you about a visit."
                name="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => edit("phone", event.target.value)}
                maxLength={40}
                placeholder="+237 6 00 00 00 00"
              />
            </>
          ) : null}
          <TextInput
            label="Username"
            hint={
              mode === REGISTER
                ? "3–40 characters: lowercase letters, numbers, dot, dash or underscore."
                : undefined
            }
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => edit("username", event.target.value)}
            error={fieldErrors.username}
            required
            minLength={3}
            maxLength={40}
            placeholder="e.g. aida.ngombe"
          />

          <TextInput
            label="Password"
            hint={mode === REGISTER ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
            name="password"
            type="password"
            autoComplete={mode === REGISTER ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => edit("password", event.target.value)}
            error={fieldErrors.password}
            required
            minLength={mode === REGISTER ? MIN_PASSWORD_LENGTH : 1}
            maxLength={128}
          />

          {error ? (
            <Alert tone="danger" title={mode === REGISTER ? "We could not create the account" : "We could not sign you in"}>
              {error}
            </Alert>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            block
            size="lg"
            busy={busy}
            icon={mode === REGISTER ? UserPlus : LogIn}
          >
            {mode === REGISTER ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="auth__footer">
          {canRegister ? (
            <p>
              {mode === REGISTER ? "Already have an account?" : "New to PowerWatch?"}{" "}
              <button
                type="button"
                className="auth__switch"
                onClick={() => {
                  setMode(toggleMode(mode));
                  setError("");
                  setFieldErrors({});
                }}
              >
                {mode === REGISTER ? "Sign in instead" : "Create a citizen account"}
              </button>
            </p>
          ) : (
            <p>
              Staff accounts are created by a SOCADEL administrator. If you cannot sign in, contact the
              operations desk.
            </p>
          )}
          <p>
            Not your workspace?{" "}
            <button type="button" className="auth__switch" onClick={() => window.location.assign("/client")}>
              Citizen
            </button>{" "}
            ·{" "}
            <button type="button" className="auth__switch" onClick={() => window.location.assign("/agency")}>
              Field agent
            </button>{" "}
            ·{" "}
            <button type="button" className="auth__switch" onClick={() => window.location.assign("/")}>
              Public map
            </button>
          </p>
        </div>
      </Card>
    </main>
  );
}
