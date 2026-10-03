/**
 * Form primitives.
 *
 * Labels are always visible ??? never replaced by a placeholder. Errors are tied
 * to the control through aria-describedby and aria-invalid, so screen readers
 * announce the problem as well as sighted users seeing it.
 */

import { forwardRef, useId } from "react";
import { AlertCircle } from "lucide-react";

/** Shared wrapper: label, hint, error and the accessibility wiring. */
export function Field({ id, label, hint, error, required = false, children, className }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={["field", className].filter(Boolean).join(" ")}>
      {label ? (
        <label className="field__label" htmlFor={id}>
          {label}
          {required ? (
            <span className="field__required" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}

      {typeof children === "function" ? children({ id, describedBy, invalid: Boolean(error) }) : children}

      {hint && !error ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}

      {error ? (
        <p className="field__error" id={errorId}>
          <AlertCircle size={14} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Internal helper: derives ids and passes the a11y attributes down. */
function useFieldIds(idProp) {
  const generated = useId();
  // React's generated ids contain characters that are awkward in CSS selectors and
  // in `aria-describedby` lists, so only safe id characters are kept.
  const id = idProp || `field-${String(generated).replace(/[^A-Za-z0-9_-]/g, "")}`;
  return { id };
}

export const TextInput = forwardRef(function TextInput(
  { label, hint, error, required, id: idProp, className, ...rest },
  ref
) {
  const { id } = useFieldIds(idProp);
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <input
        ref={ref}
        id={id}
        className="control"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        required={required}
        {...rest}
      />
    </Field>
  );
});

export const Select = forwardRef(function Select(
  { label, hint, error, required, id: idProp, className, children, ...rest },
  ref
) {
  const { id } = useFieldIds(idProp);
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <select
        ref={ref}
        id={id}
        className="control"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        required={required}
        {...rest}
      >
        {children}
      </select>
    </Field>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, hint, error, required, id: idProp, className, rows = 4, ...rest },
  ref
) {
  const { id } = useFieldIds(idProp);
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        className="control"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        required={required}
        {...rest}
      />
    </Field>
  );
});

export const Checkbox = forwardRef(function Checkbox({ label, id: idProp, className, ...rest }, ref) {
  const { id } = useFieldIds(idProp);
  return (
    <label className={["checkbox", className].filter(Boolean).join(" ")} htmlFor={id}>
      <input ref={ref} id={id} type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
});

/** Groups related fields with a caption and consistent spacing. */
export function FieldGroup({ legend, description, children, className }) {
  return (
    <fieldset
      className={["stack", className].filter(Boolean).join(" ")}
      style={{ margin: 0, padding: 0, border: 0 }}
    >
      {legend ? (
        <legend className="section-title" style={{ padding: 0 }}>
          {legend}
        </legend>
      ) : null}
      {description ? <p className="text-secondary">{description}</p> : null}
      {children}
    </fieldset>
  );
}
