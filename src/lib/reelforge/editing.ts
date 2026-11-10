import { normalizeTemplate } from "./templates";
import { ASPECTS, clipCaptions, toSRT, type Caption, type Clip, type Project } from "./core";

export interface ColorSettings {
  enabled: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  blur: number;
}
export interface AudioSettings {
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
}
/** Overlay times are absolute SOURCE seconds, just like captions. */
export interface TitleSettings {
  enabled: boolean;
  text: string;
  start: number;
  end: number;
  size: number;
  x: number;
  y: number;
  color: string;
  background: boolean;
}
export interface Marker {
  id: string;
  time: number;
  name: string;
}
export interface ExportSettings {
  resolution: 720 | 1080 | 2160;
  fps: 24 | 30;
}
export const DEFAULT_COLOR: ColorSettings = {
  enabled: true,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue: 0,
  blur: 0,
};
export const DEFAULT_AUDIO: AudioSettings = { volume: 1, muted: false, fadeIn: 0, fadeOut: 0 };
export const DEFAULT_EXPORT: ExportSettings = { resolution: 1080, fps: 30 };
export const bounded = (x: unknown, fallback: number, min: number, max: number) =>
  typeof x === "number" && Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : fallback;
const hex = (x: unknown, fallback = "#ffffff") =>
  typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x) ? x : fallback;
export function speedOf(c: Clip) {
  return bounded(c.speed, 1, 0.5, 2);
}
export function outputDuration(c: Clip) {
  return (c.end - c.start) / speedOf(c);
}
export function colorOf(c: Clip): ColorSettings {
  const s = c.color;
  return {
    enabled: s?.enabled !== false,
    brightness: bounded(s?.brightness, 1, 0, 2),
    contrast: bounded(s?.contrast, 1, 0, 2),
    saturation: bounded(s?.saturation, 1, 0, 2),
    hue: bounded(s?.hue, 0, -180, 180),
    blur: bounded(s?.blur, 0, 0, 20),
  };
}
export function audioOf(c: Clip): AudioSettings {
  const s = c.audio;
  return {
    volume: bounded(s?.volume, 1, 0, 1),
    muted: s?.muted === true,
    fadeIn: bounded(s?.fadeIn, 0, 0, 10),
    fadeOut: bounded(s?.fadeOut, 0, 0, 10),
  };
}
export function titleOf(c: Clip): TitleSettings {
  const s = c.overlay;
  return {
    enabled: s?.enabled === true,
    text: typeof s?.text === "string" ? s.text.slice(0, 300) : "Your title",
    start: bounded(s?.start, c.start, 0, Number.MAX_SAFE_INTEGER),
    end: bounded(s?.end, c.end, 0, Number.MAX_SAFE_INTEGER),
    size: bounded(s?.size, 5, 2, 12),
    x: bounded(s?.x, 0.5, 0.1, 0.9),
    y: bounded(s?.y, 0.3, 0.1, 0.9),
    color: hex(s?.color),
    background: s?.background !== false,
  };
}
/** Fade durations are output seconds. Overlapping fades scale to fit the clip. */
export function audioGain(c: Clip, sourceTime: number) {
  const a = audioOf(c),
    duration = outputDuration(c);
  if (a.muted || duration <= 0 || sourceTime < c.start || sourceTime >= c.end) return 0;
  const scale = Math.min(1, duration / (a.fadeIn + a.fadeOut || 1));
  const fi = a.fadeIn * scale,
    fo = a.fadeOut * scale;
  const t = (sourceTime - c.start) / speedOf(c);
  return a.volume * Math.max(0, Math.min(1, fi ? t / fi : 1, fo ? (duration - t) / fo : 1));
}
export function videoFilter(c: Clip, height: number) {
  const s = colorOf(c);
  return s.enabled
    ? `brightness(${s.brightness}) contrast(${s.contrast}) saturate(${s.saturation}) hue-rotate(${s.hue}deg) blur(${(s.blur * height) / 1080}px)`
    : "none";
}
export function settingsOf(s?: ExportSettings): ExportSettings {
  const resolution = s?.resolution === 720 ? 720 : s?.resolution === 2160 ? 2160 : 1080;
  return { resolution, fps: s?.fps === 24 ? 24 : 30 };
}
export function outputSize(c: Clip, settings?: ExportSettings) {
  const s = settingsOf(settings),
    a = ASPECTS[c.framing.aspect],
    ratio = s.resolution / 1080;
  return {
    w: Math.round(a.w * ratio),
    h: Math.round(a.h * ratio),
    fps: s.fps,
    bitrate: s.resolution === 720 ? 4_000_000 : s.resolution === 2160 ? 32_000_000 : 8_000_000,
  };
}
export function clipSRT(captions: Caption[], c: Clip) {
  const speed = speedOf(c);
  return toSRT(
    clipCaptions(captions, c.start, c.end).map((x) => ({
      ...x,
      start: x.start / speed,
      end: x.end / speed,
    })),
  );
}
/** Capture all render inputs when queued; subsequent edits cannot change a job. */
export function exportSnapshot(p: Project, c: Clip) {
  return structuredClone({
    clip: c,
    captions: p.burnIn ? p.captions : null,
    style: p.captionStyle,
    settings: settingsOf(p.exportSettings),
    srt: clipSRT(p.captions, c),
  });
}
export function timelineTime(clientX: number, left: number, width: number, duration: number) {
  return width > 0 ? bounded(((clientX - left) / width) * duration, 0, 0, duration) : 0;
}
export function snapTime(time: number, points: number[], tolerance: number) {
  let best = time,
    distance = tolerance + Number.EPSILON;
  for (const p of points) {
    const delta = Math.abs(p - time);
    if (delta <= tolerance && delta < distance) {
      best = p;
      distance = delta;
    }
  }
  return best;
}

/** Parse untrusted JSON and upgrade v1 defaults without changing source time semantics. */
export function readProject(value: unknown): Project {
  if (!value || typeof value !== "object") throw new Error("Invalid project");
  const p = value as Project;
  if (
    p.version !== 1 ||
    typeof p.name !== "string" ||
    typeof p.id !== "string" ||
    !Array.isArray(p.clips) ||
    !Array.isArray(p.captions)
  )
    throw new Error("Not a ReelForge v1 project");
  if (p.clips.length > 10000 || p.captions.length > 100000) throw new Error("Project is too large");
  const source = p.source;
  if (
    source &&
    (![source.duration, source.width, source.height, source.size].every(
      (x) => Number.isFinite(x) && x > 0,
    ) ||
      typeof source.name !== "string")
  )
    throw new Error("Invalid source metadata");
  const duration = source?.duration ?? 0;
  const ids = new Set<string>();
  const clips = p.clips.map((c) => {
    if (
      !c ||
      typeof c.id !== "string" ||
      ids.has(c.id) ||
      typeof c.title !== "string" ||
      !Number.isFinite(c.start) ||
      !Number.isFinite(c.end) ||
      c.start < 0 ||
      c.end <= c.start ||
      c.end > duration + 0.001 ||
      !c.framing ||
      !Object.hasOwn(ASPECTS, c.framing.aspect)
    )
      throw new Error("Invalid clip or duplicate clip ID");
    ids.add(c.id);
    const { template: rawTemplate, ...rest } = c;
    const template = normalizeTemplate(rawTemplate);
    return {
      ...rest,
      ...(template ? { template } : {}),
      speed: speedOf(c),
      color: colorOf(c),
      audio: audioOf(c),
      overlay: titleOf(c),
      framing: {
        aspect: c.framing.aspect,
        fit: c.framing.fit === "fit" ? ("fit" as const) : ("fill" as const),
        zoom: bounded(c.framing.zoom, 1, 1, 3),
        fx: bounded(c.framing.fx, 0.5, 0, 1),
        fy: bounded(c.framing.fy, 0.5, 0, 1),
      },
    };
  });
  const captions = p.captions.map((c) => {
    if (
      !c ||
      typeof c.id !== "string" ||
      typeof c.text !== "string" ||
      !Number.isFinite(c.start) ||
      !Number.isFinite(c.end) ||
      c.start < 0 ||
      c.end <= c.start
    )
      throw new Error("Invalid caption");
    const { words: rawWords, ...rest } = c;
    const words =
      Array.isArray(rawWords) &&
      rawWords.length <= 2000 &&
      rawWords.every(
        (w) =>
          w &&
          typeof w.text === "string" &&
          Number.isFinite(w.start) &&
          Number.isFinite(w.end) &&
          w.end >= w.start,
      )
        ? rawWords.map((w) => ({ text: w.text.slice(0, 200), start: w.start, end: w.end }))
        : undefined;
    return { ...rest, text: c.text.slice(0, 10000), ...(words ? { words } : {}) };
  });
  const style = p.captionStyle;
  const markers = (Array.isArray(p.markers) ? p.markers : [])
    .filter(
      (m) =>
        m &&
        typeof m.id === "string" &&
        typeof m.name === "string" &&
        Number.isFinite(m.time) &&
        m.time >= 0 &&
        m.time <= duration,
    )
    .map((m) => ({ ...m, name: m.name.slice(0, 200) }));
  return {
    ...p,
    source: source ?? null,
    clips,
    captions,
    markers,
    exportSettings: settingsOf(p.exportSettings),
    segmentSeconds: bounded(p.segmentSeconds, 30, 0.5, 3600),
    burnIn: p.burnIn !== false,
    captionStyle: {
      size: bounded(style?.size, 4.2, 2, 9),
      color: hex(style?.color),
      bg: style?.bg !== false,
      y: bounded(style?.y, 0.7, 0.1, 0.95),
      weight: style?.weight === 600 ? 600 : 800,
      uppercase: style?.uppercase === true,
      animation:
        (["karaoke", "highlight", "pop", "reveal"] as const).find((a) => a === style?.animation) ??
        "none",
      accent: hex(style?.accent, "#c8ff3d"),
    },
  };
}
