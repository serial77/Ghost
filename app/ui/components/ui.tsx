import { cn } from "@/lib/utils";

export function GlassPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <section className={cn("glass-panel", className)}>{children}</section>;
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("card glass-panel", className)}>{children}</div>;
}

export function SectionHeader({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <header className="section-header">
      <div className="eyebrow">{eyebrow}</div>
      <h1 className="section-title">{title}</h1>
      <p className="section-copy">{copy}</p>
    </header>
  );
}

export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <span className="signal-pill">
      <span className={cn("status-dot", tone === "success" && "success", tone === "warning" && "warning", tone === "danger" && "danger")} />
      {label}
    </span>
  );
}
