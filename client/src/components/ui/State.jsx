/**
 * Feedback and state primitives.
 *
 * Every data screen uses these instead of hand-rolled placeholders, so loading,
 * empty and error treatments look the same everywhere and always tell the user
 * what happened and what they can do next.
 */

import { AlertTriangle, Inbox, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "./Button.jsx";

export function Spinner({ className, large = false, ...rest }) {
  return (
    <span
      className={["spinner", large ? "spinner--lg" : null, className].filter(Boolean).join(" ")}
      role="status"
      {...rest}
    >
      <span className="sr-only">Loading</span>
    </span>
  );
}

/** A single shimmer block. Width variants keep skeletons from looking uniform. */
export function Skeleton({ variant = "text", width, className }) {
  return (
    <span
      className={[`skeleton skeleton--${variant}`, width ? `skeleton--${width}` : null, className]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    />
  );
}

/** Skeleton for a grid of KPI cards. */
export function StatSkeleton({ count = 4 }) {
  return (
    <div className="skeleton-stack skeleton-stack--cards" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} variant="card" />
      ))}
    </div>
  );
}

/** Skeleton for a list or table body. */
export function ListSkeleton({ rows = 5 }) {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} variant="line" />
      ))}
    </div>
  );
}

/**
 * Loading state with an announced label. Used where a skeleton would be
 * misleading (for example a whole page or a smallaside panel).
 */
export function LoadingState({ label = "Loading…", compact = false }) {
  return (
    <div className={["state", compact ? "state--compact" : null].filter(Boolean).join(" ")} role="status">
      <Spinner large />
      <p className="state__message">{label}</p>
    </div>
  );
}

/**
 * Empty state. Always explains the situation and offers the next useful step.
 */
export function EmptyState({ icon: Icon = Inbox, title, message, actions, compact = false }) {
  return (
    <div className={["state", compact ? "state--compact" : null].filter(Boolean).join(" ")}>
      <span className="state__icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <p className="state__title">{title}</p>
      {message ? <p className="state__message">{message}</p> : null}
      {actions ? <div className="state__actions">{actions}</div> : null}
    </div>
  );
}

/**
 * Error state. The message comes from ApiError, which never contains a stack
 * trace; `onRetry` gives the user a way out of the failure.
 */
export function ErrorState({
  title = "We could not load this",
  error,
  message,
  onRetry,
  retryLabel = "Try again",
  compact = false
}) {
  const detail = message || error?.message || "Something went wrong while loading this section.";
  const offline = error?.status === 0;
  const Icon = offline ? WifiOff : AlertTriangle;

  return (
    <div
      className={["state", compact ? "state--compact" : null].filter(Boolean).join(" ")}
      data-tone="danger"
      role="alert"
    >
      <span className="state__icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <p className="state__title">{title}</p>
      <p className="state__message">{detail}</p>
      {onRetry ? (
        <div className="state__actions">
          <Button variant="outline" icon={RefreshCw} onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
