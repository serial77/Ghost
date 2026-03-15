"use client";

// Ghost Aurora — OGL WebGL atmospheric background.
// Adapted from ReactBits Aurora (MIT © DavidHDev) with Ghost-specific
// color palette and tuning. Uses additive premultiplied-alpha blending
// so the aurora adds soft atmospheric light without occluding content.
//
// Color family: deep navy (#15174c) → steel blue (#1a3472) → desaturated teal (#165266)
// This directly mirrors the Light Pillar reference palette the user selected.
//
// Architecture:
//   GhostAurora renders an absolutely-positioned div that fills its container.
//   OGL appends a canvas child after mount. SSR-safe — canvas only exists on client.

import { useEffect, useRef } from "react";

// ── Vertex shader — standard full-screen triangle ────────────────────────────

const vert = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// ── Fragment shader ───────────────────────────────────────────────────────────
// 2D Simplex noise drives organic height variation of the aurora band.
// Three color stops interpolate across the X axis.
// Intensity peaks slightly above center-screen so the band aligns with the orb.

const frag = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uAmplitude;
uniform float uBlend;
uniform vec3  uColor0;
uniform vec3  uColor1;
uniform vec3  uColor2;

/* --- 2D Simplex noise (Ashima Arts, MIT) --- */
vec3 perm3(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187, 0.366025403784439,
   -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1  = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy  -= i1;
  i = mod(i, 289.0);
  vec3 p = perm3(perm3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x   = 2.0 * fract(p * C.www) - 1.0;
  vec3 h   = abs(x) - 0.5;
  vec3 ox  = floor(x + 0.5);
  vec3 a0  = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vec2 uv = vUv;

  /* Noise-driven height variation — band undulates slowly */
  float height  = snoise(vec2(uv.x * 2.0 + uTime * 0.10, uTime * 0.25)) * 0.5 * uAmplitude;
  height        = exp(height);
  float intensity = 0.6 * (uv.y * 2.0 - height + 0.2);

  /* Three-stop color ramp across X (left → center → right) */
  float t = clamp(uv.x, 0.0, 1.0);
  vec3 col;
  if (t < 0.5) {
    col = mix(uColor0, uColor1, t * 2.0);
  } else {
    col = mix(uColor1, uColor2, (t - 0.5) * 2.0);
  }

  /* Ghost: midPoint ~0.22 puts the band just above center-screen,
     aligned with the orb's vertical position in landing mode.
     uBlend controls softness — higher = wider, more diffuse. */
  float midPoint = 0.22;
  float alpha    = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  /* Premultiplied alpha output for additive blending */
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToVec3(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [
    parseInt(c.slice(0, 2), 16) / 255,
    parseInt(c.slice(2, 4), 16) / 255,
    parseInt(c.slice(4, 6), 16) / 255,
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GhostAurora() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    let animId = 0;
    let ro: ResizeObserver | null = null;
    let mounted = true;

    (async () => {
      // Dynamic import — keeps OGL out of the SSR bundle entirely
      const { Renderer, Program, Mesh, Triangle } = await import("ogl");
      if (!mounted) return;

      const renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        // Cap DPR at 1.5 — this is a background element, not UI chrome
        dpr: Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 1.5),
      });

      const gl = renderer.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      const canvas = gl.canvas as HTMLCanvasElement;
      canvas.style.cssText = "position:absolute;inset:0;pointer-events:none;";
      container.appendChild(canvas);

      // Ghost palette — deep navy / steel blue / desaturated teal
      // Mirrors the Light Pillar reference: #15174c (navy) → #14667b (teal)
      // Intermediate step adds steel blue for richer mid-band atmosphere
      const uniforms = {
        uTime:      { value: 0 },
        uAmplitude: { value: 0.52 },   // Slightly reduced — subtle, not vivid
        uBlend:     { value: 0.65 },   // Wide soft band, not a sharp edge
        uColor0:    { value: hexToVec3("#15174c") },  // Deep navy (left)
        uColor1:    { value: hexToVec3("#1a3472") },  // Steel blue (center)
        uColor2:    { value: hexToVec3("#165266") },  // Desaturated teal (right)
      };

      const geometry = new Triangle(gl);
      const program  = new Program(gl, { vertex: vert, fragment: frag, uniforms });
      const mesh     = new Mesh(gl, { geometry, program });

      function resize() {
        if (!ref.current) return;
        renderer.setSize(ref.current.offsetWidth, ref.current.offsetHeight);
      }
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(container);

      let start = 0;
      function frame(ts: number) {
        animId = requestAnimationFrame(frame);
        if (!start) start = ts;
        // speed = 0.4 — slow, cinematic drift
        uniforms.uTime.value = ((ts - start) * 0.001) * 0.4;
        renderer.render({ scene: mesh });
      }
      animId = requestAnimationFrame(frame);
    })();

    return () => {
      mounted = false;
      cancelAnimationFrame(animId);
      ro?.disconnect();
      // Clean up canvas on unmount
      const canvas = ref.current?.querySelector("canvas");
      if (canvas) ref.current?.removeChild(canvas);
    };
  }, []);

  return <div ref={ref} className="ghost-aurora" aria-hidden="true" />;
}
