import { describe, expect, it } from "vitest";
import {
  adjacentKey,
  audible,
  clearAnimation,
  keyOffsets,
  normalizeKeys,
  propAt,
  readKeyframes,
  scaleKeys,
  splitKeys,
  valueAt,
  withEase,
  withKey,
  withoutKey,
  type Keyframe,
} from "./keyframes";
import {
  addItem,
  changeFps,
  clipLevel,
  fresh,
  parseSequence,
  patchItem,
  splitItem,
  type Item,
  type Sequence,
} from "./model";

function seq(): Sequence {
  const s = fresh();
  s.assets = [
    {
      id: "a",
      name: "cam.mp4",
      kind: "video",
      size: 1,
      lastModified: 1,
      duration: 20,
      origin: 0,
      width: 1920,
      height: 1080,
      hasAudio: true,
      peaks: [],
    },
  ];
  return addItem(s, "a", "V1", 30);
}
const only = (s: Sequence) => s.items[0]!;

describe("valueAt", () => {
  const keys: Keyframe[] = [
    { f: 10, v: 0 },
    { f: 20, v: 1, ease: "smooth" },
    { f: 30, v: 0, ease: "hold" },
    { f: 40, v: 1 },
  ];
  it("holds the first/last value outside the keys and uses the base when unkeyed", () => {
    expect(valueAt(undefined, 0.7, 5)).toBe(0.7);
    expect(valueAt(keys, 0.7, -100)).toBe(0);
    expect(valueAt(keys, 0.7, 1000)).toBe(1);
  });
  it("interpolates linear, smooth and hold segments", () => {
    expect(valueAt(keys, 0, 15)).toBeCloseTo(0.5);
    expect(valueAt(keys, 0, 12.5)).toBeCloseTo(0.25); // linear
    expect(valueAt(keys, 0, 25)).toBeCloseTo(0.5); // smoothstep midpoint
    expect(valueAt(keys, 0, 22)).toBeCloseTo(1 - 0.2 * 0.2 * (3 - 0.4)); // eases out of 1
    expect(valueAt(keys, 0, 22)).toBeGreaterThan(1 - 0.2); // slower than linear at the start
    expect(valueAt(keys, 0, 39.9)).toBe(0); // hold until the next key
    expect(valueAt(keys, 0, 40)).toBe(1);
  });
  it("lands exactly on every key", () => {
    for (const k of keys) expect(valueAt(keys, 0, k.f)).toBe(k.v);
  });
});

describe("editing keys", () => {
  it("adds, replaces (keeping ease), sorts, clamps and removes", () => {
    let c = only(seq());
    c = { ...c, keys: withKey(c, "x", 20, 0.9) };
    c = { ...c, keys: withKey(c, "x", 5, 0.1) };
    c = { ...c, keys: withEase(c, "x", 20, "hold") };
    c = { ...c, keys: withKey(c, "x", 20, 7) }; // clamped to 1, ease kept
    expect(c.keys?.x).toEqual([
      { f: 5, v: 0.1 },
      { f: 20, v: 1, ease: "hold" },
    ]);
    c = { ...c, keys: withoutKey(c, "x", 5) };
    c = { ...c, keys: withoutKey(c, "x", 20) };
    expect(c.keys).toBeUndefined();
  });
  it("clearing animation keeps the value at the playhead", () => {
    let c = only(seq());
    c = { ...c, keys: withKey(c, "scale", 0, 1) };
    c = { ...c, keys: withKey(c, "scale", 10, 2) };
    c = { ...c, keys: withKey(c, "opacity", 0, 0.5) };
    const patch = clearAnimation(c, "scale", 5);
    expect(patch.scale).toBeCloseTo(1.5);
    expect(patch.keys).toEqual({ opacity: [{ f: 0, v: 0.5 }] });
  });
  it("lists markers and navigates within the clip only", () => {
    let c: Item = { ...only(seq()), frames: 50 };
    c = {
      ...c,
      keys: {
        x: [
          { f: -5, v: 0 },
          { f: 10, v: 1 },
          { f: 60, v: 0 },
        ],
        y: [
          { f: 10, v: 0 },
          { f: 30, v: 1 },
        ],
      },
    };
    expect(keyOffsets(c)).toEqual([10, 30]);
    expect(adjacentKey(c, "x", 10, 1)).toBeUndefined();
    expect(adjacentKey(c, "x", 20, -1)).toBe(10);
    expect(adjacentKey(c, "y", 10, 1)).toBe(30);
  });
  it("treats a clip with any audible volume key as audible", () => {
    const c = only(seq());
    expect(audible({ ...c, volume: 0 })).toBe(false);
    expect(
      audible({
        ...c,
        volume: 0,
        keys: {
          volume: [
            { f: 0, v: 0 },
            { f: 9, v: 0.2 },
          ],
        },
      }),
    ).toBe(true);
    expect(audible({ ...c, volume: 1, keys: { volume: [{ f: 0, v: 0 }] } })).toBe(false);
  });
});

describe("timeline operations keep the animation", () => {
  it("split: both halves play exactly the original curve", () => {
    let s = seq();
    const id = only(s).id;
    s = patchItem(s, id, {
      keys: {
        x: [
          { f: 0, v: 0, ease: "smooth" },
          { f: 40, v: 1 },
          { f: 80, v: 0.2, ease: "hold" },
          { f: 120, v: 0.6 },
        ],
        opacity: [
          { f: 20, v: 1 },
          { f: 100, v: 0 },
        ],
      },
    });
    const before = only(s);
    const after = splitItem(s, id, 30 + 50);
    const [head, tail] = after.items;
    for (let frame = 30; frame < 30 + before.frames; frame++) {
      const part = frame < tail!.start ? head! : tail!;
      expect(propAt(part, "x", frame)).toBeCloseTo(propAt(before, "x", frame), 12);
      expect(clipLevel(after, part, frame)).toBeCloseTo(clipLevel(s, before, frame), 12);
    }
    // Only the keys that shape each half are kept.
    expect(head!.keys?.x?.map((k) => k.f)).toEqual([0, 40, 80]);
    expect(tail!.keys?.x?.map((k) => k.f)).toEqual([-10, 30, 70]);
  });
  it("split leaves unanimated clips without keys", () => {
    const s = seq();
    const after = splitItem(s, only(s).id, 40);
    expect(after.items.every((c) => !("keys" in c))).toBe(true);
    expect(splitKeys(undefined, 5, 10)).toEqual([undefined, undefined]);
  });
  it("keys move with the clip", () => {
    let s = seq();
    const id = only(s).id;
    s = patchItem(s, id, {
      keys: {
        scale: [
          { f: 0, v: 1 },
          { f: 10, v: 2 },
        ],
      },
    });
    const moved = patchItem(s, id, { start: 300 });
    expect(propAt(only(moved), "scale", 305)).toBeCloseTo(1.5);
  });
  it("frame-rate change re-times keys", () => {
    let s = seq();
    s = patchItem(s, only(s).id, {
      keys: {
        x: [
          { f: 0, v: 0 },
          { f: 30, v: 1 },
        ],
      },
    });
    const at24 = changeFps(s, 24);
    expect(only(at24).keys?.x?.map((k) => k.f)).toEqual([0, 24]);
    expect(
      scaleKeys(
        {
          x: [
            { f: 1, v: 0 },
            { f: 2, v: 1 },
          ],
        },
        0.2,
      )?.x,
    ).toEqual([{ f: 0, v: 1 }]);
  });
  it("animated opacity and volume drive picture and sound levels", () => {
    let s = seq();
    const id = only(s).id;
    s = patchItem(s, id, {
      keys: {
        opacity: [
          { f: 0, v: 0 },
          { f: 10, v: 1 },
        ],
        volume: [
          { f: 0, v: 1 },
          { f: 10, v: 0 },
        ],
      },
    });
    expect(clipLevel(s, only(s), 35)).toBeCloseTo(0.5);
    expect(clipLevel(s, only(s), 32.5, true)).toBeCloseTo(0.75); // fractional frames for audio
  });
});

describe("stored keys", () => {
  it("parseSequence keeps valid keys and cleans malformed ones", () => {
    const s = seq();
    const raw = JSON.parse(JSON.stringify(s));
    raw.items[0].keys = {
      x: [
        { f: 10, v: 2 }, // clamped to 1
        { f: 0, v: 0.25, ease: "smooth" },
        { f: 1.5, v: 0.5 }, // not an integer frame
        { f: 3, v: "no" },
        { f: 4, v: 0.3, ease: "bounce" }, // unknown ease → linear
      ],
      rotation: [{ f: 0, v: 1 }], // unknown property
      y: "nope",
    };
    const parsed = only(parseSequence(raw));
    expect(parsed.keys).toEqual({
      x: [
        { f: 0, v: 0.25, ease: "smooth" },
        { f: 4, v: 0.3 },
        { f: 10, v: 1 },
      ],
    });
    raw.items[0].keys = { x: [] };
    expect("keys" in only(parseSequence(raw))).toBe(false);
    expect(readKeyframes([1, 2])).toBeUndefined();
  });
  it("normalizes duplicates (last wins) and caps key counts", () => {
    expect(
      normalizeKeys({
        x: [
          { f: 1, v: 0 },
          { f: 1, v: 0.5 },
        ],
      })?.x,
    ).toEqual([{ f: 1, v: 0.5 }]);
    const many = Array.from({ length: 250 }, (_, f) => ({ f, v: 0 }));
    expect(normalizeKeys({ x: many })?.x).toHaveLength(200);
  });
});
