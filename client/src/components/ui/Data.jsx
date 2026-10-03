/**
 * Data display primitives: tables, list rows, pagination, timeline, tabs,
 * guided progress, filter bar, search input and legend.
 */

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { EmptyState } from "./State.jsx";

/* ---- table ------------------------------------------------------------- */

/**
 * A real table on desktop and a stacked card list on phones. Each cell carries
 * `data-label` so the column heading survives the collapse instead of being
 * lost, and both layouts are driven by the same column definitions.
 *
 * columns: [{ key, header, label?, render(row), numeric?, actions? }]
 */
export function DataTable({
  columns,
  rows,
  rowKey = (row) => row.id,
  onRowClick,
  selectedKey,
  caption,
  emptyState
}) {
  if (!rows.length) {
    return emptyState || <EmptyState title="Nothing to show" message="There are no records for this view yet." />;
  }

  return (
    <div className="table-wrap">
      <table className="table">
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric ? "is-numeric" : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                data-selected={String(selectedKey) === String(key) ? "true" : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    data-label={column.label || column.header}
                    className={[column.numeric ? "is-numeric" : null, column.actions ? "is-actions" : null]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---- list row ---------------------------------------------------------- */

export function ListRow({ title, meta, aside, selected = false, as: Tag = "div", ...rest }) {
  return (
    <Tag className="list__row" data-selected={selected ? "true" : undefined} {...rest}>
      <span className="list__main">
        <span className="list__title">{title}</span>
        {meta ? <span className="list__meta">{meta}</span> : null}
      </span>
      {aside ? <span className="list__aside">{aside}</span> : null}
    </Tag>
  );
}

export function List({ children }) {
  return <div className="list">{children}</div>;
}

/* ---- pagination -------------------------------------------------------- */

/** Client-side pagination: these views receive whole collections from the API. */
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);

  const pages = [];
  const start = Math.max(1, current - 2);
  const end = Math.min(pageCount, start + 4);
  for (let index = start; index <= end; index += 1) pages.push(index);

  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        Showing <strong>{from}</strong>–<strong>{to}</strong> of <strong>{total}</strong>
      </span>

      {onPageSizeChange ? (
        <label className="inline-row">
          <span>Rows</span>
          <select
            className="control"
            style={{ width: "auto", minHeight: 34, padding: "0 28px 0 8px" }}
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label="Rows per page"
          >
            {[10, 25, 50].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <span className="pagination__pages">
        <button
          type="button"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        {pages.map((number) => (
          <button
            key={number}
            type="button"
            aria-current={number === current ? "page" : undefined}
            onClick={() => onPageChange(number)}
          >
            {number}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= pageCount}
          aria-label="Next page"
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </span>
    </nav>
  );
}

/* ---- filter bar + search ---------------------------------------------- */

export function FilterBar({ children, summary, actions }) {
  return (
    <div className="filter-bar">
      <div className="filter-bar__grid">{children}</div>
      {summary || actions ? (
        <div className="filter-bar__actions">
          <span>{summary}</span>
          {actions ? <div className="inline-row">{actions}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search", label = "Search" }) {
  return (
    <div className="search">
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        className="control"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          style={{ position: "absolute", right: 4 }}
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/* ---- tabs -------------------------------------------------------------- */

export function Tabs({ tabs, value, onChange, label = "Sections" }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          className="tabs__tab"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count ? <span className="badge">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---- timeline ---------------------------------------------------------- */

/**
 * Vertical incident timeline. Completed, current and upcoming stages differ in
 * both colour and shape, and a stage that has not happened never reads as done.
 */
export function Timeline({ steps, formatAt }) {
  return (
    <ol className="timeline">
      {steps.map((step) => (
        <li key={step.key} className="timeline__step" data-state={step.state}>
          <span className="timeline__dot" aria-hidden="true">
            <span
              style={{
                width: step.state === "current" ? 9 : 6,
                height: step.state === "current" ? 9 : 6,
                borderRadius: "50%",
                background: "currentColor"
              }}
            />
          </span>
          <div className="stack stack--sm">
            <p className="timeline__label">
              {step.label}
              <span className="sr-only">
                {step.state === "current"
                  ? " — current stage"
                  : step.state === "upcoming"
                    ? " — not started"
                    : step.state === "rejected"
                      ? " — rejected"
                      : " — completed"}
              </span>
            </p>
            {step.at ? <p className="timeline__when">{formatAt ? formatAt(step.at) : step.at}</p> : null}
            {step.note ? <p className="text-secondary">{step.note}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---- guided progress -------------------------------------------------- */

export function ProgressSteps({ steps, currentIndex, label = "Progress" }) {
  return (
    <div className="steps" role="group" aria-label={label}>
      {steps.map((step, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
        return (
          <div key={step} className="steps__item" data-state={state}>
            <span className="steps__bar" />
            <span className="steps__text">
              {index + 1}. {step}
              <span className="sr-only"> ({state === "current" ? "current step" : state})</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---- key/value + legend ------------------------------------------------ */

export function KeyValueList({ items, inline = true, className }) {
  const visible = items.filter(
    (item) => item && item.value !== undefined && item.value !== null && item.value !== ""
  );
  if (!visible.length) return null;

  return (
    <dl className={["kv", inline ? "kv--inline" : null, className].filter(Boolean).join(" ")}>
      {visible.map((item) => (
        <div className="kv__row" key={item.key || item.label}>
          <dt className="kv__key">{item.label}</dt>
          <dd className="kv__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Legend({ items }) {
  return (
    <ul className="legend">
      {items.map((item) => (
        <li className="legend__item" key={item.label}>
          <span className="legend__swatch" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}


