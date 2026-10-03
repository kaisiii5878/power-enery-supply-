/**
 * Application root.
 *
 * Decides which workspace the current URL belongs to and renders it behind the
 * role guard. The path decides the required role — /admin needs an operator,
 * /agency a field crew, /client a citizen account — and "/" is the public citizen
 * experience that anyone can use without signing in.
 */

import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppProvider, useApp } from "./app/AppContext.jsx";
import { ToastProvider } from "./components/ui/index.js";
import { ROLES, roleForPath } from "./lib/session.js";
import { SignInPage } from "./features/auth/SignInPage.jsx";
import { CitizenApp } from "./features/citizen/CitizenApp.jsx";
import { AgentApp } from "./features/agency/AgentApp.jsx";
import { AdminApp } from "./features/admin/AdminApp.jsx";

/** Full-screen loading treatment used only while the session is resolved. */
function BootScreen() {
  return (
    <div className="auth">
      <div className="card card--pad stack stack--sm" style={{ width: "min(420px, 100%)" }}>
        <span className="spinner spinner--lg" role="status" />
        <p className="state__title">Starting PowerWatch</p>
        <p className="text-secondary">Loading the network feed…</p>
      </div>
    </div>
  );
}

function Workspaces() {
  const location = useLocation();
  const { user, signIn, authNotice, feedLoading, feedError } = useApp();
  const required = roleForPath(location.pathname);
  const role = user?.role || user?.user_role || null;

  // A route that needs a role the account does not hold goes to sign-in, with the
  // role named on screen so the user is never guessing which workspace they hit.
  if (required && role !== required) {
    return <SignInPage role={required} notice={authNotice} onSignedIn={signIn} />;
  }

  // The very first paint waits for the public feed so no screen flashes empty.
  if (feedLoading && !user && required === null && !feedError) {
    return <BootScreen />;
  }

  return (
    <Routes>
      <Route path="/" element={<CitizenApp requireAuth={false} />} />
      <Route path="/client/*" element={<CitizenApp requireAuth />} />
      <Route path="/agency/*" element={<AgentApp />} />
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <Workspaces />
      </AppProvider>
    </ToastProvider>
  );
}
