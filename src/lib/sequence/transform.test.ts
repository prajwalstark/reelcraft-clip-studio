import { describe, expect, it } from "vitest";
import {
  addItem,
  bounds,
  clipRect,
  corners,
  cropAt,
  fresh,
  parseSequence,
  patchItem,
  placement,
  type Sequence,
} from "./model";
import { valuesPatch } from "./keyframes";
import {
  canTransform,
  cropFromDrag,
  hitTest,
  rotateFromDrag,
  scaleFromDrag,
  snapMove,
} from "./transform";

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
  it("snaps the box centre to the canvas centre and reports the guide", () => {
    // Box 400×200 centred at (965, 300) → shift −5 to centre on 960.
    const r = snapMove({ x: 765, y: 200, w: 400, h: 200 }, 1920, 1080, 10);
    expect(r).toEqual({ dx: -5, dy: 0, guidesX: [960], guidesY: [] });
  });
  it("snaps edges to the frame edges", () => {
    // Left edge at 6 → 0; bottom edge at 1076 → 1080.
    const r = snapMove({ x: 6, y: 876, w: 400, h: 200 }, 1920, 1080, 10);
    expect(r).toEqual({ dx: -6, dy: 4, guidesX: [0], guidesY: [1080] });
  });
  it("does nothing without snapping or when nothing is close", () => {
    expect(snapMove({ x: 765, y: 200, w: 400, h: 200 }, 1920, 1080, 10, false).dx).toBe(0);
    expect(snapMove({ x: 300, y: 300, w: 400, h: 200 }, 1920, 1080, 10)).toEqual({
      dx: 0,
      dy: 0,
      guidesX: [],
      guidesY: [],
    });
  });
});

describe("rotation and crop geometry", () => {
  it("crops the visible picture in place and rotates it about the clip position", () => {
    let s = seq();
    const id = s.items[1]!.id; // 960×540 centred at (1440, 270)
    s = patchItem(s, id, { cropLeft: 0.5, rotation: 90 });
    const p = placement(s, s.items[1]!, 0, 1920, 1080);
    expect(p.visible).toEqual({ x: 0, y: -270, w: 480, h: 540 });
    // Right half of the picture, turned 90° clockwise about (1440, 270): it now hangs below.
    const b = bounds(p);
    expect(b.x).toBeCloseTo(1170);
    expect(b.y).toBeCloseTo(270);
    expect(b.w).toBeCloseTo(540);
    expect(b.h).toBeCloseTo(480);
    expect(corners(p)[0]!.x).toBeCloseTo(1710); // top-left of the visible part → right
  });
  it("hit-tests the rotated, cropped picture", () => {
    let s = seq();
    const id = s.items[1]!.id;
    s = patchItem(s, id, { cropLeft: 0.5, rotation: 90 });
    expect(hitTest(s, 0, 1920, 1080, 1440, 600)?.track).toBe("V2"); // below the anchor
    expect(hitTest(s, 0, 1920, 1080, 1100, 100)?.track).toBe("V1"); // cropped away
  });
  it("cropAt keeps 10 % visible per axis even when keyframes overlap", () => {
    const c = {
      ...seq().items[1]!,
      keys: { cropLeft: [{ f: 0, v: 0.9 }], cropRight: [{ f: 0, v: 0.9 }] },
    };
    const k = cropAt(c, 0);
    expect(k.l + k.r).toBeCloseTo(0.9);
    expect(k.l).toBeCloseTo(0.45);
  });
  it("patchItem clamps rotation and crop, gives way on the edited edge, drops zeros", () => {
    let s = seq();
    const id = s.items[1]!.id;
    s = patchItem(s, id, { rotation: 900, cropLeft: 0.6 });
    expect(s.items[1]!.rotation).toBe(360);
    s = patchItem(s, id, { cropRight: 0.6 });
    expect(s.items[1]!.cropLeft).toBe(0.6);
    expect(s.items[1]!.cropRight).toBeCloseTo(0.3);
    s = patchItem(s, id, { rotation: 0, cropLeft: 0, cropRight: 0 });
    expect(["rotation", "cropLeft", "cropRight"].some((k) => k in s.items[1]!)).toBe(false);
    expect(() => patchItem(s, id, { rotation: Number.NaN })).toThrow();
  });
  it("parseSequence accepts older projects without the fields and rejects bad values", () => {
    const s = seq();
    expect(parseSequence(JSON.parse(JSON.stringify(s))).items[1]!.rotation).toBeUndefined();
    const raw = JSON.parse(JSON.stringify(s));
    raw.items[1].cropTop = 0.95;
    expect(() => parseSequence(raw)).toThrow();
    raw.items[1].cropTop = 0.5;
    raw.items[1].cropBottom = 0.5;
    expect(() => parseSequence(raw)).toThrow();
    raw.items[1].cropBottom = 0.2;
    raw.items[1].rotation = -45;
    expect(parseSequence(raw).items[1]!).toMatchObject({
      cropTop: 0.5,
      cropBottom: 0.2,
      rotation: -45,
    });
  });
});

describe("rotateFromDrag", () => {
  const c = { x: 0, y: 0 };
  it("follows the pointer, snapping near right angles", () => {
    expect(rotateFromDrag(0, c, { x: 100, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(90);
    expect(rotateFromDrag(0, c, { x: 100, y: 0 }, { x: 5, y: 100 })).toBe(90); // 87.1° → 90
    expect(rotateFromDrag(0, c, { x: 100, y: 0 }, { x: 5, y: 100 }, { snap: false })).toBeCloseTo(
      (Math.atan2(100, 5) * 180) / Math.PI,
    );
    expect(rotateFromDrag(0, c, { x: 100, y: 0 }, { x: 100, y: 40 }, { step: 15 })).toBe(15);
  });
  it("crosses ±180° continuously", () => {
    // Start at 170°, pointer moves from 170° to −170° (+20° of turn).
    const at = (a: number) => ({
      x: Math.cos((a * Math.PI) / 180),
      y: Math.sin((a * Math.PI) / 180),
    });
    expect(rotateFromDrag(170, c, at(170), at(-170), { snap: false })).toBeCloseTo(190);
  });
});

describe("cropFromDrag", () => {
  it("crops along the clip's own axes, keeping 10 % visible", () => {
    let s = seq();
    const id = s.items[1]!.id;
    s = patchItem(s, id, { rotation: 90 });
    const p = placement(s, s.items[1]!, 0, 1920, 1080); // 960 wide, turned to point down
    const none = { l: 0, r: 0, t: 0, b: 0 };
    // Pointer moves 96 px down = 96 px along the clip's x axis → left crop 10 %.
    expect(cropFromDrag(p, "left", none, { x: 0, y: 0 }, { x: 0, y: 96 })).toBeCloseTo(0.1);
    expect(cropFromDrag(p, "left", none, { x: 0, y: 0 }, { x: 96, y: 0 })).toBeCloseTo(0);
    expect(
      cropFromDrag(p, "right", { ...none, l: 0.5 }, { x: 0, y: 0 }, { x: 0, y: -900 }),
    ).toBeCloseTo(0.4);
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
