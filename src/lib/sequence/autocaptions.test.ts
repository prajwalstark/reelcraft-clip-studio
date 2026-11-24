import { describe, expect, it } from "vitest";
import type { Caption } from "@/lib/reelforge/core";
import { captionsIn, captionsToTitles, unlinkedAudio, wrapCaption } from "./autocaptions";
import { addItem, addTitle, fresh, parseSequence, type Sequence } from "./model";
import { DEFAULT_TITLE, titleAnimAt, titleLayout } from "./titles";

function seq(): Sequence {
  const s = fresh();
  s.assets = [
    {
      id: "talk",
      name: "talk.mp4",
      kind: "video",
      size: 1,
      lastModified: 1,
      duration: 60,
      origin: 0,
      width: 1920,
      height: 1080,
      hasAudio: true,
      peaks: [],
    },
  ];
  return addItem(s, "talk", "V1", 0); // 60 s at 30 fps = 1800 frames
}
const cue = (start: number, end: number, text: string): Caption => {
  const words = text.split(" ");
  const step = (end - start) / words.length;
  return {
    id: text,
    start,
    end,
    text,
    words: words.map((w, i) => ({ text: w, start: start + i * step, end: start + (i + 1) * step })),
  };
};
const opts = {
  look: "subtitle" as const,
  reveal: "words" as const,
  track: "V3" as const,
  start: 0,
  end: 1800,
  replace: true,
};

describe("captionsToTitles", () => {
  it("adds one caption title per cue, in frames, with spoken word times", () => {
    const { sequence: s, added } = captionsToTitles(
      seq(),
      [cue(1, 2.5, "Hello there"), cue(3, 4, "General Kenobi")],
      opts,
    );
    expect(added).toBe(2);
    const caps = s.items.filter((c) => c.title?.caption);
    expect(caps.map((c) => [c.track, c.start, c.frames])).toEqual([
      ["V3", 30, 45],
      ["V3", 90, 30],
    ]);
    const t = caps[0]!.title!;
    expect(t).toMatchObject({ text: "Hello there", caption: true, animIn: { type: "words" } });
    expect(t.wordTimes).toEqual([0, 0.75]); // seconds from the caption's start
    expect(caps[0]!.y).toBeCloseTo(0.86);
  });
  it("never overlaps the next caption and stays inside the range", () => {
    const { sequence: s } = captionsToTitles(
      seq(),
      [cue(0.5, 3.2, "one two"), cue(3, 6, "three four"), cue(9, 12, "five six")],
      { ...opts, start: 30, end: 300 },
    );
    const caps = s.items.filter((c) => c.title?.caption);
    expect(caps.map((c) => [c.start, c.start + c.frames])).toEqual([
      [30, 90], // starts at the range start, ends where the next begins
      [90, 180],
      [270, 300], // clipped to the range end
    ]);
  });
  it("replaces earlier auto-captions on that track in the range, keeping other titles", () => {
    let s = captionsToTitles(seq(), [cue(1, 2, "old one")], opts).sequence;
    s = addTitle(s, 30, { track: "V2" });
    s = captionsToTitles(s, [cue(1, 2, "new one")], opts).sequence;
    expect(s.items.filter((c) => c.title).map((c) => c.title!.text)).toEqual([
      "Your title",
      "new one",
    ]);
    const kept = captionsToTitles(s, [cue(5, 6, "more")], { ...opts, replace: false }).sequence;
    expect(captionsIn(kept, "V3", 0, 1800)).toHaveLength(2);
  });
  it("whole-caption reveal fades the line in instead", () => {
    const { sequence: s } = captionsToTitles(seq(), [cue(1, 2, "Hi")], {
      ...opts,
      reveal: "line",
    });
    expect(s.items[1]!.title!.animIn).toEqual({ type: "fade", duration: 0.12 });
  });
  it("refuses locked tracks, audio tracks and going past the clip limit", () => {
    const s = seq();
    s.tracks = s.tracks.map((t) => (t.id === "V3" ? { ...t, locked: true } : t));
    expect(() => captionsToTitles(s, [cue(1, 2, "x")], opts)).toThrow(/locked/);
    expect(() => captionsToTitles(seq(), [cue(1, 2, "x")], { ...opts, track: "A1" })).toThrow(
      /video track/,
    );
    const many = Array.from({ length: 220 }, (_, i) => cue(i * 0.2, i * 0.2 + 0.2, `w${i}`));
    expect(() => captionsToTitles(seq(), many, opts)).toThrow(/199 more clips fit/);
  });
  it("captions survive save and load with their timings", () => {
    const { sequence: s } = captionsToTitles(seq(), [cue(1, 2.5, "Hello there")], opts);
    const back = parseSequence(JSON.parse(JSON.stringify(s)));
    expect(back.items[1]!.title).toEqual(s.items[1]!.title);
  });
});

describe("wrapCaption", () => {
  it("wraps long captions to fit the frame and keeps every word", () => {
    const text = "this is a fairly long caption that will not fit on one line";
    const title = { ...DEFAULT_TITLE, ...{ size: 0.05 }, text };
    const wrapped = wrapCaption(title, 608, 1080); // a 9:16 frame at 1080 high
    expect(wrapped.split("\n").length).toBeGreaterThan(1);
    expect(wrapped.replace(/\n/g, " ")).toBe(text);
    for (const line of wrapped.split("\n"))
      expect(titleLayout({ ...title, text: line }, 1080).w).toBeLessThanOrEqual(608 * 0.88);
    expect(wrapCaption({ ...title, text: "short" }, 1920, 1080)).toBe("short");
  });
});

describe("spoken word-by-word reveal", () => {
  it("shows each word when it's spoken, then the whole caption", () => {
    const t = {
      ...DEFAULT_TITLE,
      text: "one two three",
      wordTimes: [0, 0.5, 1.2],
      animIn: { type: "words" as const, duration: 0.3 },
    };
    const at = (sec: number) => titleAnimAt(t, sec * 30, 60, 30).reveal;
    expect(at(0)).toEqual({ mode: "words", progress: 0 });
    expect(at(0.06)!.progress).toBeCloseTo(0.5); // first word half-way through its fade
    expect(at(0.6)!.progress).toBeCloseTo(1 + 0.1 / 0.12);
    expect(at(1.0)).toEqual({ mode: "words", progress: 2 });
    expect(at(1.5)).toBeUndefined(); // all words up: full text
  });
});

describe("unlinkedAudio", () => {
  it("lists clips with sound in the range whose files aren't linked", () => {
    const s = seq();
    expect(unlinkedAudio(s, new Map(), 0, 100).map((c) => c.assetId)).toEqual(["talk"]);
    expect(unlinkedAudio(s, new Map([["talk", new File([], "t")]]), 0, 100)).toEqual([]);
    expect(unlinkedAudio(s, new Map(), 1800, 1900)).toEqual([]);
  });
});
