// Resolve-style primary grading: Lift / Gamma / Gain / Offset colour wheels, temperature/tint,
// contrast with pivot, saturation — and curves (custom Y/R/G/B, Hue vs Hue, Hue vs Sat,
// Luma vs Sat). Pure model + CPU reference; the GPU shader in gpu.ts implements the same math
// and is tested against `applyColorGrade`.
import type { Rgb } from "./looks";

/** A colour wheel: puck position (x, y) inside the unit disc, plus a master (luminance) value. */
export interface Wheel {
  x: number;
  y: number;
  master: number;
}
export type WheelKind = "lift" | "gamma" | "gain" | "offset";

/** A curve as control points in 0..1 (x ascending). Neutral is the diagonal / flat 0.5 line. */
export type CurvePoints = [number, number][];
export type CurveKind = "y" | "r" | "g" | "b" | "hueHue" | "hueSat" | "lumSat";

export interface ColorGrade {
  lift: Wheel;
  gamma: Wheel;
  gain: Wheel;
  offset: Wheel;
  temperature: number; // -1..1 (cool..warm)
  tint: number; // -1..1 (green..magenta)
  contrast: number; // 0..2, 1 = neutral
  pivot: number; // 0..1
  saturation: number; // 0..2, 1 = neutral
  curves: Partial<Record<CurveKind, CurvePoints>>;
}

const W0: Wheel = { x: 0, y: 0, master: 0 };
export const NEUTRAL_GRADE: ColorGrade = {
  lift: W0,
  gamma: W0,
  gain: W0,
  offset: W0,
  temperature: 0,
  tint: 0,
  contrast: 1,
  pivot: 0.435,
  saturation: 1,
  curves: {},
};

/** Neutral curve for each kind: identity diagonal for tone curves, flat 0.5 for hue/sat curves. */
export const neutralCurve = (k: CurveKind): CurvePoints =>
  k === "y" || k === "r" || k === "g" || k === "b"
    ? [
        [0, 0],
        [1, 1],
      ]
    : [
        [0, 0.5],
        [1, 0.5],
      ];
export const periodic = (k: CurveKind) => k === "hueHue" || k === "hueSat";

// ---------- wheels ----------
/** How far a fully-pushed puck moves each channel, per wheel. */
const CHROMA: Record<WheelKind, number> = { lift: 0.18, gamma: 0.35, gain: 0.35, offset: 0.12 };
/** Master slider range (UI clamps to ±1). */
const MASTER: Record<WheelKind, number> = { lift: 0.25, gamma: 1, gain: 1, offset: 0.2 };

/**
 * Puck → per-channel shift with zero mean (luminance-neutral). The puck angle is the hue
 * pushed toward: right = red, then counter-clockwise through yellow, green, cyan, blue, magenta.
 */
export function wheelChroma(w: Wheel): Rgb {
  const r = Math.min(1, Math.hypot(w.x, w.y));
  if (r < 1e-6) return [0, 0, 0];
  const a = Math.atan2(w.y, w.x);
  return [
    Math.cos(a) * r,
    Math.cos(a - (2 * Math.PI) / 3) * r,
    Math.cos(a + (2 * Math.PI) / 3) * r,
  ];
}

/** The effective per-channel value of a wheel (additive for lift/offset, log2-gain for gamma/gain). */
export function wheelRgb(kind: WheelKind, w: Wheel): Rgb {
  const c = wheelChroma(w);
  return c.map((v) => v * CHROMA[kind] + w.master * MASTER[kind]) as Rgb;
}

export interface PrimaryParams {
  lift: Rgb;
  gamma: Rgb; // exponent divisor (1 = neutral)
  gain: Rgb; // multiplier (1 = neutral)
  offset: Rgb;
  wb: Rgb; // white-balance multipliers from temperature/tint
  contrast: number;
  pivot: number;
  saturation: number;
}

/** Resolve the UI model into the numbers the shader uses. */
export function primaryParams(g: ColorGrade): PrimaryParams {
  const t = g.temperature * 0.12;
  const n = g.tint * 0.1;
  return {
    lift: wheelRgb("lift", g.lift),
    gamma: wheelRgb("gamma", g.gamma).map((v) => Math.pow(2, v)) as Rgb,
    gain: wheelRgb("gain", g.gain).map((v) => Math.pow(2, v)) as Rgb,
    offset: wheelRgb("offset", g.offset),
    wb: [1 + t + n * 0.5, 1 - n, 1 - t + n * 0.5],
    contrast: g.contrast,
    pivot: g.pivot,
    saturation: g.saturation,
  };
}

// ---------- curves ----------
/**
 * Monotone cubic (Fritsch–Carlson) interpolation through the control points, so curves never
 * overshoot between points. Periodic curves (hue) wrap around 0/1.
 */
export function evalCurve(pts: CurvePoints, x: number, wrap = false): number {
  let p = [...pts].sort((a, b) => a[0] - b[0]);
  if (wrap && p.length) {
    // Repeat two points from each end one period away, so slopes at the 0/1 seam are computed
    // from real neighbours on both sides and the curve joins smoothly.
    const n0 = p.length;
    const before = [p[(n0 - 2 + n0) % n0]!, p[n0 - 1]!].map(
      ([x, y]) => [x - 1, y] as [number, number],
    );
    const after = [p[0]!, p[1 % n0]!].map(([x, y]) => [x + 1, y] as [number, number]);
    p = [...(n0 > 1 ? before : before.slice(1)), ...p, ...(n0 > 1 ? after : after.slice(0, 1))];
  }
  if (p.length === 0) return x;
  if (p.length === 1) return p[0]![1];
  if (x <= p[0]![0]) return p[0]![1];
  if (x >= p.at(-1)![0]) return p.at(-1)![1];
  const n = p.length;
  const d: number[] = []; // secant slopes
  for (let i = 0; i < n - 1; i++)
    d.push((p[i + 1]![1] - p[i]![1]) / Math.max(1e-9, p[i + 1]![0] - p[i]![0]));
  const m: number[] = [d[0]!];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2);
  m.push(d[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * d[i]!;
      m[i + 1] = tau * b * d[i]!;
    }
  }
  let i = 0;
  while (i < n - 2 && x > p[i + 1]![0]) i++;
  const [x0, y0] = p[i]!;
  const [x1, y1] = p[i + 1]!;
  const h = x1 - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * h * m[i]! +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * h * m[i + 1]!
  );
}

export const CURVE_ROWS: CurveKind[] = ["y", "r", "g", "b", "hueHue", "hueSat", "lumSat"];
export const CURVE_SIZE = 256;

/** Bake every curve into a CURVE_ROWS × CURVE_SIZE table (row-major), sampled by the shader. */
export function bakeCurves(curves: ColorGrade["curves"]): Float32Array {
  const out = new Float32Array(CURVE_ROWS.length * CURVE_SIZE);
  CURVE_ROWS.forEach((k, row) => {
    const pts = curves[k] ?? neutralCurve(k);
    for (let i = 0; i < CURVE_SIZE; i++) {
      const v = evalCurve(pts, i / (CURVE_SIZE - 1), periodic(k));
      out[row * CURVE_SIZE + i] = Math.min(1, Math.max(0, v));
    }
  });
  return out;
}

const isNeutralCurve = (k: CurveKind, pts: CurvePoints | undefined) =>
  !pts || (pts.length === 2 && JSON.stringify(pts) === JSON.stringify(neutralCurve(k)));
export const curvesActive = (c: ColorGrade["curves"]) =>
  CURVE_ROWS.some((k) => !isNeutralCurve(k, c[k]));
const wheelZero = (w: Wheel) => w.x === 0 && w.y === 0 && w.master === 0;
export function gradeActive(g: ColorGrade | undefined | null): boolean {
  if (!g) return false;
  return (
    !wheelZero(g.lift) ||
    !wheelZero(g.gamma) ||
    !wheelZero(g.gain) ||
    !wheelZero(g.offset) ||
    g.temperature !== 0 ||
    g.tint !== 0 ||
    g.contrast !== 1 ||
    g.saturation !== 1 ||
    curvesActive(g.curves)
  );
}

// ---------- CPU reference (identical math to the shader) ----------
export const LUMA: Rgb = [0.2126, 0.7152, 0.0722];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const luma = (c: Rgb) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

function lerpTable(table: Float32Array, row: number, x: number) {
  const p = clamp01(x) * (CURVE_SIZE - 1);
  const i = Math.min(CURVE_SIZE - 2, Math.floor(p));
  const f = p - i;
  return table[row * CURVE_SIZE + i]! * (1 - f) + table[row * CURVE_SIZE + i + 1]! * f;
}

export function rgbToHsv([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max > 1e-6 ? d / max : 0, max];
}
export function hsvToRgb([h, s, v]: Rgb): Rgb {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/** Apply a primary grade + curves to one display-referred RGB value (0..1). */
export function applyColorGrade(rgb: Rgb, p: PrimaryParams, table: Float32Array | null): Rgb {
  let c = rgb.map((v, i) => v * p.wb[i]! + p.offset[i]!) as Rgb;
  c = c.map((v, i) => {
    const lifted = v + p.lift[i]! * (1 - v);
    const gained = lifted * p.gain[i]!;
    return Math.pow(Math.max(0, gained), 1 / p.gamma[i]!);
  }) as Rgb;
  c = c.map((v) => (v - p.pivot) * p.contrast + p.pivot) as Rgb;
  const l = luma(c);
  c = c.map((v) => clamp01(l + p.saturation * (v - l))) as Rgb;
  if (table) {
    // custom curves: master (Y) on all channels, then per channel
    c = c.map((v, i) => lerpTable(table, 1 + i, lerpTable(table, 0, v))) as Rgb;
    const hsv = rgbToHsv(c);
    let [h, s] = hsv;
    const v = hsv[2];
    const hueShift = lerpTable(table, 4, h) - 0.5; // ±0.5 turn
    const satHue = lerpTable(table, 5, h) * 2; // 0..2, 1 = neutral
    const satLum = lerpTable(table, 6, luma(c)) * 2;
    h = (((h + hueShift) % 1) + 1) % 1;
    s = clamp01(s * satHue * satLum);
    c = hsvToRgb([h, s, v]);
  }
  return c.map(clamp01) as Rgb;
}

// ---------- validation ----------
const num = (x: unknown, fallback: number, min: number, max: number) =>
  typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback;
function readWheel(w: unknown): Wheel {
  const o = (w ?? {}) as Partial<Wheel>;
  // Keep the puck's direction: scale it back onto the disc rather than clamping each axis.
  let x = num(o.x, 0, -1e6, 1e6);
  let y = num(o.y, 0, -1e6, 1e6);
  const r = Math.hypot(x, y);
  if (r > 1) {
    x /= r;
    y /= r;
  }
  return { x, y, master: num(o.master, 0, -1, 1) };
}
function readCurve(pts: unknown): CurvePoints | null {
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > 16) return null;
  const out: CurvePoints = [];
  for (const p of pts) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    out.push([num(p[0], 0, 0, 1), num(p[1], 0, 0, 1)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
/** Normalise untrusted grade data (from a project file); null when absent or neutral. */
export function readColorGrade(x: unknown): ColorGrade | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Partial<ColorGrade>;
  const curves: ColorGrade["curves"] = {};
  const src = (o.curves ?? {}) as Record<string, unknown>;
  for (const k of CURVE_ROWS) {
    const c = readCurve(src[k]);
    if (c) curves[k] = c;
  }
  const g: ColorGrade = {
    lift: readWheel(o.lift),
    gamma: readWheel(o.gamma),
    gain: readWheel(o.gain),
    offset: readWheel(o.offset),
    temperature: num(o.temperature, 0, -1, 1),
    tint: num(o.tint, 0, -1, 1),
    contrast: num(o.contrast, 1, 0, 2),
    pivot: num(o.pivot, 0.435, 0, 1),
    saturation: num(o.saturation, 1, 0, 2),
    curves,
  };
  return gradeActive(g) ? g : null;
}
