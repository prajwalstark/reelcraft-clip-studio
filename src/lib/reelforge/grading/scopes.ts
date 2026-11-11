// Video scopes — waveform (luma), RGB parade, vectorscope and histogram — computed from the
// graded video frame (before titles and captions are drawn), the pixels that get exported.
// Pure analysis functions + a tiny publisher the preview feeds while the scopes are open.

/** Rec.709 luma and colour-difference weights (the same luma the grading pass uses). */
export const KR = 0.2126;
export const KG = 0.7152;
export const KB = 0.0722;

export interface ScopeData {
  width: number; // columns sampled across the frame
  levels: number; // vertical resolution of waveform/parade (0 = black … levels-1 = white)
  /** Luma waveform density: width × levels, row-major by level (level * width + x). */
  luma: Uint32Array;
  /** RGB parade densities, each width × levels. */
  parade: [Uint32Array, Uint32Array, Uint32Array];
  /** Vectorscope density: vsize × vsize, Cb → x (right = blue), Cr → y (up = red). */
  vector: Uint32Array;
  vsize: number;
  /** 256-bin histograms: R, G, B and luma. */
  hist: [Uint32Array, Uint32Array, Uint32Array, Uint32Array];
  /** Share of pixels with luma at 0 (crushed) and at 255 (clipped). */
  crushed: number;
  clipped: number;
  pixels: number;
}

/** Rec.709 Cb/Cr in −0.5…0.5 for an RGB value in 0…1. */
export function cbcr(r: number, g: number, b: number): [number, number] {
  const y = KR * r + KG * g + KB * b;
  return [(b - y) / (2 * (1 - KB)), (r - y) / (2 * (1 - KR))];
}

/** Vectorscope target positions (75 % colour bars) for the graticule, in Cb/Cr. */
export const TARGETS: { label: string; rgb: [number, number, number] }[] = [
  { label: "R", rgb: [0.75, 0, 0] },
  { label: "Mg", rgb: [0.75, 0, 0.75] },
  { label: "B", rgb: [0, 0, 0.75] },
  { label: "Cy", rgb: [0, 0.75, 0.75] },
  { label: "G", rgb: [0, 0.75, 0] },
  { label: "Yl", rgb: [0.75, 0.75, 0] },
];
/** The skin-tone ("I") line sits at 123° counter-clockwise from the +Cb axis. */
export const SKIN_LINE_DEG = 123;

/**
 * Analyse an RGBA frame. `levels` sets waveform resolution, `vsize` the vectorscope grid.
 * Fully transparent pixels are ignored.
 */
export function analyzeFrame(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  levels = 128,
  vsize = 128,
): ScopeData {
  const luma = new Uint32Array(width * levels);
  const parade: ScopeData["parade"] = [
    new Uint32Array(width * levels),
    new Uint32Array(width * levels),
    new Uint32Array(width * levels),
  ];
  const vector = new Uint32Array(vsize * vsize);
  const hist: ScopeData["hist"] = [
    new Uint32Array(256),
    new Uint32Array(256),
    new Uint32Array(256),
    new Uint32Array(256),
  ];
  const lv = (v: number) => Math.min(levels - 1, Math.floor((v / 256) * levels));
  let crushed = 0;
  let clipped = 0;
  let pixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const yv = Math.round(KR * r + KG * g + KB * b);
      pixels++;
      if (yv <= 0) crushed++;
      else if (yv >= 255) clipped++;
      hist[0][r]!++;
      hist[1][g]!++;
      hist[2][b]!++;
      hist[3][yv]!++;
      luma[lv(yv) * width + x]!++;
      parade[0][lv(r) * width + x]!++;
      parade[1][lv(g) * width + x]!++;
      parade[2][lv(b) * width + x]!++;
      const [cb, cr] = cbcr(r / 255, g / 255, b / 255);
      const vx = Math.min(vsize - 1, Math.max(0, Math.floor((cb + 0.5) * vsize)));
      const vy = Math.min(vsize - 1, Math.max(0, Math.floor((0.5 - cr) * vsize)));
      vector[vy * vsize + vx]!++;
    }
  }
  return {
    width,
    levels,
    luma,
    parade,
    vector,
    vsize,
    hist,
    crushed: pixels ? crushed / pixels : 0,
    clipped: pixels ? clipped / pixels : 0,
    pixels,
  };
}

// ---------- live feed from the preview ----------
type Listener = (d: ScopeData) => void;
const listeners = new Set<Listener>();
let target: HTMLCanvasElement | null = null;
let sampler: HTMLCanvasElement | null = null;
let last = 0;
/** Analysis runs at most this often while scopes are open. */
const INTERVAL_MS = 120;
const SAMPLE_WIDTH = 256;

/** The canvas whose frames feed the scopes (the editor preview). Exports never feed them. */
export function setScopeSource(canvas: HTMLCanvasElement | null) {
  target = canvas;
}
export const scopesWanted = () => listeners.size > 0;
export function subscribeScopes(fn: Listener) {
  listeners.add(fn);
  last = 0;
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Called by the compositor right after the video is drawn and graded, before decorations,
 * titles and captions. Samples the video rectangle, downscaled, at a throttled rate.
 */
export function tapGradedFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (ctx.canvas !== target || !listeners.size) return;
  const now = performance.now();
  if (now - last < INTERVAL_MS) return;
  last = now;
  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const sw = Math.min(ctx.canvas.width, Math.ceil(x + w)) - sx;
  const sh = Math.min(ctx.canvas.height, Math.ceil(y + h)) - sy;
  if (sw <= 0 || sh <= 0) return;
  const outW = Math.min(SAMPLE_WIDTH, sw);
  const outH = Math.max(1, Math.round((sh / sw) * outW));
  sampler ??= document.createElement("canvas");
  if (sampler.width !== outW || sampler.height !== outH) {
    sampler.width = outW;
    sampler.height = outH;
  }
  const s = sampler.getContext("2d", { willReadFrequently: true });
  if (!s) return;
  s.clearRect(0, 0, outW, outH);
  s.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, outW, outH);
  const img = s.getImageData(0, 0, outW, outH);
  const data = analyzeFrame(img.data, outW, outH);
  listeners.forEach((f) => f(data));
}
