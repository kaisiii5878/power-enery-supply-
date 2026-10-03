/**
 * Application shell.
 *
 * One shell serves all three roles. On phones it is a sticky top bar plus a
 * fixed bottom navigation with the most important destinations; from 1024px it
 * becomes a persistent sidebar with the full section list. The same item
 * definition drives both, so a destination can never exist in one and not the
 * other.
 */

import { useState } from "react";
import { BadgeCheck, PanelLeftClose, PanelLeftOpen, Zap } from "lucide-react";
import { CountPill } from "../ui/Badge.jsx";

/**
 * @param brand       { title, subtitle }
 * @param items       [{ key, label, icon, badge, group }]
 * @param active      currently selected key
 * @param onNavigate  (key) => void
 * @param bottomKeys  keys shown in the mobile bottom bar (max 5)
 * @param topbarActions  element rendered next to the brand
 */
export function AppShell({
  brand,
  items,
  active,
  onNavigate,
  bottomKeys,
  topbarActions,
  children,
  contentLabel = "Main content"
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const bottomItems = bottomKeys
    .map((key) => items.find((item) => item.key === key))
    .filter(Boolean);

  const groups = [];
  for (const item of items) {
    const group = item.group || "";
    const existing = groups.find((entry) => entry.label === group);
    if (existing) existing.items.push(item);
    else groups.push({ label: group, items: [item] });
  }

  return (
    <div className={`shell ${sidebarCollapsed ? "shell--sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="shell__topbar">
        <div className="shell__brand">
          <span className="shell__brand-mark" aria-hidden="true">
            <BadgeCheck size={20} />
          </span>
          <span className="shell__brand-text">
            <strong>{brand.title}</strong>
            <span>{brand.subtitle}</span>
          </span>
        </div>

        <div className="shell__topbar-actions">
          <button
            type="button"
            className="shell__collapse-toggle"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          {topbarActions}
        </div>
      </header>

      <div className="shell__body">
        <nav className="shell__sidebar scroll-area" aria-label={`${brand.title} sections`}>
          {groups.map((group) => (
            <div key={group.label || "main"}>
              {group.label ? <p className="sidebar-group__label">{group.label}</p> : null}
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="sidebar-link"
                    aria-current={item.key === active ? "page" : undefined}
                    onClick={() => onNavigate(item.key)}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    {Icon ? <Icon size={17} aria-hidden="true" /> : null}
                    <span>{item.label}</span>
                    {item.badge ? <CountPill count={item.badge} label={`${item.label} notifications`} /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <main className="shell__content" id="main-content" aria-label={contentLabel}>
          {children}
        </main>
      </div>

      {bottomItems.length ? (
        <nav
          className="shell__footer-nav"
          aria-label="Main sections"
          style={{ gridTemplateColumns: `repeat(${bottomItems.length}, minmax(0, 1fr))` }}
        >
          {bottomItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                aria-current={item.key === active ? "page" : undefined}
                onClick={() => onNavigate(item.key)}
              >
                {Icon ? <Icon size={19} aria-hidden="true" /> : null}
                <span>{item.shortLabel || item.label}</span>
              </button>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
