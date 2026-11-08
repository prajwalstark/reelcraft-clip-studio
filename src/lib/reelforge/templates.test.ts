import { describe, expect, it } from "vitest";
import { DEFAULT_CAPTION_STYLE, DEFAULT_FRAMING, newProject, type Clip } from "./core";
import { exportSnapshot, readProject } from "./editing";
import {
  applyVideoTemplate,
  normalizeTemplate,
  templateCaptionStyle,
  templateFrame,
  VIDEO_TEMPLATES,
} from "./templates";
const clip: Clip = {
  id: "a",
  title: "My clip",
  start: 8,
  end: 20,
  speed: 2,
  framing: { ...DEFAULT_FRAMING, fx: 0.2 },
  audio: { volume: 0.6, muted: false, fadeIn: 1, fadeOut: 1 },
};
describe("editable native templates", () => {
  it("applies all five styles without changing the source range, framing, speed or audio", () => {
    const before = structuredClone(clip);
    expect(VIDEO_TEMPLATES).toHaveLength(5);
    for (const preset of VIDEO_TEMPLATES) {
      const applied = applyVideoTemplate(clip, preset.id);
      expect(applied).toMatchObject({
        start: 8,
        end: 20,
        speed: 2,
        framing: clip.framing,
        audio: clip.audio,
      });
      expect(applied.overlay?.end).toBe(Math.min(20, 8 + preset.titleSeconds * 2));
      expect(applied.template?.id).toBe(preset.id);
    }
    expect(clip).toEqual(before);
  });
  it("clamps opening titles to short clips and preserves existing title text", () => {
    const c = applyVideoTemplate({ ...clip, end: 8.5 }, "weekend");
    expect(c.overlay?.end).toBe(8.5);
    c.overlay!.text = "My custom hook";
    expect(applyVideoTemplate(c, "prism").overlay?.text).toBe("My custom hook");
  });
  it("uses output seconds for rhythm and title animation at every playback speed", () => {
    const fast = applyVideoTemplate(clip, "rhythm");
    const slow = applyVideoTemplate({ ...clip, start: 0, end: 12, speed: 1 }, "rhythm");
    const a = templateFrame(fast, 9)!,
      b = templateFrame(slow, 0.5)!;
    expect(a.seconds).toBe(b.seconds);
    expect(a.zoom).toBeCloseTo(b.zoom);
    expect(a.titleAlpha).toBeCloseTo(b.titleAlpha);
    expect(templateFrame(fast, fast.overlay!.end)!.titleAlpha).toBe(0);
    expect(
      templateFrame({ ...fast, template: { ...fast.template!, enabled: false } }, 9),
    ).toBeNull();
  });
  it("keeps motion bounded for long sources and every template", () => {
    for (const p of VIDEO_TEMPLATES)
      for (const time of [-1, 8, 8.1, 12, 20, 10000]) {
        const frame = templateFrame(applyVideoTemplate(clip, p.id), time)!;
        expect(frame.zoom).toBeGreaterThanOrEqual(1);
        expect(frame.zoom).toBeLessThanOrEqual(1.12);
        expect(frame.titleAlpha).toBeGreaterThanOrEqual(0);
        expect(frame.titleAlpha).toBeLessThanOrEqual(1);
      }
  });
  it("round-trips customizations and isolates queued exports from later changes", () => {
    const c = applyVideoTemplate(clip, "prism");
    c.template!.subtitle = "Bengaluru nights";
    c.template!.accent = "#ffcc00";
    const p = {
      ...newProject(),
      source: {
        name: "x.mp4",
        type: "video/mp4",
        size: 100,
        lastModified: 0,
        width: 640,
        height: 360,
        duration: 20,
      },
      clips: [c],
    };
    const loaded = readProject(JSON.parse(JSON.stringify(p)));
    expect(loaded.clips[0]!.template).toEqual(c.template);
    const job = exportSnapshot(p, c);
    c.template!.subtitle = "Changed";
    c.color!.contrast = 0.5;
    expect(job.clip.template!.subtitle).toBe("Bengaluru nights");
    expect(job.clip.color!.contrast).toBe(1.15);
  });
  it("normalizes malformed imported settings and ignores unknown presets", () => {
    expect(normalizeTemplate({ id: "untrusted" })).toBeNull();
    expect(
      normalizeTemplate({
        id: "weekend",
        intensity: NaN,
        tempo: 999,
        accent: "url(bad)",
        subtitle: "x".repeat(200),
      }),
    ).toMatchObject({ intensity: 0.6, tempo: 180, accent: "#f5d4a2", subtitle: "x".repeat(120) });
    expect(normalizeTemplate(undefined)).toBeNull();
  });
  it("only overrides this clip’s caption appearance when explicitly enabled", () => {
    const c = applyVideoTemplate(clip, "momentum");
    expect(templateCaptionStyle(c, DEFAULT_CAPTION_STYLE)).toBe(DEFAULT_CAPTION_STYLE);
    c.template!.captionLook = true;
    expect(templateCaptionStyle(c, DEFAULT_CAPTION_STYLE)).toMatchObject({
      color: "#d4ff45",
      uppercase: true,
    });
    expect(DEFAULT_CAPTION_STYLE.color).toBe("#ffffff");
  });
});
