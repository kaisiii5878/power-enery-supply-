/**
 * Chart primitives.
 *
 * Hand-rolled SVG instead of a charting library: two visualisations are enough
 * for this console, and neither is worth another dependency. Both accept the
 * real API series and render an empty state when there is nothing to plot.
 */

import { EmptyState } from "../../components/ui/index.js";

/** Single-series column chart. Answers "how much arrived each day". */
export function BarChart({ data, valueKey, labelKey = "date", height = 150, formatLabel, unit = "" }) {
  const rows = (data || []).filter((row) => Number.isFinite(Number(row[valueKey])));
  if (!rows.length) {
    return <EmptyState compact title="No data in this window" message="Nothing was recorded for these dates." />;
  }

  const max = Math.max(1, ...rows.map((row) => Number(row[valueKey])));
  const barWidth = 100 / rows.length;
  const showEvery = rows.length > 14 ? Math.ceil(rows.length / 7) : 1;

  return (
    <div className="stack stack--sm">
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
          height,
          padding: "var(--space-2) 0",
          borderBottom: "1px solid var(--border)"
        }}
        role="img"
        aria-label={`Column chart of ${valueKey} over ${rows.length} periods. Maximum ${max}${unit ? ` ${unit}` : ""}.`}
      >
        {rows.map((row) => {
          const value = Number(row[valueKey]);
          return (
            <div
              key={row[labelKey]}
              title={`${formatLabel ? formatLabel(row[labelKey]) : row[labelKey]}: ${value}${unit ? ` ${unit}` : ""}`}
              style={{
                flex: `0 0 ${barWidth}%`,
                height: `${Math.max(2, (value / max) * 100)}%`,
                background: value ? "var(--brand-600)" : "var(--neutral-200)",
                borderRadius: "3px 3px 0 0"
              }}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 2 }} aria-hidden="true">
        {rows.map((row, index) => (
          <span
            key={row[labelKey]}
            style={{ flex: `0 0 ${barWidth}%`, fontSize: "0.625rem", color: "var(--text-subtle)" }}
          >
            {index % showEvery === 0 ? (formatLabel ? formatLabel(row[labelKey]) : row[labelKey]) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal breakdown bar list. Answers "how is the fleet distributed". */
export function BreakdownList({ items, total, unit = "" }) {
  const sum = total ?? items.reduce((carry, item) => carry + Number(item.value || 0), 0);

  if (!items.length || !sum) {
    return <EmptyState compact title="Nothing recorded yet" message="Figures appear once there are records." />;
  }

  return (
    <ul className="stack stack--sm">
      {items.map((item) => {
        const value = Number(item.value || 0);
        const share = sum ? Math.round((value / sum) * 100) : 0;
        return (
          <li key={item.label} className="stack stack--sm">
            <div className="split">
              <span className="text-label">{item.label}</span>
              <span className="text-caption">
                {value}
                {unit ? ` ${unit}` : ""} · {share}%
              </span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: "var(--radius-full)",
                background: "var(--neutral-200)",
                overflow: "hidden"
              }}
              role="img"
              aria-label={`${item.label}: ${value}${unit ? ` ${unit}` : ""}, ${share}% of the total`}
            >
              <div
                style={{
                  width: `${share}%`,
                  height: "100%",
                  background: item.color || "var(--brand-600)"
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
