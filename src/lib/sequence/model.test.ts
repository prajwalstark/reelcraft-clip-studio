import { describe, it, expect } from "vitest";
import {
  fresh,
  addItem,
  patchItem,
  splitItem,
  deleteItem,
  crossfade,
  clipLevel,
  changeFps,
  parseSequence,
  snapFrame,
  totalFrames,
  type Sequence,
} from "./model";
function fixture(): Sequence {
  const s = fresh();
  s.assets = [
    {
      id: "source",
      name: "camera.mp4",
      kind: "video",
      size: 100,
      lastModified: 1,
      duration: 10,
      origin: 2,
      width: 1920,
      height: 1080,
      hasAudio: true,
      peaks: [0.5],
    },
  ];
  return s;
}
function pair() {
  let s = addItem(fixture(), "source", "V1", 0);
  s = addItem(s, "source", "V1", 300);
  return s;
}
describe("sequence editing", () => {
  it("split keeps linked audio source time and frame boundaries", () => {
    const s = addItem(fixture(), "source", "V1", 30),
      next = splitItem(s, s.items[0]!.id, 105);
    expect(next.items.map((c) => [c.start, c.frames, c.sourceIn])).toEqual([
      [30, 75, 0],
      [105, 225, 2.5],
    ]);
    expect(totalFrames(next)).toBe(330);
  });
  it("ripple deletes only the selected track", () => {
    let s = pair();
    s = addItem(s, "source", "A1", 300);
    const next = deleteItem(s, s.items[0]!.id, true);
    expect(next.items.map((c) => [c.track, c.start])).toEqual([
      ["V1", 0],
      ["A1", 300],
    ]);
  });
  it("rejects ripple on overlaps and locked edits", () => {
    const s = pair(),
      second = s.items[1]!;
    const overlap = patchItem(s, second.id, { start: 200 });
    expect(() => deleteItem(overlap, overlap.items[0]!.id, true)).toThrow("non-overlapping");
    s.tracks[0]!.locked = true;
    expect(() => splitItem(s, s.items[0]!.id, 100)).toThrow("locked");
    expect(() => patchItem(s, second.id, { track: "V2" })).toThrow("locked");
  });
  it("crossfades complementary audio without double dimming the picture", () => {
    const s = pair(),
      next = crossfade(s, s.items[1]!.id);
    const [a, b] = next.items;
    expect(b!.start).toBe(285);
    expect(clipLevel(next, a!, 292.5, true) + clipLevel(next, b!, 292.5, true)).toBeCloseTo(1);
    expect(clipLevel(next, a!, 292.5)).toBe(1);
    expect(clipLevel(next, b!, 292.5)).toBeCloseTo(0.5);
  });
  it("clears invalid transitions when a clip moves", () => {
    let s = pair();
    s = crossfade(s, s.items[1]!.id);
    s = patchItem(s, s.items[1]!.id, { start: 400 });
    expect(s.items[1]!.transition).toBeUndefined();
  });
  it("protects source ranges and the 180 second limit", () => {
    const s = pair();
    expect(() => patchItem(s, s.items[0]!.id, { sourceIn: 5 })).toThrow("source media");
    expect(() => patchItem(s, s.items[0]!.id, { start: 5400 })).toThrow("limit");
  });
  it("changing fps preserves source in and valid fades", () => {
    let s = addItem(fixture(), "source", "V1", 0);
    s = patchItem(s, s.items[0]!.id, { frames: 3, fadeIn: 1, fadeOut: 2, sourceIn: 2 });
    s = changeFps(s, 24);
    expect(() => parseSequence(s)).not.toThrow();
    expect(s.items[0]!.sourceIn).toBe(2);
  });
  it("snap only within tolerance and excludes dragged clip", () => {
    const s = pair();
    expect(snapFrame(s, 297)).toBe(300);
    expect(snapFrame(s, 296.2)).toBe(296);
    expect(snapFrame(s, 299, s.items[0]!.id)).toBe(300);
  });
  it("rejects malformed projects, foreign tracks and NaN", () => {
    const s = pair();
    expect(parseSequence(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(() => parseSequence({ ...s, items: [{ ...s.items[0], volume: NaN }] })).toThrow();
    expect(() => parseSequence({ ...s, tracks: [] })).toThrow();
    expect(() => parseSequence({ ...s, items: [{ ...s.items[0], track: "V9" }] })).toThrow();
  });
  it("mute affects audio while hide affects only the picture", () => {
    const s = pair();
    s.tracks[0]!.muted = true;
    expect(clipLevel(s, s.items[0]!, 30, true)).toBe(0);
    expect(clipLevel(s, s.items[0]!, 30)).toBe(1);
    s.tracks[0]!.hidden = true;
    expect(clipLevel(s, s.items[0]!, 30)).toBe(0);
  });
});
