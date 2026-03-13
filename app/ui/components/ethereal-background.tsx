// Ethereal animated background for the Ghost landing page.
// Uses SVG feTurbulence + feColorMatrix(hueRotate) + feDisplacementMap to
// organically distort gradient blobs — no external animation library required.
// SVG <animate> handles hue cycling and turbulence evolution natively.

export function EtherealBackground() {
  return (
    <div className="ethereal-bg" aria-hidden="true">
      {/* Filter definition — zero-size SVG, no layout impact */}
      <svg
        className="ethereal-bg__defs"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
      >
        <defs>
          <filter
            id="ghost-ethereal"
            x="-25%"
            y="-25%"
            width="150%"
            height="150%"
            colorInterpolationFilters="sRGB"
          >
            {/* Step 1: organic noise field */}
            <feTurbulence
              type="turbulence"
              baseFrequency="0.005 0.008"
              numOctaves="3"
              seed="8"
              result="noise"
            >
              {/* Slowly morph the frequency so the noise evolves over time */}
              <animate
                attributeName="baseFrequency"
                values="0.005 0.008; 0.009 0.005; 0.005 0.008"
                dur="30s"
                repeatCount="indefinite"
              />
            </feTurbulence>

            {/* Step 2: cycle hue through the noise — gives the "alive" color shift */}
            <feColorMatrix
              in="noise"
              type="hueRotate"
              values="0"
              result="hued"
            >
              <animate
                attributeName="values"
                from="0"
                to="360"
                dur="38s"
                repeatCount="indefinite"
              />
            </feColorMatrix>

            {/* Step 3: amplify channels so displacement has strong directionality */}
            <feColorMatrix
              in="hued"
              type="matrix"
              values="4 0 0 0 0  4 0 0 0 0  4 0 0 0 0  1 0 0 0 0"
              result="amplified"
            />

            {/* Step 4: displace the source blobs using the animated noise */}
            <feDisplacementMap
              in="SourceGraphic"
              in2="amplified"
              scale="72"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      {/* Gradient blobs — displaced + blurred by the filter above */}
      <div className="ethereal-bg__layer">
        {/* Crown — largest bloom, sits behind the orb */}
        <div className="ethereal-bg__blob ethereal-bg__blob--crown" />
        {/* Left lateral depth */}
        <div className="ethereal-bg__blob ethereal-bg__blob--left" />
        {/* Right lateral depth */}
        <div className="ethereal-bg__blob ethereal-bg__blob--right" />
        {/* Base horizon — anchors the atmosphere to the bottom */}
        <div className="ethereal-bg__blob ethereal-bg__blob--base" />
      </div>
    </div>
  );
}
