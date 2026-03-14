"use client";

// Ghost Background — global background using ReactBits FloatingLines.
// Mounted in layout.tsx (position:fixed), persists across all routes.
// Gradient: #020a22 (deep navy) → #252395 (dark blue) → #31a2aa (teal).
// interactive/parallax disabled so it doesn't intercept page pointer events.

import FloatingLines from "./floating-lines";

export function GhostBackground() {
  return (
    <div className="ghost-bg" aria-hidden="true">
      <FloatingLines
        linesGradient={["#020a22", "#252395", "#31a2aa"]}
        interactive={false}
        parallax={false}
        mixBlendMode="screen"
        animationSpeed={0.8}
      />
    </div>
  );
}
