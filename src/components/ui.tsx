import type React from "react";

/**
 * Presentational primitives shared by every consultant-facing surface.
 *
 * Deliberately presentational only: no data access, no server actions, no "use client". Pages keep
 * owning their own text — these components never invent, reword or hide a label, because the copy
 * in this product is methodology (rubrics, refusal reasons, attestation wording) rather than
 * decoration, and several strings are asserted verbatim by the browser suites.
 *
 * The severity and tier vocabularies live here so the audit page, the settings page and anything
 * else rendering a rating cannot drift apart. The report renderer (src/lib/reports/renderHtml.ts)
 * deliberately does NOT import from here — it is inlined into a standalone HTML document for
 * headless Chromium with no Tailwind runtime — but it mirrors the same values on purpose.
 */

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------------------------------------
 * Severity
 * ---------------------------------------------------------------------------------------------- */

export type SeverityKey = "RED" | "YELLOW" | "GREEN" | null | undefined;

/**
 * Shape is the carrier, colour is the reinforcement. A buyer's advisory team may read this printed
 * in greyscale or with a colour vision deficiency, so every severity is announced by a glyph that
 * differs in outline as well as a hue that differs in luminance.
 */
export const SEVERITY_GLYPH: Record<"RED" | "YELLOW" | "GREEN" | "NONE", string> = {
  RED: "▲",
  YELLOW: "◆",
  GREEN: "●",
  NONE: "○",
};

const SEVERITY_SURFACE: Record<"RED" | "YELLOW" | "GREEN" | "NONE", string> = {
  RED: "sev-red",
  YELLOW: "sev-amber",
  GREEN: "sev-green",
  NONE: "sev-none",
};

function severityKey(severity: SeverityKey): "RED" | "YELLOW" | "GREEN" | "NONE" {
  return severity === "RED" || severity === "YELLOW" || severity === "GREEN" ? severity : "NONE";
}

/**
 * A rating chip. `label` is supplied by the caller rather than derived, because the wording differs
 * by surface in ways that matter ("Not yet rated" on a tier heading vs. "No rating" in a select)
 * and is asserted by tests.
 */
export function SeverityBadge({
  severity,
  label,
  size = "md",
  className,
}: {
  severity: SeverityKey;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const key = severityKey(severity);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        SEVERITY_SURFACE[key],
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        className,
      )}
    >
      <span aria-hidden="true" className="text-[0.85em] leading-none">
        {SEVERITY_GLYPH[key]}
      </span>
      {label}
    </span>
  );
}

/** The bare dot used where a row needs a rating marker but has no room for a chip. */
export function SeverityDot({ severity, title }: { severity: SeverityKey; title?: string }) {
  const key = severityKey(severity);
  const tone =
    key === "RED"
      ? "text-sev-red"
      : key === "YELLOW"
        ? "text-sev-amber"
        : key === "GREEN"
          ? "text-sev-green"
          : "text-sev-none";
  return (
    <span className={cn("text-sm leading-none", tone)} title={title}>
      <span aria-hidden="true">{SEVERITY_GLYPH[key]}</span>
      {title ? <span className="sr-only">{title}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Tier
 * ---------------------------------------------------------------------------------------------- */

/**
 * Tiers are colour-coded by WHO HAS TO ACT, which is the consultant's first question when they open
 * an audit mid-deal: Tier A needs nobody, Tier B is blocked on seller documents, Tier C is blocked
 * on a scheduled live session. See spec.md §4.
 */
export const TIER_META: Record<"A" | "B" | "C", { rail: string; chip: string; blocker: string }> = {
  A: {
    rail: "bg-tier-a",
    chip: "bg-tier-a-bg text-tier-a",
    blocker: "Runnable now",
  },
  B: {
    rail: "bg-tier-b",
    chip: "bg-tier-b-bg text-tier-b",
    blocker: "Needs seller documents",
  },
  C: {
    rail: "bg-tier-c",
    chip: "bg-tier-c-bg text-tier-c",
    blocker: "Needs live access",
  },
};

export function TierChip({ tier, children }: { tier: "A" | "B" | "C"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase",
        TIER_META[tier].chip,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Layout
 * ---------------------------------------------------------------------------------------------- */

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumb ? <div className="mb-2 text-sm text-ink-500">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
          {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  return (
    <Tag
      className={cn(
        "rounded-lg border border-ink-200 bg-white shadow-xs",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-4 py-4", className)}>{children}</div>;
}

/* ------------------------------------------------------------------------------------------------
 * Controls
 * ---------------------------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-950 shadow-xs",
  secondary: "bg-white text-ink-800 border border-ink-300 hover:bg-ink-50 active:bg-ink-100 shadow-xs",
  ghost: "bg-transparent text-ink-600 hover:bg-ink-100 hover:text-ink-900",
  danger: "bg-white text-sev-red border border-sev-red-border hover:bg-sev-red-bg",
};

export const buttonClass = (
  variant: ButtonVariant = "primary",
  size: "sm" | "md" = "md",
  className?: string,
) =>
  cn(
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
    BUTTON_VARIANT[variant],
    className,
  );

/**
 * ALWAYS pass an explicit `type`. HTML treats a typeless button inside a form as a submit button,
 * so the markup still works — but the browser suites locate controls with `button[type="submit"]`,
 * and an attribute that is merely implied does not match a CSS attribute selector. A submit control
 * that silently stops being findable is a test failure that looks like a product bug.
 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export const inputClass = (className?: string) =>
  cn(
    "block w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900",
    "placeholder:text-ink-400",
    "hover:border-ink-400 focus:border-accent-500 focus:outline-none",
    "disabled:bg-ink-50 disabled:text-ink-500",
    className,
  );

export const selectClass = (className?: string) =>
  cn(
    "block w-full appearance-none rounded-md border border-ink-300 bg-white px-3 py-2 pr-8 text-sm text-ink-900",
    "hover:border-ink-400 focus:border-accent-500 focus:outline-none",
    // Chevron drawn in CSS so the control needs no icon component and stays server-renderable.
    "bg-[length:16px] bg-[right_0.5rem_center] bg-no-repeat",
    "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke=%22%236b7589%22 stroke-width=%222%22%3E%3Cpath stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22M6 9l6 6 6-6%22/%3E%3C/svg%3E')]",
    className,
  );

export function Label({
  children,
  htmlFor,
  className,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("block text-xs font-medium text-ink-700", className)}>
      {children}
    </label>
  );
}

/** Label + control + optional hint, with the hint sitting under the control where it is read. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {label ? (
        <Label htmlFor={htmlFor} className="mb-1">
          {label}
        </Label>
      ) : null}
      {children}
      {hint ? <p className="mt-1 text-xs leading-relaxed text-ink-500">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Feedback
 * ---------------------------------------------------------------------------------------------- */

type CalloutTone = "info" | "warning" | "error" | "success" | "neutral";

const CALLOUT_TONE: Record<CalloutTone, string> = {
  info: "border-accent-200 bg-accent-50 text-accent-900",
  warning: "border-sev-amber-border bg-sev-amber-bg text-sev-amber",
  error: "border-sev-red-border bg-sev-red-bg text-sev-red",
  success: "border-sev-green-border bg-sev-green-bg text-sev-green",
  neutral: "border-ink-200 bg-ink-50 text-ink-700",
};

export function Callout({
  tone = "neutral",
  children,
  className,
}: {
  tone?: CalloutTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3.5 py-3 text-sm leading-relaxed",
        CALLOUT_TONE[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "outline";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone === "outline"
          ? "border border-ink-200 bg-white text-ink-600"
          : "bg-ink-100 text-ink-700",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Coverage/progress meter. Width is a share of a known total, never an indeterminate animation. */
export function Meter({
  value,
  total,
  tone = "accent",
  className,
}: {
  value: number;
  total: number;
  tone?: "accent" | "positive";
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-ink-200/70", className)}>
      <div
        className={cn("h-full rounded-full transition-all", tone === "positive" ? "bg-sev-green" : "bg-accent-500")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
