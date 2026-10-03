/**
 * Feedback primitives: inline alerts and the toast system.
 *
 * Toasts are for confirmations of an action the user just took. Anything the
 * user must read before continuing belongs in an Alert or a proper screen.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useBodyScrollLock, useEscapeKey } from "../../lib/hooks.js";
import { Button } from "./Button.jsx";

const ALERT_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle
};

export function Alert({ tone = "neutral", title, children, actions, icon }) {
  const Icon = icon === null ? null : icon || ALERT_ICONS[tone] || Info;
  return (
    <div className="alert" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      {Icon ? <Icon size={18} aria-hidden="true" /> : null}
      <div className="alert__body">
        {title ? <p className="alert__title">{title}</p> : null}
        {children ? <div className="alert__text">{children}</div> : null}
        {actions ? <div className="inline-row">{actions}</div> : null}
      </div>
    </div>
  );
}

/* ---- toasts ------------------------------------------------------------ */

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone: "info", ...toast }]);
      if (toast.durationMs !== 0) {
        setTimeout(() => dismiss(id), toast.durationMs || 4500);
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      toast: push,
      success: (title, text) => push({ tone: "success", title, text }),
      error: (title, text) => push({ tone: "danger", title, text, durationMs: 7000 }),
      info: (title, text) => push({ tone: "info", title, text }),
      dismiss
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" data-tone={toast.tone}>
            <div className="alert__body">
              <p className="toast__title">{toast.title}</p>
              {toast.text ? <p className="toast__text">{toast.text}</p> : null}
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Falls back to a no-op so a component never crashes outside the provider. */
export function useToast() {
  const context = useContext(ToastContext);
  const noop = useCallback(() => {}, []);
  return (
    context || { toast: noop, success: noop, error: noop, info: noop, dismiss: noop }
  );
}

/* ---- modal, drawer and confirmation ------------------------------------ */

/**
 * Accessible modal: focus moves into the dialog, Escape closes it, the page
 * behind cannot scroll, and the panel is announced as a dialog.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeLabel = "Close"
}) {
  const panel = useRef(null);
  useBodyScrollLock(open);
  useEscapeKey(onClose, open);

  useEffect(() => {
    if (!open || !panel.current) return;
    const focusable = panel.current.querySelector(
      "input, select, textarea, button, [href], [tabindex]:not([tabindex='-1'])"
    );
    focusable?.focus();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panel}
        className={`modal${size === "wide" ? " modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal__header">
          <div className="stack stack--sm">
            <h2 className="section-title">{title}</h2>
            {description ? <p className="text-secondary">{description}</p> : null}
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        <div className="modal__body scroll-area">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

/**
 * Destructive actions route through this dialog instead of `window.confirm`,
 * so wording, tone and the recovery path are part of the design.
 */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  children
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} busy={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        {message ? <Alert tone={tone === "danger" ? "warning" : tone}>{message}</Alert> : null}
        {children}
      </div>
    </Modal>
  );
}

/** Right-hand drawer used for incident detail on the monitoring screens. */
export function Drawer({ open, onClose, title, description, children, footer, width = "520px" }) {
  useBodyScrollLock(open);
  useEscapeKey(onClose, open);

  if (!open) return null;

  return createPortal(
    <div
      className="drawer-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="drawer" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__header">
          <div className="stack stack--sm">
            <h2 className="section-title">{title}</h2>
            {description ? <p className="text-secondary">{description}</p> : null}
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal__body scroll-area">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </aside>
    </div>,
    document.body
  );
}
