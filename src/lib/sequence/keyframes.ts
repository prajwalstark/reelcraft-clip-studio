// Keyframe animation for Sequence Studio clips.
//
// A clip can animate position, scale, opacity and volume. Keyframes are stored per property,
// at frame offsets from the clip's start, so moving a clip moves its animation with it.
// A key's `ease` shapes the segment that leaves it (up to the next key), like the outgoing
// interpolation in Premiere/Resolve. Before the first key the property holds the first key's
// value, after the last key it holds the last one. Keys may sit outside the clip's range
// (after a split or a trim) so the visible part animates exactly as before.

export const ANIMATABLE = ["x", "y", "scale", "opacity", "volume"] as const;
export type Prop = (typeof ANIMATABLE)[number];
export type Ease = "linear" | "smooth" | "hold";
export const EASES: { id: Ease; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "smooth", label: "Ease in/out" },
  { id: "hold", label: "Hold" },
];
export interface Keyframe {
  /** Frame offset from the clip start (integer). */
  f: number;
  v: number;
  /** Interpolation towards the next key; linear when omitted. */
  ease?: Ease;
}
export type Keyframes = Partial<Record<Prop, Keyframe[]>>;
/** Value range of each property (the same limits as the static fields). */
export const RANGE: Record<Prop, readonly [number, number]> = {
  x: [0, 1],
  y: [0, 1],
  scale: [0.1, 3],
  opacity: [0, 1],
  volume: [0, 1],
};
/** Keys per property; generous for hand-made animation, bounded for stored projects. */
export const MAX_KEYS = 200;
/** Offsets are bounded so stored projects can't carry absurd numbers (3 minutes × 2 at 30 fps). */
const MAX_OFFSET = 180 * 30 * 2;

interface Animated {
  start: number;
  frames: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  volume: number;
  keys?: Keyframes | undefined;
}

const clampTo = (p: Prop, v: number) => Math.min(RANGE[p][1], Math.max(RANGE[p][0], v));
const shape = (ease: Ease | undefined, t: number) =>
  ease === "hold" ? 0 : ease === "smooth" ? t * t * (3 - 2 * t) : t;

/** Value of a keyframed property at a (possibly fractional) offset; `base` when unkeyed. */
export function valueAt(keys: readonly Keyframe[] | undefined, base: number, offset: number) {
  if (!keys?.length) return base;
  const first = keys[0]!;
  if (offset <= first.f) return first.v;
  const last = keys[keys.length - 1]!;
  if (offset >= last.f) return last.v;
  // Binary search for the segment [a, b] containing `offset`.
  let lo = 0,
    hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.f <= offset) lo = mid;
    else hi = mid;
  }
  const a = keys[lo]!,
    b = keys[hi]!;
  return a.v + (b.v - a.v) * shape(a.ease, (offset - a.f) / (b.f - a.f));
}

export const isAnimated = (c: Animated, p: Prop) => (c.keys?.[p]?.length ?? 0) > 0;

/** A clip property at a timeline frame (fractional frames are fine, e.g. for audio). */
export const propAt = (c: Animated, p: Prop, frame: number) =>
  valueAt(c.keys?.[p], c[p], frame - c.start);

/** Clip can make sound somewhere: a static volume above zero, or any key above zero. */
export const audible = (c: Animated) =>
  isAnimated(c, "volume") ? c.keys!.volume!.some((k) => k.v > 0) : c.volume > 0;

export const keyAt = (c: Animated, p: Prop, offset: number) =>
  c.keys?.[p]?.find((k) => k.f === offset);

/** Sorted, de-duplicated (last wins), clamped copy; undefined when there are no keys at all. */
export function normalizeKeys(keys: Keyframes | undefined): Keyframes | undefined {
  if (!keys) return undefined;
  const out: Keyframes = {};
  for (const p of ANIMATABLE) {
    const list = keys[p];
    if (!list?.length) continue;
    const byFrame = new Map<number, Keyframe>();
    for (const k of list) {
      const key: Keyframe = { f: Math.round(k.f), v: clampTo(p, k.v) };
      if (k.ease && k.ease !== "linear") key.ease = k.ease;
      byFrame.set(key.f, key);
    }
    out[p] = [...byFrame.values()].sort((a, b) => a.f - b.f).slice(0, MAX_KEYS);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Add or replace the key for `p` at `offset`, keeping an existing key's ease. */
export function withKey(c: Animated, p: Prop, offset: number, v: number): Keyframes | undefined {
  const list = c.keys?.[p] ?? [];
  if (list.length >= MAX_KEYS && !list.some((k) => k.f === offset))
    throw new Error(`Limit: ${MAX_KEYS} keyframes per property.`);
  const old = list.find((k) => k.f === offset);
  const next: Keyframe = { f: offset, v, ...(old?.ease ? { ease: old.ease } : {}) };
  return normalizeKeys({ ...c.keys, [p]: [...list.filter((k) => k.f !== offset), next] });
}

export function withoutKey(c: Animated, p: Prop, offset: number): Keyframes | undefined {
  return normalizeKeys({ ...c.keys, [p]: (c.keys?.[p] ?? []).filter((k) => k.f !== offset) });
}

export function withEase(c: Animated, p: Prop, offset: number, ease: Ease) {
  return normalizeKeys({
    ...c.keys,
    [p]: (c.keys?.[p] ?? []).map((k) => (k.f === offset ? { ...k, ease } : k)),
  });
}

/**
 * Turn animation off for `p`: drop its keys and keep the value it had at `offset`, as the
 * stopwatch does in Premiere. Returns the patch for the clip.
 */
export function clearAnimation(c: Animated, p: Prop, offset: number) {
  const { [p]: _gone, ...rest } = c.keys ?? {};
  return {
    [p]: clampTo(p, valueAt(c.keys?.[p], c[p], offset)),
    keys: normalizeKeys(rest),
  } as { keys: Keyframes | undefined } & Partial<Record<Prop, number>>;
}

/**
 * Patch that sets properties to `values` at a timeline `frame`: a keyed property gets a key at
 * that frame (added or updated), an unkeyed one changes its static value. Used by direct
 * manipulation in the program monitor, so dragging respects existing animation.
 */
export function valuesPatch(c: Animated, frame: number, values: Partial<Record<Prop, number>>) {
  const offset = Math.round(frame - c.start);
  let keys = c.keys;
  const patch: Partial<Record<Prop, number>> & { keys?: Keyframes | undefined } = {};
  for (const p of ANIMATABLE) {
    const v = values[p];
    if (v === undefined || !Number.isFinite(v)) continue;
    if (isAnimated({ ...c, keys }, p)) keys = withKey({ ...c, keys }, p, offset, v);
    else patch[p] = clampTo(p, v);
  }
  if (keys !== c.keys) patch.keys = keys;
  return patch;
}

/** Offsets (within the clip) that hold at least one key, for timeline markers. */
export function keyOffsets(c: Animated): number[] {
  const set = new Set<number>();
  for (const p of ANIMATABLE)
    for (const k of c.keys?.[p] ?? []) if (k.f >= 0 && k.f < c.frames) set.add(k.f);
  return [...set].sort((a, b) => a - b);
}

/** Nearest key of `p` strictly before / after `offset` (within the clip), for navigation. */
export function adjacentKey(c: Animated, p: Prop, offset: number, dir: -1 | 1) {
  const inside = (c.keys?.[p] ?? []).filter((k) => k.f >= 0 && k.f < c.frames);
  return dir < 0
    ? inside.filter((k) => k.f < offset).at(-1)?.f
    : inside.find((k) => k.f > offset)?.f;
}

/**
 * Keep the keys that shape offsets lo…hi: every key inside, plus the nearest key on each side
 * (it defines the segment that enters or leaves the range). Values in range are unchanged.
 */
function bracket(list: Keyframe[], lo: number, hi: number) {
  const before = list.filter((k) => k.f < lo).at(-1);
  const after = list.find((k) => k.f > hi);
  return [
    ...(before ? [before] : []),
    ...list.filter((k) => k.f >= lo && k.f <= hi),
    ...(after ? [after] : []),
  ];
}

/** Keys for the two halves of a clip split `cut` frames after its start. */
export function splitKeys(
  keys: Keyframes | undefined,
  cut: number,
  frames: number,
): [Keyframes | undefined, Keyframes | undefined] {
  if (!keys) return [undefined, undefined];
  const head: Keyframes = {},
    tail: Keyframes = {};
  for (const p of ANIMATABLE) {
    const list = keys[p];
    if (!list?.length) continue;
    head[p] = bracket(list, 0, cut - 1);
    tail[p] = bracket(list, cut, frames - 1).map((k) => ({ ...k, f: k.f - cut }));
  }
  return [normalizeKeys(head), normalizeKeys(tail)];
}

/** Re-time keys for a frame-rate change. */
export function scaleKeys(keys: Keyframes | undefined, ratio: number) {
  if (!keys) return undefined;
  const out: Keyframes = {};
  for (const p of ANIMATABLE)
    if (keys[p]) out[p] = keys[p]!.map((k) => ({ ...k, f: Math.round(k.f * ratio) }));
  return normalizeKeys(out);
}

/** Validate stored keys: malformed keys are dropped, values clamped, too many truncated. */
export function readKeyframes(value: unknown): Keyframes | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: Keyframes = {};
  for (const p of ANIMATABLE) {
    const list = raw[p];
    if (!Array.isArray(list)) continue;
    out[p] = list
      .slice(0, MAX_KEYS * 2)
      .filter(
        (k): k is Keyframe =>
          !!k &&
          typeof k === "object" &&
          Number.isInteger((k as Keyframe).f) &&
          Math.abs((k as Keyframe).f) <= MAX_OFFSET &&
          Number.isFinite((k as Keyframe).v),
      )
      .map((k) => ({
        f: k.f,
        v: k.v,
        ...(EASES.some((e) => e.id === k.ease) ? { ease: k.ease } : {}),
      }));
  }
  return normalizeKeys(out);
}
