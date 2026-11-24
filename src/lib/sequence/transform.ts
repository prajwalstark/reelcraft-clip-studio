// Direct manipulation in the program monitor: which clip is under the pointer, and how a
// drag moves or scales it. Everything here works in canvas units (the sequence's frame size),
// so it is independent of how large the monitor is drawn on screen.
import { MAX_CROP } from "./keyframes";
import {
  type Item,
  type Placement,
  type Sequence,
  placement,
  toLocal,
  trackOf,
  visualItems,
} from "./model";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Snapped {
  /** Shift to add to the proposed position, in canvas units. */
  dx: number;
  dy: number;
  /** Canvas coordinates of the guides the clip snapped to (vertical lines / horizontal lines). */
  guidesX: number[];
  guidesY: number[];
}

/** Is a canvas point on the visible (cropped, rotated) picture? */
export function onPicture(p: Placement, px: number, py: number) {
  const l = toLocal(p, px, py),
    v = p.visible;
  return l.x >= v.x && l.x <= v.x + v.w && l.y >= v.y && l.y <= v.y + v.h;
}

/** Topmost visible clip whose picture covers the point at `frame` (V3 over V2 over V1). */
export function hitTest(
  s: Sequence,
  frame: number,
  width: number,
  height: number,
  px: number,
  py: number,
): Item | undefined {
  const items = visualItems(s, frame);
  for (let i = items.length - 1; i >= 0; i--) {
    const c = items[i]!;
    if (onPicture(placement(s, c, frame, width, height), px, py)) return c;
  }
  return undefined;
}

/** A clip can be moved in the monitor when it is on screen at `frame` and its track is editable. */
export function canTransform(s: Sequence, c: Item | undefined, frame: number): c is Item {
  if (!c || !c.track.startsWith("V")) return false;
  const t = trackOf(s, c.track);
  return !t.hidden && !t.locked && frame >= c.start && frame < c.start + c.frames;
}

/**
 * Snap a moved clip to the canvas centre lines and edges. `box` is the proposed on-screen
 * bounds of the visible picture (canvas units) and `threshold` the snap distance. Returns the
 * shift to apply to the clip's position plus the guides it snapped to.
 */
export function snapMove(
  box: Rect,
  width: number,
  height: number,
  threshold: number,
  snap = true,
): Snapped {
  const axis = (start: number, size: number, extent: number) => {
    if (!snap) return { d: 0, guides: [] as number[] };
    // Candidate alignments: centre on centre, leading edge on 0, trailing edge on extent.
    const options = [
      { delta: extent / 2 - (start + size / 2), guide: extent / 2 },
      { delta: 0 - start, guide: 0 },
      { delta: extent - (start + size), guide: extent },
    ].filter((o) => Math.abs(o.delta) <= threshold);
    if (!options.length) return { d: 0, guides: [] as number[] };
    const best = Math.min(...options.map((o) => Math.abs(o.delta)));
    const hits = options.filter((o) => Math.abs(Math.abs(o.delta) - best) < 1e-9);
    return { d: hits[0]!.delta, guides: hits.map((o) => o.guide) };
  };
  const ax = axis(box.x, box.w, width),
    ay = axis(box.y, box.h, height);
  return { dx: ax.d, dy: ay.d, guidesX: ax.guides, guidesY: ay.guides };
}

/**
 * Scale from dragging a corner handle: proportional to the pointer's distance from the clip
 * centre, relative to where the drag started. Snaps to 100 % when close; clamped to 10–300 %.
 */
export function scaleFromDrag(
  start: number,
  center: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
  snap = true,
) {
  const d0 = Math.hypot(from.x - center.x, from.y - center.y);
  const d1 = Math.hypot(to.x - center.x, to.y - center.y);
  if (d0 < 1e-6) return start;
  const next = Math.min(3, Math.max(0.1, (start * d1) / d0));
  return snap && Math.abs(next - 1) < 0.03 ? 1 : next;
}

/**
 * Rotation from dragging the rotate handle around the clip's position, in degrees. The angle
 * follows the pointer continuously (crossing ±180° doesn't jump). Snaps to multiples of 90°
 * when within 3°; `step` (e.g. 15 with Shift) rounds to that step instead; `snap` false = free.
 */
export function rotateFromDrag(
  start: number,
  center: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
  { snap = true, step = 0 }: { snap?: boolean; step?: number } = {},
) {
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  const a1 = Math.atan2(to.y - center.y, to.x - center.x);
  let delta = ((a1 - a0) * 180) / Math.PI;
  delta = ((((delta + 180) % 360) + 360) % 360) - 180;
  let next = start + delta;
  if (snap && step > 0) next = Math.round(next / step) * step;
  else if (snap) {
    const right = Math.round(next / 90) * 90;
    if (Math.abs(next - right) < 3) next = right;
  }
  return Math.min(360, Math.max(-360, next));
}

export type Edge = "left" | "right" | "top" | "bottom";
export const CROP_PROP = {
  left: "cropLeft",
  right: "cropRight",
  top: "cropTop",
  bottom: "cropBottom",
} as const;

/**
 * Crop from dragging an edge handle: the pointer's movement along the clip's own (rotated)
 * axis, as a share of the uncropped picture. Keeps at least 10 % visible across the axis.
 */
export function cropFromDrag(
  p: Placement,
  edge: Edge,
  start: { l: number; r: number; t: number; b: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const a = toLocal(p, from.x, from.y),
    b = toLocal(p, to.x, to.y);
  const along = edge === "left" || edge === "right" ? (b.x - a.x) / p.w : (b.y - a.y) / p.h;
  const [value, other] =
    edge === "left"
      ? [start.l + along, start.r]
      : edge === "right"
        ? [start.r - along, start.l]
        : edge === "top"
          ? [start.t + along, start.b]
          : [start.b - along, start.t];
  return Math.min(MAX_CROP - other, Math.max(0, value));
}
