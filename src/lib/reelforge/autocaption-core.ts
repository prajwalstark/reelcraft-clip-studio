// Pure helpers for on-device auto-captions: audio resampling, window planning and
// turning timed words into editable caption cues. No browser APIs, so all of it is unit-testable.
import { uid, type Caption } from "./core";

export const ASR_RATE = 16000;
/** Whisper sees at most 30 s per pass; leave headroom so cut points can move to a pause. */
export const WINDOW_SECONDS = 28;
/** Longest stretch transcribed in one run (memory: 16 kHz mono float32 ≈ 230 MB/hour). */
export const MAX_TRANSCRIBE_SECONDS = 60 * 60;

/**
 * Streaming mono resampler to 16 kHz. Each output sample is the mean of the source samples
 * in its window (a box low-pass), which avoids most aliasing when downsampling speech and
 * works for non-integer ratios such as 44.1 kHz → 16 kHz. Upsampling falls back to linear.
 */
export class Downsampler {
  private out: Float32Array;
  private length = 0;
  private pos = 0; // fractional source position of the next output sample, in source samples
  private consumed = 0; // source samples seen so far
  private carry: number[] = []; // unconsumed tail from the previous block
  private readonly step: number;

  constructor(
    readonly sourceRate: number,
    expectedSeconds = 0,
  ) {
    if (!(sourceRate > 0)) throw new Error("Invalid sample rate");
    this.step = sourceRate / ASR_RATE;
    this.out = new Float32Array(Math.max(1024, Math.ceil(expectedSeconds * ASR_RATE) + 1024));
  }

  get size() {
    return this.length;
  }

  private ensure(extra: number) {
    if (this.length + extra <= this.out.length) return;
    const next = new Float32Array(Math.max(this.out.length * 2, this.length + extra));
    next.set(this.out.subarray(0, this.length));
    this.out = next;
  }

  /** Append silence (used to keep timing exact across gaps in the decoded stream). */
  pad(samples16k: number) {
    const n = Math.max(0, Math.round(samples16k));
    if (!n) return;
    this.ensure(n);
    this.out.fill(0, this.length, this.length + n);
    this.length += n;
    // Drop the pending tail and restart sampling at (or after) the next unseen source sample.
    this.carry = [];
    this.pos = Math.max(this.pos + n * this.step, this.consumed);
    this.consumed = Math.floor(this.pos);
  }

  /** Push one block of mono samples at the source rate. */
  push(mono: ArrayLike<number>) {
    const base = this.consumed - this.carry.length;
    const get = (i: number) =>
      i - base < this.carry.length ? this.carry[i - base]! : mono[i - base - this.carry.length]!;
    const end = this.consumed + mono.length;
    this.ensure(Math.ceil(mono.length / this.step) + 2);
    if (this.step >= 1) {
      while (this.pos + this.step <= end) {
        const a = Math.floor(this.pos);
        const b = Math.min(end, Math.max(a + 1, Math.floor(this.pos + this.step)));
        let sum = 0;
        for (let i = a; i < b; i++) sum += get(i);
        this.out[this.length++] = sum / (b - a);
        this.pos += this.step;
      }
    } else {
      while (this.pos + 1 < end) {
        const a = Math.floor(this.pos);
        const f = this.pos - a;
        this.out[this.length++] = get(a) * (1 - f) + get(a + 1) * f;
        this.pos += this.step;
      }
    }
    const keepFrom = Math.max(base, Math.floor(this.pos));
    const tail: number[] = [];
    for (let i = keepFrom; i < end; i++) tail.push(get(i));
    this.carry = tail;
    this.consumed = end;
  }

  result() {
    return this.out.slice(0, this.length);
  }
}

/** Average all channels of a planar block into one mono array. */
export function downmix(channels: ArrayLike<number>[]): Float32Array {
  const n = channels[0]?.length ?? 0;
  const out = new Float32Array(n);
  if (!channels.length) return out;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i]! += ch[i]!;
  if (channels.length > 1) for (let i = 0; i < n; i++) out[i]! /= channels.length;
  return out;
}

export interface Window {
  start: number; // sample index (16 kHz)
  end: number;
}

/**
 * Split audio into ≤ `maxSeconds` windows, moving each cut to the quietest 0.25 s stretch in
 * the last `searchSeconds` of the window so words are rarely cut in half.
 */
export function planWindows(
  samples: Float32Array,
  rate = ASR_RATE,
  maxSeconds = WINDOW_SECONDS,
  searchSeconds = 4,
): Window[] {
  const max = Math.floor(maxSeconds * rate);
  const search = Math.floor(Math.min(searchSeconds, maxSeconds / 2) * rate);
  const hop = Math.floor(0.05 * rate);
  const frame = Math.floor(0.25 * rate);
  const out: Window[] = [];
  let start = 0;
  while (start < samples.length) {
    if (samples.length - start <= max) {
      out.push({ start, end: samples.length });
      break;
    }
    let best = start + max;
    let bestEnergy = Infinity;
    for (let c = start + max - search; c + frame <= start + max; c += hop) {
      let e = 0;
      for (let i = c; i < c + frame; i++) e += samples[i]! * samples[i]!;
      if (e < bestEnergy) {
        bestEnergy = e;
        best = c + Math.floor(frame / 2);
      }
    }
    out.push({ start, end: best });
    start = best;
  }
  return out;
}

/** True when a window is effectively silent; skipping these avoids Whisper hallucinations. */
export function isSilent(samples: Float32Array, threshold = 0.004) {
  if (!samples.length) return true;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length) < threshold;
}

export interface Word {
  text: string;
  start: number; // seconds
  end: number;
}

/** Shape of `chunks` returned by the transformers.js speech pipeline. */
export interface AsrChunk {
  text: string;
  timestamp: [number | null, number | null] | number[];
}

// Whisper emits these for music, silence or noise; they are not speech.
const NON_SPEECH =
  /^\s*[[(♪*].*[\])♪*]\s*$|^\s*\[?(blank_audio|music|silence|no speech|applause|laughter)\]?\s*$/i;

/** Normalise pipeline chunks into words, shifted by `offset` seconds; drops non-speech tags. */
export function chunksToWords(chunks: AsrChunk[], offset: number, windowSeconds: number): Word[] {
  const words: Word[] = [];
  chunks.forEach((c, i) => {
    const text = c.text.replace(/\s+/g, " ").trim();
    if (!text || NON_SPEECH.test(text)) return;
    const s = Number.isFinite(c.timestamp[0])
      ? (c.timestamp[0] as number)
      : (words.at(-1)?.end ?? 0) - offset;
    const nextStart = chunks[i + 1]?.timestamp[0];
    const rawEnd = c.timestamp[1];
    const e = Number.isFinite(rawEnd)
      ? (rawEnd as number)
      : Number.isFinite(nextStart)
        ? (nextStart as number)
        : Math.min(windowSeconds, s + 0.6);
    const start = Math.max(0, Math.min(s, windowSeconds));
    const end = Math.max(start + 0.05, Math.min(e, windowSeconds));
    // Segment-level chunks (several words) are spread over their span by character count.
    const parts = text.split(" ");
    if (parts.length === 1) {
      words.push({ text, start: offset + start, end: offset + end });
      return;
    }
    const total = parts.reduce((a, p) => a + p.length + 1, 0);
    let t = start;
    for (const p of parts) {
      const d = ((end - start) * (p.length + 1)) / total;
      words.push({ text: p, start: offset + t, end: offset + t + d });
      t += d;
    }
  });
  return words;
}

export interface CueOptions {
  /** Max characters on a caption (including spaces). */
  maxChars: number;
  /** Max seconds a caption stays on screen. */
  maxSeconds: number;
  /** A pause longer than this always starts a new caption. */
  gapSeconds: number;
  /** Captions shorter than this are lengthened (without overlapping the next one). */
  minSeconds: number;
}

export const CUE_PRESETS = {
  punchy: { maxChars: 18, maxSeconds: 1.6, gapSeconds: 0.45, minSeconds: 0.4 },
  standard: { maxChars: 32, maxSeconds: 3, gapSeconds: 0.6, minSeconds: 0.7 },
  sentences: { maxChars: 64, maxSeconds: 5, gapSeconds: 0.9, minSeconds: 1 },
} satisfies Record<string, CueOptions>;
export type CuePreset = keyof typeof CUE_PRESETS;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Group timed words into caption cues (source seconds) that read well on a vertical screen. */
export function wordsToCaptions(words: Word[], opts: CueOptions, limitEnd = Infinity): Caption[] {
  const cues: Caption[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur
      .map((w) => w.text)
      .join(" ")
      .replace(/\s+([,.!?;:%)])/g, "$1")
      .trim();
    if (text) cues.push({ id: uid(), start: cur[0]!.start, end: cur.at(-1)!.end, text });
    cur = [];
  };
  for (const w of words) {
    const prev = cur.at(-1);
    if (prev) {
      const len = cur.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length;
      const sentenceEnd = /[.!?…]["')\]]?$/.test(prev.text);
      if (
        len > opts.maxChars ||
        w.end - cur[0]!.start > opts.maxSeconds ||
        w.start - prev.end > opts.gapSeconds ||
        sentenceEnd
      )
        flush();
    }
    cur.push(w);
  }
  flush();
  // Timing pass: enforce order, minimum readable duration and no overlaps.
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!;
    const next = cues[i + 1];
    const ceiling = Math.min(next ? next.start : limitEnd, limitEnd);
    if (c.end - c.start < opts.minSeconds) c.end = Math.min(ceiling, c.start + opts.minSeconds);
    if (next && c.end > next.start) c.end = next.start;
    c.start = r3(c.start);
    c.end = r3(Math.max(c.end, c.start + 0.05));
  }
  return cues.filter((c) => c.end > c.start);
}

/** Replace (or keep) captions overlapping [start, end) and merge in the new ones, sorted. */
export function mergeCaptions(
  existing: Caption[],
  fresh: Caption[],
  start: number,
  end: number,
  replace: boolean,
): Caption[] {
  const kept = replace ? existing.filter((c) => c.end <= start || c.start >= end) : existing;
  return [...kept, ...fresh].sort((a, b) => a.start - b.start);
}
