// Text and title layers for Sequence Studio.
//
// A title is a clip on a video track whose picture is rendered text instead of a media file.
// It is laid out in frame-relative units (font size is a share of the frame height), so it
// looks the same at every preview and export resolution, and it is rendered at the size it is
// drawn so text stays sharp. Position, scale, rotation, crop, opacity, fades and keyframes work
// exactly as for any other clip.

export type FontId = "sans" | "serif" | "mono" | "system" | "classic" | "impact";
export const FONTS: { id: FontId; label: string; family: string }[] = [
  // The first three are the web fonts the app already loads, so they render the same everywhere.
  { id: "sans", label: "Instrument Sans", family: '"Instrument Sans", system-ui, sans-serif' },
  { id: "serif", label: "Instrument Serif", family: '"Instrument Serif", Georgia, serif' },
  { id: "mono", label: "JetBrains Mono", family: '"JetBrains Mono", ui-monospace, monospace' },
  // System fonts vary by device.
  { id: "system", label: "System UI", family: "system-ui, -apple-system, sans-serif" },
  { id: "classic", label: "Georgia", family: "Georgia, 'Times New Roman', serif" },
  { id: "impact", label: "Impact", family: "Impact, 'Arial Black', 'Helvetica Neue', sans-serif" },
];
export type Align = "left" | "center" | "right";
export interface Title {
  text: string;
  font: FontId;
  weight: 400 | 700 | 800;
  italic: boolean;
  /** Font size as a share of the frame height. */
  size: number;
  color: string;
  align: Align;
  /** Line spacing as a multiple of the font size. */
  lineHeight: number;
  /** Outline width as a share of the font size (0 = none). */
  outline: number;
  outlineColor: string;
  shadow: boolean;
  /** Box behind the text, or null for none. */
  background: string | null;
  backgroundOpacity: number;
}
export const MAX_TEXT = 500;
export const LIMITS = {
  size: [0.02, 0.4],
  lineHeight: [0.8, 2.5],
  outline: [0, 0.25],
  backgroundOpacity: [0, 1],
} as const;
export const DEFAULT_TITLE: Title = {
  text: "Your title",
  font: "sans",
  weight: 800,
  italic: false,
  size: 0.1,
  color: "#ffffff",
  align: "center",
  lineHeight: 1.15,
  outline: 0,
  outlineColor: "#000000",
  shadow: true,
  background: null,
  backgroundOpacity: 0.6,
};
/** Quick starts: a look plus where it sits in the frame. */
export const PRESETS: {
  id: string;
  label: string;
  title: Partial<Title>;
  place: { x: number; y: number };
}[] = [
  {
    id: "big",
    label: "Big title",
    title: { size: 0.14, weight: 800, shadow: true },
    place: { x: 0.5, y: 0.5 },
  },
  {
    id: "lower",
    label: "Lower third",
    title: {
      size: 0.055,
      weight: 700,
      align: "left",
      shadow: false,
      background: "#0b0d12",
      backgroundOpacity: 0.75,
    },
    place: { x: 0.3, y: 0.8 },
  },
  {
    id: "subtitle",
    label: "Subtitle",
    title: { size: 0.05, weight: 700, outline: 0.12, outlineColor: "#000000", shadow: false },
    place: { x: 0.5, y: 0.88 },
  },
  {
    id: "label",
    label: "Label",
    title: {
      font: "mono",
      size: 0.04,
      weight: 400,
      color: "#0b0d12",
      shadow: false,
      background: "#b7f26a",
      backgroundOpacity: 1,
    },
    place: { x: 0.18, y: 0.12 },
  },
];

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
export const familyOf = (t: Title) =>
  FONTS.find((f) => f.id === t.font)?.family ?? FONTS[0]!.family;
export const fontCss = (t: Title, px: number) =>
  `${t.italic ? "italic " : ""}${t.weight} ${px}px ${familyOf(t)}`;
/** Short name for timeline blocks and labels. */
export const titleName = (t: Title) => {
  const first = t.text.split("\n").find((l) => l.trim()) ?? "";
  return `T · ${first.trim().slice(0, 40) || "Empty title"}`;
};

/** Validate a stored title: unknown values fall back to defaults, numbers are clamped. */
export function readTitle(value: unknown): Title | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v["text"] !== "string") return null;
  const num = (k: keyof typeof LIMITS, d: number) =>
    typeof v[k] === "number" && Number.isFinite(v[k]) ? clamp(v[k], LIMITS[k]) : d;
  const color = (k: string, d: string) =>
    typeof v[k] === "string" && HEX.test(v[k]) ? (v[k] as string).toLowerCase() : d;
  return {
    text: v["text"].slice(0, MAX_TEXT),
    font: FONTS.some((f) => f.id === v["font"]) ? (v["font"] as FontId) : DEFAULT_TITLE.font,
    weight: [400, 700, 800].includes(v["weight"] as number)
      ? (v["weight"] as Title["weight"])
      : DEFAULT_TITLE.weight,
    italic: v["italic"] === true,
    size: num("size", DEFAULT_TITLE.size),
    color: color("color", DEFAULT_TITLE.color),
    align: ["left", "center", "right"].includes(v["align"] as string)
      ? (v["align"] as Align)
      : DEFAULT_TITLE.align,
    lineHeight: num("lineHeight", DEFAULT_TITLE.lineHeight),
    outline: num("outline", DEFAULT_TITLE.outline),
    outlineColor: color("outlineColor", DEFAULT_TITLE.outlineColor),
    shadow: v["shadow"] === true,
    background:
      typeof v["background"] === "string" && HEX.test(v["background"])
        ? v["background"].toLowerCase()
        : null,
    backgroundOpacity: num("backgroundOpacity", DEFAULT_TITLE.backgroundOpacity),
  };
}

// ---------- measuring and drawing ----------
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
let measurer: Ctx2D | null | undefined;
/** A 2D context for measuring text, or null where there is no canvas (tests, SSR). */
function measureContext(): Ctx2D | null {
  if (measurer !== undefined) return measurer;
  measurer =
    typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1).getContext("2d") : null;
  return measurer;
}
const layouts = new Map<string, TitleLayout>();
const renders = new Map<string, OffscreenCanvas | HTMLCanvasElement>();
// Layouts depend on which fonts have loaded; start over when that changes.
if (typeof document !== "undefined" && document.fonts?.addEventListener)
  document.fonts.addEventListener("loadingdone", () => {
    layouts.clear();
    renders.clear();
  });

export interface TitleLayout {
  /** Picture size in canvas pixels (text block plus padding, outline and shadow room). */
  w: number;
  h: number;
  fontPx: number;
  lineH: number;
  /** Inset from the picture edge to the text block. */
  margin: number;
  lines: { text: string; width: number }[];
}

/** Lay a title out for a frame `height` pixels tall. */
export function titleLayout(t: Title, height: number): TitleLayout {
  const key = `${height}|${JSON.stringify(t)}`;
  const hit = layouts.get(key);
  if (hit) return hit;
  const fontPx = t.size * height;
  const ctx = measureContext();
  if (ctx) ctx.font = fontCss(t, fontPx);
  const lines = t.text.split("\n").map((text) => ({
    text,
    // Without a canvas, estimate (about half an em per character) so geometry still works.
    width: ctx ? ctx.measureText(text).width : text.length * fontPx * 0.55,
  }));
  const lineH = fontPx * t.lineHeight;
  const pad = t.background ? fontPx * 0.35 : 0;
  const margin = pad + t.outline * fontPx + (t.shadow ? fontPx * 0.1 : 0) + fontPx * 0.05;
  const layout = {
    w: Math.max(fontPx * 0.5, ...lines.map((l) => l.width)) + margin * 2,
    h: lines.length * lineH + margin * 2,
    fontPx,
    lineH,
    margin,
    lines,
  };
  if (layouts.size > 200) layouts.clear();
  layouts.set(key, layout);
  return layout;
}

/** Load the title's font (if it is a web font) so measuring and drawing use it. */
export async function ensureFont(t: Title) {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  try {
    await document.fonts.load(fontCss(t, 100), t.text || "A");
  } catch {
    /* fall back to whatever is available */
  }
}

const rgba = (hex: string, a: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;

/**
 * Render a title for a frame `height` pixels tall (transparent outside the text and its box).
 * Pass the height it will be drawn at — e.g. frame height × clip scale — so text stays sharp.
 */
export function renderTitle(t: Title, height: number): OffscreenCanvas | HTMLCanvasElement {
  const h = Math.max(1, Math.round(height));
  const key = `${h}|${JSON.stringify(t)}`;
  const hit = renders.get(key);
  if (hit) return hit;
  const L = titleLayout(t, h);
  const W = Math.max(1, Math.ceil(L.w)),
    H = Math.max(1, Math.ceil(L.h));
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(W, H)
      : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d") as Ctx2D | null;
  if (!ctx) throw new Error("Canvas is unavailable.");
  if (t.background) {
    ctx.fillStyle = rgba(t.background, t.backgroundOpacity);
    const r = L.fontPx * 0.18;
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, r);
    ctx.fill();
  }
  ctx.font = fontCss(t, L.fontPx);
  ctx.textAlign = t.align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const x = t.align === "left" ? L.margin : t.align === "right" ? W - L.margin : W / 2;
  const shadow = () => {
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = L.fontPx * 0.08;
    ctx.shadowOffsetY = L.fontPx * 0.04;
  };
  const plain = () => {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  };
  L.lines.forEach((line, i) => {
    const y = L.margin + L.lineH * (i + 0.5);
    if (t.outline > 0) {
      if (t.shadow) shadow();
      ctx.strokeStyle = t.outlineColor;
      ctx.lineWidth = t.outline * L.fontPx * 2; // half of the stroke sits outside the glyph
      ctx.strokeText(line.text, x, y);
      plain();
    } else if (t.shadow) shadow();
    ctx.fillStyle = t.color;
    ctx.fillText(line.text, x, y);
    plain();
  });
  if (renders.size > 40) renders.clear();
  renders.set(key, canvas);
  return canvas;
}
