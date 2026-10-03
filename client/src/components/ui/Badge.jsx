/**
 * Badges.
 *
 * Severity and status are never communicated by colour alone: both carry their
 * text label, and severity additionally renders a four-step meter so the level
 * is readable in greyscale.
 */

import { severityLevel, severityLabel, severityTone, statusLabel, statusTone } from "../../domain/incidents.js";

export function Badge({ tone = "neutral", icon: Icon, children, solid = false, className }) {
  return (
    <span
      className={["badge", solid ? "badge--solid" : null, className].filter(Boolean).join(" ")}
      data-tone={solid ? undefined : tone}
    >
      {Icon ? <Icon size={12} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function CountPill({ count, label }) {
  const value = Number(count) || 0;
  if (!value) return null;
  return (
    <span className="count-pill" aria-label={label ? `${value} ${label}` : undefined}>
      {value > 99 ? "99+" : value}
    </span>
  );
}

/** The four-segment ramp that repeats the severity level in shape. */
function SeverityMeter({ level }) {
  return (
    <span className="severity-meter" aria-hidden="true">
      {[1, 2, 3, 4].map((step) => (
        <i key={step} data-on={step <= level ? "true" : "false"} />
      ))}
    </span>
  );
}

export function SeverityBadge({ severity, showMeter = true }) {
  if (!severity) return null;
  const level = severityLevel(severity);
  return (
    <span className="badge" data-tone={severityTone(severity)} title={`Severity: ${severityLabel(severity)}`}>
      {severityLabel(severity)}
      {showMeter ? <SeverityMeter level={level} /> : null}
    </span>
  );
}

export function StatusBadge({ status, short = false }) {
  const label = statusLabel(status);
  return (
    <span className="badge" data-tone={statusTone(status)}>
      {short ? label.split(" ")[0] : label}
    </span>
  );
}
