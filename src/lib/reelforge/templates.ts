import type { CaptionStyle, Clip } from "./core";
import type { ColorSettings } from "./editing";

export type TemplateId = "weekend" | "rhythm" | "momentum" | "prism" | "spotlight";
export interface TemplateSettings {
  id: TemplateId;
  enabled: boolean;
  accent: string;
  subtitle: string;
  intensity: number;
  tempo: number;
  captionLook: boolean;
}
export interface VideoTemplate {
  id: TemplateId;
  name: string;
  category: string;
  description: string;
  title: string;
  subtitle: string;
  accent: string;
  titleY: number;
  titleSize: number;
  titleSeconds: number;
  color: ColorSettings;
  inspiration: string;
  sourceUrl: string;
}
const neutral: ColorSettings = {
  enabled: true,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue: 0,
  blur: 0,
};
/** Original Reelcraft presets. Links acknowledge inspiration, not template ownership or asset reuse. */
export const VIDEO_TEMPLATES: readonly VideoTemplate[] = [
  {
    id: "weekend",
    name: "Weekend Journal",
    category: "Lifestyle",
    description:
      "A gentle push-in, warm color and a journal-style border with an understated title.",
    title: "A WEEKEND TO REMEMBER",
    subtitle: "Little moments, kept forever.",
    accent: "#f5d4a2",
    titleY: 0.3,
    titleSize: 4.8,
    titleSeconds: 4,
    color: { ...neutral, brightness: 1.03, contrast: 1.06, saturation: 0.88 },
    inspiration: "weekend story",
    sourceUrl: "https://www.capcut.com/template-detail/weekend-story/7547228528903720253",
  },
  {
    id: "rhythm",
    name: "Rhythm Frames",
    category: "Montage look",
    description:
      "Smooth rhythmic zoom and a framed composition. Adjust the pulse tempo to suit your own audio.",
    title: "LIFE IN FRAMES",
    subtitle: "Your people. Your places. Your story.",
    accent: "#c4b5fd",
    titleY: 0.5,
    titleSize: 6,
    titleSeconds: 3,
    color: { ...neutral, contrast: 1.12, saturation: 1.1 },
    inspiration: "LF",
    sourceUrl: "https://www.capcut.com/template-detail/LF/7493918549925203253",
  },
  {
    id: "momentum",
    name: "Momentum",
    category: "Energy",
    description:
      "A confident push-in, bold opening title and a moving accent line for an energetic hook.",
    title: "MAKE IT COUNT",
    subtitle: "This is your moment.",
    accent: "#d4ff45",
    titleY: 0.35,
    titleSize: 7,
    titleSeconds: 2.5,
    color: { ...neutral, contrast: 1.18, saturation: 1.15 },
    inspiration: "trending video",
    sourceUrl: "https://www.capcut.com/id-id/template-detail/trending-video/7606590613190053125",
  },
  {
    id: "prism",
    name: "Prism Reveal",
    category: "Reveal",
    description:
      "An opening accent sweep, rising title and clean corner marks. A reveal effect within your clip.",
    title: "A NEW PERSPECTIVE",
    subtitle: "See it differently.",
    accent: "#67e8f9",
    titleY: 0.5,
    titleSize: 5.5,
    titleSeconds: 3,
    color: { ...neutral, contrast: 1.15, saturation: 0.95 },
    inspiration: "EPIC TRANSITION",
    sourceUrl: "https://www.capcut.com/template-detail/EPIC-TRANSITION/7628152739305917716",
  },
  {
    id: "spotlight",
    name: "Slow Spotlight",
    category: "Portrait",
    description:
      "A slow zoom-out, soft dark edges and a minimal title. Set playback speed separately in Clip.",
    title: "IN YOUR ELEMENT",
    subtitle: "Take a moment.",
    accent: "#fda4af",
    titleY: 0.65,
    titleSize: 5.2,
    titleSeconds: 4,
    color: { ...neutral, brightness: 1.02, contrast: 1.08, saturation: 0.8 },
    inspiration: "Trending template",
    sourceUrl: "https://www.capcut.com/template-detail/Trending-template/7687835534021971220",
  },
];
const finite = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
const unit = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (n: number) => {
  const x = unit(n);
  return x * x * (3 - 2 * x);
};
export const findTemplate = (id: string) => VIDEO_TEMPLATES.find((t) => t.id === id);
export function normalizeTemplate(value: unknown): TemplateSettings | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Partial<TemplateSettings>,
    preset = findTemplate(String(s.id));
  if (!preset) return null;
  return {
    id: preset.id,
    enabled: s.enabled !== false,
    accent:
      typeof s.accent === "string" && /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : preset.accent,
    subtitle: typeof s.subtitle === "string" ? s.subtitle.slice(0, 120) : preset.subtitle,
    intensity: finite(s.intensity, 0.6, 0, 1),
    tempo: finite(s.tempo, 100, 40, 180),
    captionLook: s.captionLook === true,
  };
}
/** Applying is a style edit, not a trim or media replacement. Each target gets independent settings. */
export function applyVideoTemplate(clip: Clip, id: TemplateId): Clip {
  const p = findTemplate(id);
  if (!p) return clip;
  const speed = finite(clip.speed, 1, 0.5, 2);
  return {
    ...clip,
    color: { ...p.color },
    template: normalizeTemplate({ id, captionLook: false })!,
    overlay: {
      enabled: true,
      text: clip.overlay?.enabled && clip.overlay.text ? clip.overlay.text : p.title,
      start: clip.start,
      end: Math.min(clip.end, clip.start + p.titleSeconds * speed),
      size: p.titleSize,
      x: 0.5,
      y: p.titleY,
      color: "#ffffff",
      background: p.id === "rhythm",
    },
  };
}
/** Shared deterministic output-time animation for preview and real exports. */
export function templateFrame(clip: Clip, sourceTime: number) {
  const settings = normalizeTemplate(clip.template);
  if (!settings?.enabled) return null;
  const speed = finite(clip.speed, 1, 0.5, 2),
    duration = Math.max(0.001, (clip.end - clip.start) / speed);
  const seconds = Math.max(0, (sourceTime - clip.start) / speed),
    progress = unit(seconds / duration);
  const strength = settings.intensity;
  const pulse = 0.5 - 0.5 * Math.cos((2 * Math.PI * seconds * settings.tempo) / 60);
  const zoom =
    1 +
    strength *
      (settings.id === "rhythm"
        ? 0.07 * pulse
        : settings.id === "spotlight"
          ? 0.1 * (1 - progress)
          : settings.id === "momentum"
            ? 0.12 * smooth(seconds / 1.8)
            : 0.06 * progress);
  const titleStart = clip.overlay?.start ?? clip.start,
    titleEnd = clip.overlay?.end ?? clip.end;
  const titleDuration = Math.max(0.001, (titleEnd - titleStart) / speed),
    titleTime = (sourceTime - titleStart) / speed;
  const fade = Math.min(0.45, titleDuration / 3);
  const entry = smooth(titleTime / fade),
    exit = smooth((titleDuration - titleTime) / fade);
  return {
    settings,
    seconds,
    progress,
    zoom,
    titleAlpha: entry * exit,
    titleOffsetY: (1 - entry) * 0.035 * strength,
    sweep: smooth(seconds / 0.8),
  };
}
export function templateCaptionStyle(clip: Clip | undefined, fallback: CaptionStyle): CaptionStyle {
  const s = normalizeTemplate(clip?.template);
  return s?.enabled && s.captionLook
    ? {
        ...fallback,
        color: s.accent,
        bg: true,
        weight: 800,
        uppercase: s.id === "momentum",
        size: s.id === "momentum" ? 5 : 4.2,
        y: 0.75,
      }
    : fallback;
}
