/**
 * Operations console.
 *
 * Desktop-first but responsive: a sidebar from 1024px, a four-item bottom bar
 * below that. The sidebar is grouped so an operator can find a section by intent
 * (operations, network, insight) rather than scanning one long list.
 */

import { useCallback, useState } from "react";
import {
  BarChart3,
  ClipboardList,
  History,
  LayoutDashboard,
  Megaphone,
  Radio,
  Settings,
  SlidersHorizontal,
  Table2,
  Users,
  Waypoints
} from "lucide-react";
import { AppShell } from "../../components/layout/AppShell.jsx";
import { Badge, Button } from "../../components/ui/index.js";
import { useApp } from "../../app/AppContext.jsx";
import { ROLE_LABEL, ROLES } from "../../lib/session.js";
import { NotificationBell, NotificationsPanel, useNotifications } from "../notifications/Notifications.jsx";
import { OverviewPanel } from "./OverviewPanel.jsx";
import { MonitorPanel } from "./MonitorPanel.jsx";
import { IncidentsPanel } from "./IncidentsPanel.jsx";
import { ReportsPanel } from "./ReportsPanel.jsx";
import { AgentsPanel } from "./AgentsPanel.jsx";
import { ZonesPanel } from "./ZonesPanel.jsx";
import { AnnouncementsPanel } from "./AnnouncementsPanel.jsx";
import { AnalyticsPanel } from "./AnalyticsPanel.jsx";
import { ClusteringPanel } from "./ClusteringPanel.jsx";
import { AuditPanel } from "./AuditPanel.jsx";
import { SettingsPanel } from "./SettingsPanel.jsx";
import { AdminIncidentDetail } from "./IncidentDetail.jsx";

const SECTIONS = [
  { key: "overview", label: "Overview", shortLabel: "Overview", icon: LayoutDashboard, group: "Operations" },
  { key: "monitor", label: "Live monitoring", shortLabel: "Monitor", icon: Radio, group: "Operations" },
  { key: "incidents", label: "Incidents", icon: Table2, group: "Operations" },
  { key: "reports", label: "Reports", icon: ClipboardList, group: "Operations" },
  { key: "agents", label: "Field agents", icon: Users, group: "Network" },
  { key: "zones", label: "Zones", icon: Waypoints, group: "Network" },
  { key: "announcements", label: "Announcements", icon: Megaphone, group: "Network" },
  { key: "analytics", label: "Analytics", icon: BarChart3, group: "Insight" },
  { key: "clustering", label: "Detection rules", icon: SlidersHorizontal, group: "Insight" },
  { key: "audit", label: "Audit log", icon: History, group: "Insight" },
  { key: "settings", label: "Settings", icon: Settings, group: "Account" }
];

export function AdminApp() {
  const { user, incidents, signOut } = useApp();
  const { unread } = useNotifications();
  const [section, setSection] = useState("overview");
  const [incidentId, setIncidentId] = useState(null);

  const openIncident = useCallback((id) => setIncidentId(id), []);

  const navItems = [
    ...SECTIONS,
    { key: "notifications", label: "Notifications", icon: Radio, badge: unread, group: "Account" }
  ];

  const active = incidentId ? null : section;

  const pendingValidation = incidents.filter((incident) => incident.status === "pending_validation").length;

  function renderContent() {
    if (incidentId) {
      return (
        <div className="page">
          <AdminIncidentDetail incidentId={incidentId} onBack={() => setIncidentId(null)} />
        </div>
      );
    }

    switch (section) {
      case "monitor":
        return <MonitorPanel onNavigate={setSection} />;
      case "incidents":
        return <IncidentsPanel onOpenIncident={openIncident} />;
      case "reports":
        return <ReportsPanel />;
      case "agents":
        return <AgentsPanel />;
      case "zones":
        return <ZonesPanel />;
      case "announcements":
        return <AnnouncementsPanel />;
      case "analytics":
        return <AnalyticsPanel />;
      case "clustering":
        return <ClusteringPanel />;
      case "audit":
        return <AuditPanel />;
      case "settings":
        return <SettingsPanel />;
      case "notifications":
        return (
          <div className="page">
            <NotificationsPanel
              onOpenIncident={openIncident}
              emptyMessage="Validation requests, restoration confirmations and crew updates appear here."
            />
          </div>
        );
      default:
        return <OverviewPanel onOpenIncident={openIncident} onNavigate={setSection} />;
    }
  }

  return (
    <AppShell
      brand={{
        title: "SOCADEL Ops",
        subtitle: `${ROLE_LABEL[ROLES.OPERATOR]} console`
      }}
      items={navItems}
      active={active}
      onNavigate={(key) => {
        setIncidentId(null);
        setSection(key);
      }}
      bottomKeys={["overview", "monitor", "incidents", "settings"]}
      contentLabel="Operations console"
      topbarActions={
        <>
          {pendingValidation ? (
            <Badge tone="warning">{pendingValidation} awaiting validation</Badge>
          ) : null}
          <NotificationBell onOpen={() => setSection("notifications")} />
          <Button
            size="sm"
            variant="ghost"
            onClick={signOut}
            style={{ color: "var(--text-chrome)" }}
            title={`Sign out of ${user?.username || "this console"}`}
          >
            Sign out
          </Button>
        </>
      }
    >
      {renderContent()}
    </AppShell>
  );
}
