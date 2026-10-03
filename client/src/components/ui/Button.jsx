/**
 * Button primitives.
 *
 * One component covers every treatment in the design system, so a screen can
 * never invent its own colours. `busy` disables the button and swaps the label
 * for a spinner, which is how all async actions report progress.
 */

import { forwardRef } from "react";
import { Spinner } from "./State.jsx";

const VARIANTS = ["primary", "secondary", "outline", "ghost", "danger", "danger-ghost"];
const SIZES = ["sm", "md", "lg"];

function classes({ variant, size, block, iconOnly, className }) {
  return [
    "btn",
    `btn--${VARIANTS.includes(variant) ? variant : "outline"}`,
    size && size !== "md" ? `btn--${SIZES.includes(size) ? size : "md"}` : null,
    block ? "btn--block" : null,
    iconOnly ? "btn--icon" : null,
    className
  ]
    .filter(Boolean)
    .join(" ");
}

export const Button = forwardRef(function Button(
  {
    variant = "outline",
    size = "md",
    block = false,
    busy = false,
    disabled = false,
    icon: Icon,
    iconAfter: IconAfter,
    children,
    className,
    type = "button",
    ...rest
  },
  ref
) {
  const isDisabled = disabled || busy;
  return (
    <button
      ref={ref}
      type={type}
      className={classes({ variant, size, block, className })}
      disabled={isDisabled}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Spinner aria-hidden="true" /> : Icon ? <Icon size={16} aria-hidden="true" /> : null}
      {children}
      {IconAfter && !busy ? <IconAfter size={16} aria-hidden="true" /> : null}
    </button>
  );
});

/**
 * Icon-only button. `label` is required: it becomes the accessible name and the
 * tooltip, so an icon never stands on its own without a meaning.
 */
export const IconButton = forwardRef(function IconButton(
  { label, icon: Icon, size = "md", variant = "ghost", busy = false, className, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      aria-busy={busy || undefined}
      className={classes({ variant, size, iconOnly: true, className })}
      {...rest}
    >
      {busy ? <Spinner aria-hidden="true" /> : <Icon size={18} aria-hidden="true" />}
    </button>
  );
});

/** A group of buttons that keeps a consistent gap on any screen width. */
export function ButtonGroup({ children, className }) {
  return <div className={["inline-row", className].filter(Boolean).join(" ")}>{children}</div>;
}
