import { describe, expect, it } from "vitest";
import { addItem, clipRect, fresh, patchItem, type Sequence } from "./model";
import { valuesPatch } from "./keyframes";
import { canTransform, hitTest, scaleFromDrag, snapMove } from "./transform";

function seq(): Sequence {
  let s = fresh();
  s.assets = [
    {
      id: "wide",
      name: "wide.mp4",
      kind: "video",
      size: 1,
      lastModified: 1,
      duration: 10,
      origin: 0,
      width: 1920,
      height: 1080,
      hasAudio: false,
      peaks: [],
    },
  ];
  s = addItem(s, "wide", "V1", 0);
  s = addItem(s, "wide", "V2", 0);
  return patchItem(s, s.items[1]!.id, { scale: 0.5, x: 0.75, y: 0.25 });
}

describe("clipRect", () => {
  it("places a clip by its centre, fit and scale", () => {
    const s = seq();
    const [v1, v2] = s.items;
    expect(clipRect(s, v1!, 0, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(clipRect(s, v2!, 0, 1920, 1080)).toEqual({ x: 960, y: 0, w: 960, h: 540 });
  });
  it("follows animated position and scale", () => {
    let s = seq();
    const v2 = s.items[1]!;
    s = patchItem(s, v2.id, {
      keys: {
        x: [
          { f: 0, v: 0.25 },
          { f: 10, v: 0.75 },
        ],
      },
    });
    expect(clipRect(s, s.items[1]!, 5, 1920, 1080).x).toBeCloseTo(960 - 480);
  });
});

describe("hitTest", () => {
  it("picks the topmost clip under the point", () => {
    const s = seq();
    expect(hitTest(s, 0, 1920, 1080, 1400, 200)?.track).toBe("V2");
    expect(hitTest(s, 0, 1920, 1080, 200, 800)?.track).toBe("V1");
    expect(hitTest(s, 400, 1920, 1080, 200, 800)).toBeUndefined(); // past the clips
  });
  it("skips hidden tracks", () => {
    const s = seq();
    s.tracks = s.tracks.map((t) => (t.id === "V2" ? { ...t, hidden: true } : t));
    expect(hitTest(s, 0, 1920, 1080, 1400, 200)?.track).toBe("V1");
  });
});

describe("canTransform", () => {
  it("needs an unlocked, visible video clip under the playhead", () => {
    const s = seq();
    const v2 = s.items[1]!;
    expect(canTransform(s, v2, 0)).toBe(true);
    expect(canTransform(s, v2, v2.frames)).toBe(false);
    expect(canTransform(s, undefined, 0)).toBe(false);
    s.tracks = s.tracks.map((t) => (t.id === "V2" ? { ...t, locked: true } : t));
    expect(canTransform(s, v2, 0)).toBe(false);
  });
});

describe("snapMove", () => {
  it("snaps the centre to the canvas centre and reports the guide", () => {
    const r = snapMove(965, 300, 400, 200, 1920, 1080, 10);
    expect(r.x).toBe(0.5);
    expect(r.guidesX).toEqual([960]);
    expect(r.guidesY).toEqual([]);
    expect(r.y).toBeCloseTo(300 / 1080);
  });
  it("snaps edges to the frame edges", () => {
    // Left edge at 6 → 0; bottom edge at 1076 → 1080.
    const r = snapMove(206, 976, 400, 200, 1920, 1080, 10);
    expect(r.x * 1920).toBeCloseTo(200);
    expect(r.y * 1080).toBeCloseTo(980);
    expect(r.guidesX).toEqual([0]);
    expect(r.guidesY).toEqual([1080]);
  });
  it("moves freely without snapping and clamps the centre onto the canvas", () => {
    expect(snapMove(965, 300, 400, 200, 1920, 1080, 10, false).x * 1920).toBeCloseTo(965);
    const off = snapMove(-500, 5000, 400, 200, 1920, 1080, 10);
    expect([off.x, off.y]).toEqual([0, 1]);
  });
});

describe("scaleFromDrag", () => {
  const c = { x: 100, y: 100 };
  it("scales with the distance from the centre", () => {
    expect(scaleFromDrag(0.5, c, { x: 200, y: 200 }, { x: 300, y: 300 })).toBeCloseTo(1); // snapped
    expect(scaleFromDrag(0.5, c, { x: 200, y: 200 }, { x: 300, y: 300 }, false)).toBeCloseTo(1);
    expect(scaleFromDrag(1, c, { x: 200, y: 100 }, { x: 250, y: 100 })).toBeCloseTo(1.5);
    expect(scaleFromDrag(1, c, { x: 200, y: 100 }, { x: 101, y: 100 })).toBe(0.1);
    expect(scaleFromDrag(1, c, { x: 200, y: 100 }, { x: 900, y: 100 })).toBe(3);
  });
});

describe("valuesPatch", () => {
  it("changes static values, or keys animated ones at the playhead", () => {
    const s = seq();
    const v2 = s.items[1]!;
    expect(valuesPatch(v2, 4, { x: 0.3, y: 2 })).toEqual({ x: 0.3, y: 1 });
    const keyed = { ...v2, keys: { x: [{ f: 0, v: 0.2 }] } };
    expect(valuesPatch(keyed, 4, { x: 0.3, y: 0.4 })).toEqual({
      y: 0.4,
      keys: {
        x: [
          { f: 0, v: 0.2 },
          { f: 4, v: 0.3 },
        ],
      },
    });
  });
});
