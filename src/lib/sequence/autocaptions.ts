// Auto-captions for Sequence Studio: transcribe what the viewer hears (the sequence's own audio
// mix, so muted tracks, volume keyframes and fades are respected) with the same on-device
// Whisper engine as the Shorts editor, and add the result as caption title clips.
import {
  CUE_PRESETS,
  Downsampler,
  downmix,
  wordsToCaptions,
  type CuePreset,
} from "@/lib/reelforge/autocaption-core";
import {
  failJob,
  isBusy,
  reportReading,
  runJob,
  transcribeSamples,
  type ModelKey,
} from "@/lib/reelforge/autocaptions";
import type { Caption } from "@/lib/reelforge/core";
import { MediaSession, type Files } from "./media";
import {
  type Item,
  type Sequence,
  type TrackId,
  MAX_SECONDS,
  assertEditable,
  assetOf,
  dimensions,
  end,
  id,
  totalFrames,
  videoTrack,
} from "./model";
import { DEFAULT_TITLE, type Title, readTitle, titleLayout } from "./titles";

export type CaptionLook = "subtitle" | "boxed" | "bold";
export const CAPTION_LOOKS: {
  id: CaptionLook;
  label: string;
  title: Partial<Title>;
  place: { x: number; y: number };
}[] = [
  {
    id: "subtitle",
    label: "Subtitle",
    title: { size: 0.05, weight: 700, outline: 0.12, outlineColor: "#000000", shadow: false },
    place: { x: 0.5, y: 0.86 },
  },
  {
    id: "boxed",
    label: "Boxed",
    title: {
      size: 0.045,
      weight: 700,
      shadow: false,
      background: "#000000",
      backgroundOpacity: 0.65,
    },
    place: { x: 0.5, y: 0.85 },
  },
  {
    id: "bold",
    label: "Bold centre",
    title: {
      size: 0.075,
      weight: 800,
      color: "#ffe14d",
      outline: 0.14,
      outlineColor: "#000000",
      shadow: true,
    },
    place: { x: 0.5, y: 0.7 },
  },
];

export interface SequenceCaptionOptions {
  model: ModelKey;
  language: string;
  preset: CuePreset;
  look: CaptionLook;
  /** "words": each word appears as it's spoken; "line": the whole caption fades in. */
  reveal: "line" | "words";
  track: TrackId;
  /** Range to caption, in frames [start, end). */
  start: number;
  end: number;
  /** Remove earlier auto-captions on this track in the range first. */
  replace: boolean;
}

/** Captions longer than this share of the frame width are wrapped onto more lines. */
const MAX_LINE = 0.88;

/** Break a caption into lines that fit the frame, keeping every word (so timings still line up). */
export function wrapCaption(title: Title, width: number, height: number): string {
  const words = title.text.split(/\s+/).filter(Boolean);
  const fits = (line: string) =>
    titleLayout({ ...title, text: line }, height).w <= width * MAX_LINE;
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && !fits(next)) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/** Auto-captions in a range on a track (what "replace" removes). */
export const captionsIn = (s: Sequence, track: TrackId, start: number, stop: number) =>
  s.items.filter((c) => c.title?.caption && c.track === track && c.start < stop && end(c) > start);

/**
 * Add caption cues (timeline seconds) as title clips. One caption per cue, never overlapping
 * the next; lines wrapped to the frame; word timings kept for a spoken word-by-word reveal.
 */
export function captionsToTitles(
  s: Sequence,
  cues: Caption[],
  opts: Pick<SequenceCaptionOptions, "look" | "reveal" | "track" | "start" | "end" | "replace">,
): { sequence: Sequence; added: number } {
  if (!videoTrack(opts.track)) throw new Error("Captions go on a video track.");
  assertEditable(s, opts.track);
  const fps = s.fps;
  const look = CAPTION_LOOKS.find((l) => l.id === opts.look) ?? CAPTION_LOOKS[0]!;
  const { width, height } = dimensions(s, 1080);
  const removed = new Set(
    opts.replace ? captionsIn(s, opts.track, opts.start, opts.end).map((c) => c.id) : [],
  );
  const frames = cues.map((c) => ({
    a: Math.max(opts.start, Math.round(c.start * fps)),
    b: Math.min(opts.end, MAX_SECONDS * fps, Math.round(c.end * fps)),
  }));
  const fresh: Item[] = [];
  cues.forEach((cue, i) => {
    const { a } = frames[i]!;
    const b = Math.min(frames[i]!.b, frames[i + 1]?.a ?? Infinity);
    if (b - a < 1) return;
    const base: Title = {
      ...DEFAULT_TITLE,
      ...look.title,
      text: cue.text,
      caption: true,
      animIn:
        opts.reveal === "words"
          ? { type: "words", duration: 0.3 }
          : { type: "fade", duration: 0.12 },
      animOut: { type: "fade", duration: 0.1 },
    };
    const title = readTitle({
      ...base,
      text: wrapCaption(base, width, height),
      // Seconds from this clip's start; wrapping adds line breaks only, so words still match.
      wordTimes: cue.words?.map((w) => w.start - a / fps),
    });
    if (!title) return;
    fresh.push({
      id: id(),
      assetId: "",
      track: opts.track,
      start: a,
      frames: b - a,
      sourceIn: 0,
      volume: 1,
      opacity: 1,
      x: look.place.x,
      y: look.place.y,
      scale: 1,
      fit: "contain",
      fadeIn: 0,
      fadeOut: 0,
      title,
    });
  });
  const kept = s.items.filter((c) => !removed.has(c.id));
  if (kept.length + fresh.length > 200)
    throw new Error(
      `That's ${fresh.length} captions, but only ${200 - kept.length} more clips fit (200 per sequence). Choose "Sentences" for longer captions, or caption a shorter range.`,
    );
  return { sequence: { ...s, items: [...kept, ...fresh] }, added: fresh.length };
}

/** Clips whose sound is heard in [start, end) frames but whose file isn't linked. */
export function unlinkedAudio(s: Sequence, files: Files, start: number, stop: number) {
  return s.items.filter(
    (c) =>
      !c.title &&
      assetOf(s, c).hasAudio &&
      c.start < stop &&
      end(c) > start &&
      !files.has(c.assetId),
  );
}

/**
 * Transcribe the sequence's audio in the range and add captions. `get` reads the latest
 * sequence and `apply` commits an edit (one undo step). Progress and errors go to the shared
 * auto-caption job, owned by "sequence".
 */
export async function runSequenceCaptions(
  get: () => Sequence,
  files: Files,
  opts: SequenceCaptionOptions,
  apply: (edit: (s: Sequence) => Sequence) => void,
) {
  if (isBusy()) return;
  const s0 = get();
  const startF = Math.max(0, opts.start),
    stopF = Math.min(totalFrames(s0), opts.end);
  if ((stopF - startF) / s0.fps < 0.5)
    return failJob("sequence", "Caption at least half a second of the timeline.");
  const missing = unlinkedAudio(s0, files, startF, stopF);
  if (missing.length)
    return failJob(
      "sequence",
      `Relink ${assetOf(s0, missing[0]!).name} first — its sound is part of the range.`,
    );
  try {
    assertEditable(s0, opts.track);
  } catch (e) {
    return failJob("sequence", (e as Error).message);
  }
  await runJob("sequence", async (signal) => {
    const start = startF / s0.fps,
      stop = stopF / s0.fps;
    // The mix is what the viewer hears: mutes, volumes, keyframes and fades included.
    reportReading(0);
    const session = new MediaSession(s0, files, signal);
    let mix: AudioBuffer | null;
    try {
      mix = await session.audio((p) => reportReading(p * 0.95));
    } finally {
      session.dispose();
    }
    if (!mix) throw new Error("Nothing in this range has sound to transcribe.");
    const from = Math.floor(start * mix.sampleRate),
      to = Math.min(mix.length, Math.ceil(stop * mix.sampleRate));
    const ds = new Downsampler(mix.sampleRate, stop - start);
    ds.push(
      downmix(
        Array.from({ length: mix.numberOfChannels }, (_, ch) =>
          mix!.getChannelData(ch).subarray(from, to),
        ),
      ),
    );
    reportReading(1);
    const words = await transcribeSamples(ds.result(), start, opts, signal);
    const cues = wordsToCaptions(words, CUE_PRESETS[opts.preset], stop);
    if (!cues.length) return { added: 0, detail: "No speech was detected in this range." };
    const place = { ...opts, start: startF, end: stopF };
    // Check against the latest edit first so a problem (locked track, clip limit) is reported.
    const { added } = captionsToTitles(get(), cues, place);
    apply((s) => captionsToTitles(s, cues, place).sequence);
    return { added, detail: `Added ${added} captions on ${opts.track}.` };
  });
}
