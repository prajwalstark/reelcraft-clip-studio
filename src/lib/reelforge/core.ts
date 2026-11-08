// Pure ReelForge model + logic. No React, no DOM. Shared by preview, export and tests.

import type { TemplateSettings } from "./templates";
import type { ColorSettings, AudioSettings, TitleSettings, Marker, ExportSettings } from "./editing";
export type Aspect = "9:16" | "1:1" | "16:9";
export const ASPECTS: Record<Aspect, { w: number; h: number; label: string }> = {
  "9:16": { w: 1080, h: 1920, label: "Reel / Short 1080×1920" },
  "1:1": { w: 1080, h: 1080, label: "Square 1080×1080" },
  "16:9": { w: 1920, h: 1080, label: "Landscape 1920×1080" },
};

export interface Framing {
  aspect: Aspect;
  fit: "fill" | "fit";
  zoom: number; // 1..3
  fx: number; // 0..1 focal / pan
  fy: number;
}
export interface Clip {
  id: string;
  title: string;
  start: number; // source seconds
  end: number;
  framing: Framing;
  color?: ColorSettings;
  audio?: AudioSettings;
  speed?: number;
  overlay?: TitleSettings;
  template?: TemplateSettings;
}
export interface Caption {
  id: string;
  start: number; // SOURCE seconds
  end: number;
  text: string;
}
export interface CaptionStyle {
  size: number; // % of output height
  color: string;
  bg: boolean;
  y: number; // 0..1 vertical centre of caption block
  weight: 600 | 800;
  uppercase: boolean;
}
export interface SourceMeta {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  duration: number;
  width: number;
  height: number;
}
export interface Project {
  version: 1;
  id: string;
  name: string;
  source: SourceMeta | null;
  clips: Clip[];
  captions: Caption[];
  captionStyle: CaptionStyle;
  burnIn: boolean;
  segmentSeconds: number;
  updatedAt: number;
  markers?: Marker[];
  exportSettings?: ExportSettings;
}

export const MIN_CLIP = 0.5;
export const DEFAULT_FRAMING: Framing = { aspect: "9:16", fit: "fill", zoom: 1, fx: 0.5, fy: 0.5 };
export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  size: 4.2,
  color: "#ffffff",
  bg: true,
  y: 0.7,
  weight: 800,
  uppercase: false,
};

export const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function newProject(): Project {
  return {
    version: 1,
    id: uid(),
    name: "Untitled project",
    source: null,
    clips: [],
    captions: [],
    captionStyle: { ...DEFAULT_CAPTION_STYLE },
    burnIn: true,
    segmentSeconds: 30,
    updatedAt: Date.now(),
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

/** Split [0, duration] into consecutive ranges of `seg` seconds. The final
 * remainder is kept as its own clip unless shorter than MIN_CLIP, in which case
 * it is merged into the previous clip so the whole source is always covered. */
export function segmentByDuration(duration: number, seg: number): Array<[number, number]> {
  if (!(duration > 0) || !Number.isFinite(duration)) return [];
  const len = Math.max(MIN_CLIP, Number.isFinite(seg) ? seg : 30);
  const out: Array<[number, number]> = [];
  let s = 0;
  while (s < duration - 1e-6) {
    const e = Math.min(duration, s + len);
    if (e - s < MIN_CLIP && out.length) out[out.length - 1]![1] = r3(duration);
    else out.push([r3(s), r3(e)]);
    s = e;
  }
  return out;
}

export function makeClips(duration: number, seg: number, framing: Framing = DEFAULT_FRAMING): Clip[] {
  return segmentByDuration(duration, seg).map(([start, end], i) => ({
    id: uid(),
    title: `Short ${String(i + 1).padStart(2, "0")}`,
    start,
    end,
    framing: { ...framing },
  }));
}

/** Clamp a range into the source, guaranteeing end - start >= MIN_CLIP (or the full source if shorter). */
export function clampRange(start: number, end: number, duration: number): [number, number] {
  if (duration <= MIN_CLIP) return [0, r3(duration)];
  const s = clamp(Number.isFinite(start) ? start : 0, 0, duration - MIN_CLIP);
  const e = clamp(Number.isFinite(end) ? end : duration, s + MIN_CLIP, duration);
  return [r3(s), r3(e)];
}

export function validateClip(c: Pick<Clip, "start" | "end">, duration: number): string | null {
  if (!Number.isFinite(c.start) || !Number.isFinite(c.end)) return "Invalid time";
  if (c.start < 0) return "Starts before the source";
  if (c.end > duration + 1e-3) return "Ends after the source";
  if (c.end - c.start < MIN_CLIP - 1e-6) return `Must be at least ${MIN_CLIP}s`;
  return null;
}

export function splitClip(c: Clip, t: number): [Clip, Clip] | null {
  if (t - c.start < MIN_CLIP || c.end - t < MIN_CLIP) return null;
  return [
    { ...c, end: r3(t), title: `${c.title} A`, framing: { ...c.framing } },
    { ...c, id: uid(), start: r3(t), title: `${c.title} B`, framing: { ...c.framing } },
  ];
}

// ---------- Crop / layout (identical for preview and export) ----------
export interface Layout { dx: number; dy: number; dw: number; dh: number }
export function computeLayout(srcW: number, srcH: number, outW: number, outH: number, f: Framing): Layout {
  const base = f.fit === "fill" ? Math.max(outW / srcW, outH / srcH) : Math.min(outW / srcW, outH / srcH);
  const s = base * clamp(f.zoom, 0.5, 4);
  const dw = srcW * s;
  const dh = srcH * s;
  return { dx: (outW - dw) * clamp(f.fx, 0, 1), dy: (outH - dh) * clamp(f.fy, 0, 1), dw, dh };
}

// ---------- Captions ----------
export function parseTime(s: string): number {
  const p = s.trim().replace(",", ".").split(":").map(Number);
  if (p.some((n) => !Number.isFinite(n))) return NaN;
  return p.reduce((acc, n) => acc * 60 + n, 0);
}

export function parseSubtitles(text: string): Caption[] {
  const blocks = text.replace(/\r/g, "").replace(/^\uFEFF/, "").split(/\n{2,}/);
  const out: Caption[] = [];
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim() !== "");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a = "", rest = ""] = lines[i]!.split("-->");
    const start = parseTime(a);
    const end = parseTime(rest.trim().split(/\s+/)[0] ?? "");
    const body = lines
      .slice(i + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !body) continue;
    out.push({ id: uid(), start: r3(start), end: r3(end), text: body });
  }
  return out.sort((x, y) => x.start - y.start);
}

export function fmtSrtTime(t: number, sep = ","): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

/** Captions overlapping [start,end), clipped and shifted to clip-relative time. */
export function clipCaptions(caps: Caption[], start: number, end: number): Caption[] {
  return caps
    .filter((c) => c.end > start && c.start < end)
    .map((c) => ({ ...c, start: r3(Math.max(c.start, start) - start), end: r3(Math.min(c.end, end) - start) }))
    .filter((c) => c.end - c.start > 0.001)
    .sort((a, b) => a.start - b.start);
}

export function toSRT(caps: Caption[]): string {
  return caps
    .map((c, i) => `${i + 1}\n${fmtSrtTime(c.start)} --> ${fmtSrtTime(c.end)}\n${c.text}\n`)
    .join("\n");
}
export function toVTT(caps: Caption[]): string {
  return "WEBVTT\n\n" + caps.map((c) => `${fmtSrtTime(c.start, ".")} --> ${fmtSrtTime(c.end, ".")}\n${c.text}\n`).join("\n");
}

export const activeCaptions = (caps: Caption[], t: number) => caps.filter((c) => t >= c.start && t < c.end);

export function fmtTC(t: number): string {
  if (!Number.isFinite(t)) return "--:--.--";
  const neg = t < 0;
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${neg ? "-" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "clip";

export function isProject(x: unknown): x is Project {
  const p = x as Project;
  return !!p && p.version === 1 && Array.isArray(p.clips) && Array.isArray(p.captions) && typeof p.name === "string";
}
