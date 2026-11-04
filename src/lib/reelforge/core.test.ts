import { describe, expect, it } from "vitest";
import {
  segmentByDuration, clampRange, validateClip, splitClip, clipCaptions, toSRT,
  parseSubtitles, computeLayout, DEFAULT_FRAMING, makeClips,
} from "./core";

describe("segmentation", () => {
  it("covers the full source with a final short remainder", () => {
    expect(segmentByDuration(70, 30)).toEqual([[0, 30], [30, 60], [60, 70]]);
  });
  it("merges a sub-0.5s remainder into the previous clip", () => {
    expect(segmentByDuration(60.2, 30)).toEqual([[0, 30], [30, 60.2]]);
  });
  it("returns no clips for an invalid duration", () => {
    expect(segmentByDuration(0, 15)).toEqual([]);
    expect(segmentByDuration(NaN, 15)).toEqual([]);
  });
  it("custom 15s on a 45s source gives 3 clips", () => {
    expect(makeClips(45, 15)).toHaveLength(3);
  });
});

describe("range validation", () => {
  it("clamps out-of-bounds ranges", () => {
    expect(clampRange(-5, 200, 100)).toEqual([0, 100]);
  });
  it("never produces zero-length clips", () => {
    expect(clampRange(50, 50, 100)).toEqual([50, 50.5]);
    expect(clampRange(100, 100, 100)).toEqual([99.5, 100]);
  });
  it("rejects clips past the source end", () => {
    expect(validateClip({ start: 90, end: 101 }, 100)).toMatch(/after/);
    expect(validateClip({ start: 10, end: 10.2 }, 100)).toMatch(/at least/);
    expect(validateClip({ start: 10, end: 20 }, 100)).toBeNull();
  });
  it("refuses splits that would create sub-minimum clips", () => {
    const c = { id: "a", title: "A", start: 0, end: 10, framing: DEFAULT_FRAMING };
    expect(splitClip(c, 0.2)).toBeNull();
    const r = splitClip(c, 4)!;
    expect([r[0].start, r[0].end, r[1].start, r[1].end]).toEqual([0, 4, 4, 10]);
  });
});

describe("captions", () => {
  const caps = parseSubtitles(
    "1\n00:00:28,000 --> 00:00:32,500\nHello\n\n2\n00:00:40,000 --> 00:00:41,000\nOutside\n",
  );
  it("parses SRT", () => {
    expect(caps.map((c) => [c.start, c.end])).toEqual([[28, 32.5], [40, 41]]);
  });
  it("parses VTT", () => {
    expect(parseSubtitles("WEBVTT\n\n00:01.000 --> 00:02.500\n<b>Hi</b>")[0]).toMatchObject({ start: 1, end: 2.5, text: "Hi" });
  });
  it("exports clip-relative SRT, clipped to the clip range", () => {
    const rel = clipCaptions(caps, 30, 39);
    expect(toSRT(rel)).toBe("1\n00:00:00,000 --> 00:00:02,500\nHello\n");
  });
});

describe("crop layout", () => {
  it("fill 16:9 into 9:16 covers the full output height, centred", () => {
    const l = computeLayout(1920, 1080, 1080, 1920, DEFAULT_FRAMING);
    expect(l.dh).toBeCloseTo(1920);
    expect(l.dx).toBeCloseTo((1080 - l.dw) / 2);
  });
  it("is scale invariant between preview and export resolution", () => {
    const f = { ...DEFAULT_FRAMING, fx: 0.2, zoom: 1.5 };
    const a = computeLayout(1920, 1080, 1080, 1920, f);
    const b = computeLayout(1920, 1080, 540, 960, f);
    expect(b.dx * 2).toBeCloseTo(a.dx);
    expect(b.dw * 2).toBeCloseTo(a.dw);
  });
});
