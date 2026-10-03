/**
 * Surfaces and headings.
 *
 * Cards are used to group related information, not to wrap every value. A
 * single item of information belongs in a key/value list, not its own card.
 */

export function Card({ as: Tag = "section", interactive = false, padded = false, className, children, ...rest }) {
  return (
    <Tag
      className={[
        "card",
        padded ? "card--pad" : null,
        interactive ? "card--interactive" : null,
        className
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, actions, headingLevel = 2, plain = false }) {
  const Heading = `h${headingLevel}`;
  return (
    <div className={["card__header", plain ? "card__header--plain" : null].filter(Boolean).join(" ")}>
      <div className="stack stack--sm">
        <Heading className="card__title">{title}</Heading>
        {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="inline-row">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={["card__body", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function CardFooter({ className, children }) {
  return <div className={["card__footer", className].filter(Boolean).join(" ")}>{children}</div>;
}

/**
 * Page header: title, optional supporting line and the page's primary actions.
 * `breadcrumb` renders a real back link so users can always leave a detail view.
 */
export function PageHeader({ title, subtitle, breadcrumb, actions, children }) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {breadcrumb}
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="text-secondary">{subtitle}</p> : null}
        {children}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({ title, subtitle, actions, headingLevel = 2 }) {
  const Heading = `h${headingLevel}`;
  return (
    <div className="section-header">
      <div className="stack stack--sm">
        <Heading className="section-title">{title}</Heading>
        {subtitle ? <p className="text-secondary">{subtitle}</p> : null}
      </div>
      {actions ? <div className="inline-row">{actions}</div> : null}
    </div>
  );
}

/** Back link used at the top of every detail screen. */
export function Breadcrumb({ onBack, label = "Back" }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <button type="button" onClick={onBack}>
        ← {label}
      </button>
    </nav>
  );
}

/**
 * KPI tile. Pass `onClick` to make it a navigation affordance, in which case it
 * renders as a real button so keyboard users can reach it.
 */
export function StatCard({ icon: Icon, label, value, unit, tone = "brand", onClick, hint }) {
  const content = (
    <>
      {Icon ? (
        <span className="stat__icon" data-tone={tone} aria-hidden="true">
          <Icon size={19} />
        </span>
      ) : null}
      <span className="stat__label">{label}</span>
      <span className="stat__value">
        {value}
        {unit ? <span className="stat__unit">{unit}</span> : null}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="stat stat--interactive" onClick={onClick} title={hint || undefined}>
        {content}
      </button>
    );
  }

  return <div className="stat" title={hint || undefined}>{content}</div>;
}

export function StatGrid({ children, className }) {
  return <div className={["stat-grid", className].filter(Boolean).join(" ")}>{children}</div>;
}

/** Simple two-column page body for content plus a supporting aside. */
export function Section({ title, description, actions, children, className }) {
  return (
    <section className={["stack", className].filter(Boolean).join(" ")}>
      {title ? <SectionHeader title={title} subtitle={description} actions={actions} /> : null}
      {children}
    </section>
  );
}
