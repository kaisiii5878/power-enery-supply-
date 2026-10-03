/**
 * Citizen workspace.
 *
 * Mounted at "/" (public, guests welcome) and at "/client" (signed in). The same
 * components serve both, so there is no second citizen UI to keep in step. The
 * bottom navigation keeps the primary action — reporting — one tap away.
 */

import { useCallback, useState } from "react";
import { Bell, ClipboardList, Home, MapPinned, Send, UserRound, Wrench } from "lucide-react";
import { AppShell } from "../../components/layout/AppShell.jsx";
import { Button } from "../../components/ui/index.js";
import { useApp } from "../../app/AppContext.jsx";
import { ROLES } from "../../lib/session.js";
import { NotificationBell, NotificationsPanel, useNotifications } from "../notifications/Notifications.jsx";
import { HomeTab } from "./HomeTab.jsx";
import { MapTab } from "./MapTab.jsx";
import { ReportFlow, ReportSuccess } from "./ReportFlow.jsx";
import { ReportsTab } from "./ReportsTab.jsx";
import { ProfileTab } from "./ProfileTab.jsx";
import { IncidentDetail } from "./IncidentDetail.jsx";

export function CitizenApp({ requireAuth = false }) {
  const { user, incidents } = useApp();
  const { unread } = useNotifications();
  const [tab, setTab] = useState("home");
  const [view, setView] = useState({ name: "tab" });
  const [receipt, setReceipt] = useState(null);
  const [focusIncidentId, setFocusIncidentId] = useState(null);

  const goTab = useCallback((next) => {
    setReceipt(null);
    setView({ name: "tab" });
    setTab(next);
  }, []);

  const openIncident = useCallback((id) => setView({ name: "incident", id }), []);

  const startReport = useCallback(() => {
    setReceipt(null);
    setView({ name: "tab" });
    setTab("report");
  }, []);

  /** "Track this report" from the confirmation screen. */
  const trackReport = useCallback(() => {
    setReceipt(null);
    setView({ name: "tab" });
    setTab("reports");
  }, []);

  const navItems = [
    { key: "home", label: "Home", icon: Home },
    { key: "map", label: "Map", icon: MapPinned },
    { key: "report", label: "Report", icon: Send },
    { key: "reports", label: "Reports", icon: ClipboardList },
    { key: "profile", label: "Profile", icon: UserRound }
  ];

  const isStaff = user?.role === ROLES.AGENT || user?.role === ROLES.OPERATOR;
  const sidebarItems = [
    ...navItems,
    { key: "notifications", label: "Notifications", icon: Bell, badge: unread, group: "Account" },
    ...(isStaff
      ? [
          {
            key: "workspace",
            label: user?.role === ROLES.OPERATOR ? "Operations console" : "Field agent app",
            icon: Wrench,
            group: "Staff"
          }
        ]
      : [])
  ];

  const active = view.name === "incident" ? null : view.name === "notifications" ? "notifications" : tab;

  function onNavigate(key) {
    if (key === "notifications") {
      setReceipt(null);
      setView({ name: "notifications" });
      return;
    }
    if (key === "workspace") {
      window.location.assign(user?.role === ROLES.OPERATOR ? "/admin" : "/agency");
      return;
    }
    goTab(key);
  }

  function renderContent() {
    if (view.name === "notifications") {
      return (
        <div className="page">
          <NotificationsPanel
            onOpenIncident={(id) => setView({ name: "incident", id })}
            emptyMessage="Restoration checks and updates to your reports will appear here."
          />
        </div>
      );
    }

    if (view.name === "incident") {
      return (
        <IncidentDetail
          incidentId={view.id}
          onBack={() => setView({ name: "tab" })}
          backLabel={tab === "map" ? "Back to map" : "Back to reports"}
        />
      );
    }

    if (tab === "report") {
      if (receipt) {
        return (
          <ReportSuccess
            receipt={receipt}
            onTrack={trackReport}
            onAnother={() => setReceipt(null)}
            onHome={() => goTab("home")}
          />
        );
      }
      return (
        <ReportFlow
          reporterName={user?.name || user?.full_name || ""}
          onCancel={() => goTab("home")}
          onSent={(result) => {
            setReceipt(result);
            setFocusIncidentId(result.incident_id);
          }}
        />
      );
    }

    if (tab === "map") {
      return (
        <MapTab
          onOpenIncident={openIncident}
          focusIncidentId={focusIncidentId}
          onFocusHandled={() => setFocusIncidentId(null)}
        />
      );
    }

    if (tab === "reports") {
      return (
        <ReportsTab
          onOpenIncident={openIncident}
          onReport={startReport}
          onSignIn={() => window.location.assign("/client")}
        />
      );
    }

    if (tab === "profile") {
      return <ProfileTab unread={unread} onOpenNotifications={() => setView({ name: "notifications" })} />;
    }

    return (
      <HomeTab
        onReport={startReport}
        onOpenMap={() => goTab("map")}
        onOpenIncidents={() => goTab("reports")}
        onOpenIncident={openIncident}
        onOpenNotifications={() => setView({ name: "notifications" })}
        unread={unread}
      />
    );
  }

  return (
    <AppShell
      brand={{
        title: "PowerWatch",
        subtitle: requireAuth
          ? `Signed in as ${user?.name || user?.username || "citizen"}`
          : "Cameroon outage reporting"
      }}
      items={sidebarItems}
      active={active}
      onNavigate={onNavigate}
      bottomKeys={["home", "map", "report", "reports", "profile"]}
      contentLabel="Citizen workspace"
      topbarActions={
        <>
          {incidents.length ? (
            <span className="text-caption" style={{ color: "var(--text-chrome-muted)" }}>
              {incidents.length} tracked
            </span>
          ) : null}
          <NotificationBell onOpen={() => setView({ name: "notifications" })} />
          {!user ? (
            <Button size="sm" variant="secondary" onClick={() => window.location.assign("/client")}>
              Sign in
            </Button>
          ) : null}
        </>
      }
    >
      {renderContent()}
    </AppShell>
  );
}
