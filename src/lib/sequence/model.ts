export const MAX_SECONDS = 180;
export const TRACK_IDS = ["V1", "V2", "V3", "A1", "A2", "A3"] as const;
export type TrackId = (typeof TRACK_IDS)[number];
export interface Asset {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  kind: "video" | "audio" | "image";
  duration: number;
  origin: number;
  width: number;
  height: number;
  hasAudio: boolean;
  peaks: number[];
}
export interface Track {
  id: TrackId;
  locked: boolean;
  muted: boolean;
  hidden: boolean;
}
export interface Item {
  id: string;
  assetId: string;
  track: TrackId;
  start: number;
  frames: number;
  sourceIn: number;
  volume: number;
  opacity: number;
  x: number;
  y: number;
  scale: number;
  fit: "contain" | "cover";
  fadeIn: number;
  fadeOut: number;
  transition?: { from: string; frames: number };
}
export interface Sequence {
  format: "reelcraft-sequence";
  version: 1;
  name: string;
  fps: 24 | 30;
  aspect: "16:9" | "9:16" | "1:1";
  assets: Asset[];
  tracks: Track[];
  items: Item[];
}
export const id = () => crypto.randomUUID();
export const fresh = (): Sequence => ({
  format: "reelcraft-sequence",
  version: 1,
  name: "Untitled sequence",
  fps: 30,
  aspect: "16:9",
  assets: [],
  items: [],
  tracks: TRACK_IDS.map((id) => ({ id, locked: false, muted: false, hidden: false })),
});
export const end = (c: Item) => c.start + c.frames;
export const totalFrames = (s: Sequence) => Math.max(0, ...s.items.map(end));
export const videoTrack = (t: TrackId) => t.startsWith("V");
export const trackOf = (s: Sequence, t: TrackId) => s.tracks.find((x) => x.id === t)!;
export const assetOf = (s: Sequence, c: Item) => s.assets.find((a) => a.id === c.assetId)!;
export const dimensions = (s: Sequence, res: 720 | 1080) =>
  s.aspect === "9:16"
    ? { width: res, height: (res / 9) * 16 }
    : s.aspect === "1:1"
      ? { width: res, height: res }
      : { width: (res / 9) * 16, height: res };
export const compatible = (a: Asset, t: TrackId) =>
  videoTrack(t) ? a.kind !== "audio" : a.hasAudio;
export function assertEditable(s: Sequence, t: TrackId) {
  if (trackOf(s, t)?.locked) throw new Error(`${t} is locked.`);
}
export function transitionFrames(s: Sequence, c: Item) {
  const p = s.items.find((x) => x.id === c.transition?.from);
  return p &&
    p.track === c.track &&
    p.start < c.start &&
    c.transition &&
    Math.abs(end(p) - c.start - c.transition.frames) < 0.01
    ? Math.min(c.transition.frames, c.frames, p.frames)
    : 0;
}
export function cleanTransitions(s: Sequence): Sequence {
  return {
    ...s,
    items: s.items.map((c) => {
      if (!c.transition || transitionFrames(s, c)) return c;
      const { transition, ...rest } = c;
      return rest;
    }),
  };
}
export function addItem(s: Sequence, assetId: string, track: TrackId, start: number): Sequence {
  if (s.items.length >= 200) throw new Error("Limit: 200 clips per sequence.");
  const a = s.assets.find((x) => x.id === assetId);
  if (!a) throw new Error("Media not found.");
  assertEditable(s, track);
  if (!compatible(a, track))
    throw new Error(
      videoTrack(track)
        ? "Video tracks accept videos and images."
        : "Audio tracks require a file with audio.",
    );
  const at = Math.max(0, Math.round(start)),
    frames = Math.min(
      Math.floor((a.kind === "image" ? 5 : a.duration) * s.fps),
      MAX_SECONDS * s.fps - at,
    );
  if (frames < 1) throw new Error(`Sequence limit: ${MAX_SECONDS} seconds.`);
  return {
    ...s,
    items: [
      ...s.items,
      {
        id: id(),
        assetId,
        track,
        start: at,
        frames,
        sourceIn: 0,
        volume: 1,
        opacity: 1,
        x: 0.5,
        y: 0.5,
        scale: 1,
        fit: "contain",
        fadeIn: 0,
        fadeOut: 0,
      },
    ],
  };
}
export function patchItem(s: Sequence, itemId: string, patch: Partial<Item>): Sequence {
  const old = s.items.find((x) => x.id === itemId);
  if (!old) return s;
  assertEditable(s, old.track);
  const c = { ...old, ...patch, id: old.id, assetId: old.assetId };
  assertEditable(s, c.track);
  const a = assetOf(s, c);
  if (!compatible(a, c.track)) throw new Error("Media is incompatible with this track.");
  if (
    ![
      c.start,
      c.frames,
      c.sourceIn,
      c.volume,
      c.opacity,
      c.x,
      c.y,
      c.scale,
      c.fadeIn,
      c.fadeOut,
    ].every(Number.isFinite)
  )
    throw new Error("Enter finite numbers.");
  c.start = Math.max(0, Math.round(c.start));
  c.sourceIn = Math.max(0, c.sourceIn);
  c.frames = Math.max(1, Math.round(c.frames));
  if (c.start + c.frames > MAX_SECONDS * s.fps)
    throw new Error(`Sequence limit: ${MAX_SECONDS} seconds.`);
  if (a.kind !== "image" && c.sourceIn + c.frames / s.fps > a.duration + 0.001)
    throw new Error("Trim extends past the source media.");
  c.volume = Math.min(1, Math.max(0, c.volume));
  c.opacity = Math.min(1, Math.max(0, c.opacity));
  c.scale = Math.min(3, Math.max(0.1, c.scale));
  c.x = Math.min(1, Math.max(0, c.x));
  c.y = Math.min(1, Math.max(0, c.y));
  c.fadeIn = Math.min(c.frames, Math.max(0, Math.round(c.fadeIn)));
  c.fadeOut = Math.min(c.frames - c.fadeIn, Math.max(0, Math.round(c.fadeOut)));
  return cleanTransitions({ ...s, items: s.items.map((x) => (x.id === itemId ? c : x)) });
}
export function deleteItem(s: Sequence, itemId: string, ripple = false): Sequence {
  const c = s.items.find((x) => x.id === itemId);
  if (!c) return s;
  assertEditable(s, c.track);
  if (
    ripple &&
    s.items.some(
      (x) => x.id !== c.id && x.track === c.track && x.start < end(c) && end(x) > c.start,
    )
  )
    throw new Error(
      "Ripple delete requires a non-overlapping clip. Use Delete for overlapping clips.",
    );
  return cleanTransitions({
    ...s,
    items: s.items
      .filter((x) => x.id !== itemId)
      .map((x) =>
        ripple && x.track === c.track && x.start >= end(c)
          ? { ...x, start: x.start - c.frames }
          : x,
      ),
  });
}
export function splitItem(s: Sequence, itemId: string, frame: number): Sequence {
  if (s.items.length >= 200) throw new Error("Limit: 200 clips per sequence.");
  const c = s.items.find((x) => x.id === itemId);
  if (!c) return s;
  assertEditable(s, c.track);
  const cut = Math.round(frame) - c.start;
  if (cut < 1 || cut >= c.frames) throw new Error("Move the playhead inside the selected clip.");
  const { transition, ...rest } = c;
  return cleanTransitions({
    ...s,
    items: s.items.flatMap((x) =>
      x.id !== c.id
        ? [x]
        : [
            { ...rest, frames: cut, fadeOut: 0, fadeIn: Math.min(c.fadeIn, cut) },
            {
              ...rest,
              id: id(),
              start: c.start + cut,
              sourceIn: c.sourceIn + cut / s.fps,
              frames: c.frames - cut,
              fadeIn: 0,
              fadeOut: Math.min(c.fadeOut, c.frames - cut),
            },
          ],
    ),
  });
}
export function crossfade(s: Sequence, itemId: string, seconds = 0.5): Sequence {
  const c = s.items.find((x) => x.id === itemId);
  if (!c) return s;
  assertEditable(s, c.track);
  const previous = s.items
    .filter((x) => x.track === c.track && x.id !== c.id && x.start < c.start)
    .sort((a, b) => b.start - a.start)[0];
  if (!previous) throw new Error("Place a second clip after another clip on this track first.");
  const frames = Math.min(
    Math.max(1, Math.round(seconds * s.fps)),
    previous.frames - 1,
    c.frames - 1,
  );
  if (frames < 1) throw new Error("Both clips need at least two frames.");
  const start = end(previous) - frames;
  if (start + c.frames > MAX_SECONDS * s.fps)
    throw new Error("Crossfade exceeds the sequence limit.");
  const next = {
    ...s,
    items: s.items.map((x) =>
      x.id === c.id
        ? { ...x, start, fadeIn: 0, transition: { from: previous.id, frames } }
        : x.id === previous.id
          ? { ...x, fadeOut: 0 }
          : x,
    ),
  };
  if (
    next.items.some(
      (x) =>
        x.track === c.track &&
        x.id !== c.id &&
        x.id !== previous.id &&
        x.start < end({ ...c, start }) &&
        end(x) > start,
    )
  )
    throw new Error("Crossfade would overlap a third clip. Move it first.");
  return cleanTransitions(next);
}
/** Resolve track/transition references once, outside per-sample mixing loops. */
export function levelAt(s: Sequence, c: Item, audio = false) {
  const track = trackOf(s, c.track),
    finish = end(c),
    incoming = transitionFrames(s, c);
  const next = audio
    ? s.items.find((x) => x.transition?.from === c.id && transitionFrames(s, x) > 0)
    : undefined;
  const outgoing = next ? transitionFrames(s, next) : 0;
  const muted = audio ? track.muted : track.hidden;
  return (frame: number) => {
    if (muted || frame < c.start || frame >= finish) return 0;
    const age = frame - c.start,
      remaining = finish - frame;
    let level =
      (audio ? c.volume : c.opacity) *
      Math.min(1, c.fadeIn ? age / c.fadeIn : 1, c.fadeOut ? remaining / c.fadeOut : 1);
    if (incoming) level *= Math.min(1, age / incoming);
    if (next && frame >= next.start) level *= Math.max(0, remaining / outgoing);
    return level;
  };
}
export function clipLevel(s: Sequence, c: Item, frame: number, audio = false) {
  return levelAt(s, c, audio)(frame);
}
export function visualItems(s: Sequence, frame: number) {
  return s.items
    .filter(
      (c) =>
        videoTrack(c.track) && frame >= c.start && frame < end(c) && !trackOf(s, c.track).hidden,
    )
    .sort(
      (a, b) => a.track.localeCompare(b.track) || a.start - b.start || a.id.localeCompare(b.id),
    );
}
export function snapFrame(s: Sequence, frame: number, exclude?: string, tolerance = 3) {
  let best = Math.max(0, Math.round(frame)),
    dist = tolerance + 1;
  for (const point of [
    0,
    ...s.items.filter((c) => c.id !== exclude).flatMap((c) => [c.start, end(c)]),
  ])
    if (Math.abs(point - frame) <= tolerance && Math.abs(point - frame) < dist) {
      best = point;
      dist = Math.abs(point - frame);
    }
  return best;
}
export function changeFps(s: Sequence, fps: 24 | 30): Sequence {
  if (s.tracks.some((t) => t.locked) && s.items.length)
    throw new Error("Unlock tracks before changing frame rate.");
  const ratio = fps / s.fps;
  return cleanTransitions({
    ...s,
    fps,
    items: s.items.map((c) => ({
      ...c,
      start: Math.round(c.start * ratio),
      frames: Math.max(1, Math.floor(c.frames * ratio)),
      fadeIn: Math.floor(c.fadeIn * ratio),
      fadeOut: Math.floor(c.fadeOut * ratio),
      ...(c.transition
        ? { transition: { ...c.transition, frames: Math.round(c.transition.frames * ratio) } }
        : {}),
    })),
  });
}
export function parseSequence(value: unknown): Sequence {
  if (!value || typeof value !== "object") throw new Error("Invalid sequence file.");
  const s = value as Sequence;
  if (
    s.format !== "reelcraft-sequence" ||
    s.version !== 1 ||
    typeof s.name !== "string" ||
    ![24, 30].includes(s.fps) ||
    !["16:9", "9:16", "1:1"].includes(s.aspect) ||
    !Array.isArray(s.assets) ||
    !Array.isArray(s.items) ||
    !Array.isArray(s.tracks) ||
    s.assets.length > 50 ||
    s.items.length > 200 ||
    s.tracks.length !== 6
  )
    throw new Error("Unsupported sequence file.");
  const ids = new Set<string>();
  for (const a of s.assets) {
    if (
      !a ||
      typeof a.id !== "string" ||
      ids.has(a.id) ||
      typeof a.name !== "string" ||
      !["video", "audio", "image"].includes(a.kind) ||
      ![a.size, a.duration, a.width, a.height, a.origin, a.lastModified].every(Number.isFinite) ||
      a.duration <= 0 ||
      a.size < 0 ||
      a.width < 0 ||
      a.height < 0 ||
      (a.kind !== "audio" && (a.width === 0 || a.height === 0)) ||
      typeof a.hasAudio !== "boolean" ||
      !Array.isArray(a.peaks) ||
      a.peaks.length > 256 ||
      !a.peaks.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
    )
      throw new Error("Invalid media metadata.");
    ids.add(a.id);
  }
  if (
    TRACK_IDS.some((t) => s.tracks.filter((x) => x?.id === t).length !== 1) ||
    s.tracks.some((t) => [t.locked, t.muted, t.hidden].some((v) => typeof v !== "boolean"))
  )
    throw new Error("Invalid tracks.");
  const itemIds = new Set<string>();
  for (const c of s.items) {
    const a = s.assets.find((a) => a.id === c?.assetId);
    if (
      !c ||
      typeof c.id !== "string" ||
      itemIds.has(c.id) ||
      !a ||
      !TRACK_IDS.includes(c.track) ||
      !compatible(a, c.track) ||
      ![c.start, c.frames, c.fadeIn, c.fadeOut].every(Number.isInteger) ||
      c.start < 0 ||
      c.frames < 1 ||
      end(c) > MAX_SECONDS * s.fps ||
      ![c.sourceIn, c.volume, c.opacity, c.x, c.y, c.scale].every(Number.isFinite) ||
      c.sourceIn < 0 ||
      c.volume < 0 ||
      c.volume > 1 ||
      c.opacity < 0 ||
      c.opacity > 1 ||
      c.x < 0 ||
      c.x > 1 ||
      c.y < 0 ||
      c.y > 1 ||
      c.scale < 0.1 ||
      c.scale > 3 ||
      !["contain", "cover"].includes(c.fit) ||
      c.fadeIn < 0 ||
      c.fadeOut < 0 ||
      c.fadeIn + c.fadeOut > c.frames ||
      (a.kind !== "image" && c.sourceIn + c.frames / s.fps > a.duration + 0.001)
    )
      throw new Error("Invalid clip range or settings.");
    if (
      c.transition &&
      (!Number.isInteger(c.transition.frames) ||
        c.transition.frames < 1 ||
        typeof c.transition.from !== "string")
    )
      throw new Error("Invalid transition.");
    itemIds.add(c.id);
  }
  return cleanTransitions(structuredClone(s));
}
