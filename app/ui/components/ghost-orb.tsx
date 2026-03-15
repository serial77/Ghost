"use client";

// Ghost Orb — ReactBits Orb with Ghost-appropriate defaults.
// Source: https://reactbits.dev/backgrounds/orb
// Wraps orb.tsx with sizing container and responds to Ghost's
// `responding` state (maps to forceHoverState for the energized look).

import { cn } from "@/lib/utils";
import Orb from "./orb";

export function GhostOrb({
  compact = false,
  responding = false,
  transitioning = false,
}: {
  compact?: boolean;
  responding?: boolean;
  transitioning?: boolean;
}) {
  return (
    <div
      className={cn(
        "ghost-orb",
        compact       && "compact",
        transitioning && "transitioning",
        responding    && "responding",
      )}
    >
      <Orb
        hue={220}
        backgroundColor="#07070d"
        forceHoverState={responding}
        rotateOnHover={true}
        hoverIntensity={0.3}
      />
    </div>
  );
}
