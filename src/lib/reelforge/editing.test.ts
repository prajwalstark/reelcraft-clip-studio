import { describe, expect, it } from "vitest";
import { DEFAULT_FRAMING, newProject, splitClip, type Clip } from "./core";
import {
  audioGain,
  clipSRT,
  DEFAULT_AUDIO,
  DEFAULT_COLOR,
  exportSnapshot,
  outputDuration,
  outputSize,
  readProject,
  snapTime,
  timelineTime,
  videoFilter,
} from "./editing";

const clip: Clip = {
  id: "c",
  title: "Short",
  start: 10,
  end: 18,
  framing: { ...DEFAULT_FRAMING },
  speed: 2,
};
const project = () => ({
  ...newProject(),
  source: {
    name: "sample.mp4",
    size: 100,
    width: 1920,
    height: 1080,
    duration: 20,
    type: "video/mp4",
    lastModified: 0,
  },
  clips: [structuredClone(clip)],
});

describe("speed, audio and output timing", () => {
  it("clips and retimes subtitle cues to the output timeline", () => {
    const caps = [
      { id: "a", start: 8, end: 12, text: "First" },
      { id: "b", start: 16, end: 21, text: "Last" },
    ];
    expect(outputDuration(clip)).toBe(4);
    expect(clipSRT(caps, clip)).toBe(
      "1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\n00:00:03,000 --> 00:00:04,000\nLast\n",
    );
    expect(outputDuration({ ...clip, speed: 0.5 })).toBe(16);
  });
  it("fades in output seconds and remains silent outside the clip", () => {
    const c = { ...clip, audio: { ...DEFAULT_AUDIO, volume: 0.8, fadeIn: 1, fadeOut: 1 } };
    expect(audioGain(c, 10)).toBe(0);
    expect(audioGain(c, 11)).toBeCloseTo(0.4);
    expect(audioGain(c, 14)).toBe(0.8);
    expect(audioGain(c, 17)).toBeCloseTo(0.4);
    expect(audioGain(c, 18)).toBe(0);
    expect(audioGain({ ...c, audio: { ...c.audio, muted: true } }, 14)).toBe(0);
  });
  it("scales overlapping fades to fit short outputs", () => {
    const c = { ...clip, audio: { ...DEFAULT_AUDIO, fadeIn: 10, fadeOut: 10 } };
    expect(audioGain(c, 14)).toBe(1);
    expect(audioGain(c, 12)).toBe(0.5);
  });
  it("preserves processing settings when splitting", () => {
    const c = {
      ...clip,
      color: { ...DEFAULT_COLOR, brightness: 0.5 },
      audio: { ...DEFAULT_AUDIO, muted: true },
    };
    for (const part of splitClip(c, 14)!) {
      expect(part.speed).toBe(2);
      expect(part.color?.brightness).toBe(0.5);
      expect(part.audio?.muted).toBe(true);
    }
  });
});

describe("project and export isolation", () => {
  it("upgrades legacy v1 projects and round-trips new settings", () => {
    const p = project();
    delete p.clips[0]!.speed;
    const loaded = readProject(JSON.parse(JSON.stringify(p)));
    expect(loaded.clips[0]).toMatchObject({
      speed: 1,
      color: DEFAULT_COLOR,
      audio: DEFAULT_AUDIO,
      overlay: { enabled: false },
    });
    loaded.markers = [{ id: "m", name: "Hook", time: 12 }];
    loaded.exportSettings = { resolution: 720, fps: 24 };
    loaded.clips[0]!.speed = 1.5;
    expect(readProject(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded);
  });
  it("rejects malformed or out-of-source clips and normalizes nonfinite effects", () => {
    const p = project();
    p.clips[0]!.end = 21;
    expect(() => readProject(p)).toThrow("Invalid clip");
    p.clips[0]!.end = 18;
    p.clips[0]!.color = { ...DEFAULT_COLOR, brightness: NaN };
    expect(readProject(p).clips[0]!.color?.brightness).toBe(1);
    p.clips.push(p.clips[0]!);
    expect(() => readProject(p)).toThrow("duplicate");
  });
  it("keeps queued render settings and SRT stable after project edits", () => {
    const p = project();
    p.captions = [{ id: "a", text: "Original", start: 10, end: 12 }];
    p.exportSettings = { resolution: 720, fps: 24 };
    const snapshot = exportSnapshot(p, p.clips[0]!);
    p.clips[0]!.speed = 0.5;
    p.captions[0]!.text = "Changed";
    p.captionStyle.color = "#ff0000";
    p.exportSettings.resolution = 1080;
    expect(snapshot.clip.speed).toBe(2);
    expect(snapshot.captions?.[0]?.text).toBe("Original");
    expect(snapshot.style.color).toBe("#ffffff");
    expect(snapshot.settings.resolution).toBe(720);
    expect(snapshot.srt).toContain("00:00:01,000\nOriginal");
    p.burnIn = false;
    expect(exportSnapshot(p, p.clips[0]!).captions).toBeNull();
    expect(exportSnapshot(p, p.clips[0]!).srt).toContain("Changed");
  });
});

describe("preview/export and timeline geometry", () => {
  it("scales blur between preview and export, and supports bypass", () => {
    const c = { ...clip, color: { ...DEFAULT_COLOR, blur: 6 } };
    expect(videoFilter(c, 540)).toContain("blur(3px)");
    expect(videoFilter(c, 1080)).toContain("blur(6px)");
    expect(videoFilter({ ...c, color: { ...c.color, enabled: false } }, 1080)).toBe("none");
  });
  it("selects correct dimensions and target frame rate", () => {
    expect(outputSize(clip, { resolution: 720, fps: 24 })).toMatchObject({
      w: 720,
      h: 1280,
      fps: 24,
    });
    expect(outputSize({ ...clip, framing: { ...clip.framing, aspect: "16:9" } })).toMatchObject({
      w: 1920,
      h: 1080,
      fps: 30,
    });
  });
  it("maps a scrolled zoomed timeline to source seconds and snaps only nearby", () => {
    expect(timelineTime(300, -200, 1000, 20)).toBe(10);
    expect(timelineTime(-300, -200, 1000, 20)).toBe(0);
    expect(snapTime(10.1, [0, 10, 10.15, 20], 0.2)).toBe(10.15);
    expect(snapTime(10.4, [10], 0.2)).toBe(10.4);
  });
});

describe("word-by-word caption data", () => {
  const base = {
    ...newProject(),
    source: {
      name: "s.mp4",
      size: 1,
      type: "video/mp4",
      lastModified: 0,
      duration: 10,
      width: 640,
      height: 360,
    },
  };
  it("keeps valid word timings and animation settings, drops malformed ones", () => {
    const p = readProject({
      ...base,
      captions: [
        {
          id: "a",
          start: 0,
          end: 1,
          text: "hi there",
          words: [
            { text: "hi", start: 0, end: 0.4 },
            { text: "there", start: 0.4, end: 1 },
          ],
        },
        { id: "b", start: 2, end: 3, text: "bad", words: [{ text: "bad", start: "x", end: 3 }] },
      ],
      captionStyle: { ...base.captionStyle, animation: "pop", accent: "#ff00aa" },
    });
    expect(p.captions[0]!.words).toHaveLength(2);
    expect(p.captions[1]!.words).toBeUndefined();
    expect(p.captionStyle).toMatchObject({ animation: "pop", accent: "#ff00aa" });
  });
  it("defaults older projects to no animation", () => {
    const { animation: _a, accent: _b, ...legacyStyle } = base.captionStyle;
    const p = readProject({ ...base, captionStyle: { ...legacyStyle, animation: "spin" } });
    expect(p.captionStyle.animation).toBe("none");
    expect(p.captionStyle.accent).toBe("#c8ff3d");
  });
});
