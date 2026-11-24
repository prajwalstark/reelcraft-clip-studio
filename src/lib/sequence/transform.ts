// Direct manipulation in the program monitor: which clip is under the pointer, and how a
// drag moves or scales it. Everything here works in canvas units (the sequence's frame size),
// so it is independent of how large the monitor is drawn on screen.
import { type Item, type Sequence, clipRect, trackOf, visualItems } from "./model";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Snapped {
  /** New centre, as a fraction of the canvas (the clip's x/y). */
  x: number;
  y: number;
  /** Canvas coordinates of the guides the clip snapped to (vertical lines / horizontal lines). */
  guidesX: number[];
  guidesY: number[];
}

const contains = (r: Rect, px: number, py: number) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

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
    if (contains(clipRect(s, c, frame, width, height), px, py)) return c;
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
 * Snap a moved clip to the canvas centre lines and edges. `cx`/`cy` is the proposed centre and
 * `w`/`h` the clip size, all in canvas units; `threshold` is the snap distance in canvas units.
 * The result is clamped so the centre stays on the canvas (the model's 0…1 range).
 */
export function snapMove(
  cx: number,
  cy: number,
  w: number,
  h: number,
  width: number,
  height: number,
  threshold: number,
  snap = true,
): Snapped {
  const axis = (c: number, size: number, extent: number) => {
    if (!snap) return { c, guides: [] as number[] };
    // Candidate alignments: centre on centre, leading edge on 0, trailing edge on extent.
    const options = [
      { delta: extent / 2 - c, guide: extent / 2 },
      { delta: 0 - (c - size / 2), guide: 0 },
      { delta: extent - (c + size / 2), guide: extent },
    ].filter((o) => Math.abs(o.delta) <= threshold);
    if (!options.length) return { c, guides: [] as number[] };
    const best = Math.min(...options.map((o) => Math.abs(o.delta)));
    const hits = options.filter((o) => Math.abs(Math.abs(o.delta) - best) < 1e-9);
    return { c: c + hits[0]!.delta, guides: hits.map((o) => o.guide) };
  };
  const ax = axis(cx, w, width),
    ay = axis(cy, h, height);
  return {
    x: Math.min(1, Math.max(0, ax.c / width)),
    y: Math.min(1, Math.max(0, ay.c / height)),
    guidesX: ax.guides,
    guidesY: ay.guides,
  };
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
