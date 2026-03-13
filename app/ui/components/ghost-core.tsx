import { cn } from "@/lib/utils";

export function GhostCore({
  compact = false,
  transitioning = false,
  responding = false,
}: {
  compact?: boolean;
  transitioning?: boolean;
  responding?: boolean;
}) {
  return (
    <div
      className={cn(
        "ghost-core",
        compact && "compact",
        transitioning && "transitioning",
        responding && "responding",
      )}
      aria-hidden="true"
    >
      <div className="ghost-core__orbit" />
      <div className="ghost-core__halo" />
      <div className="ghost-core__ring" />
    </div>
  );
}
