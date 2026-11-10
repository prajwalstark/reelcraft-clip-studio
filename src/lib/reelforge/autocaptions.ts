// Auto-captions controller: decodes the source's audio locally, transcribes it with Whisper in
// a Web Worker, and commits the result as one undoable caption edit. Real progress, real cancel.
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import { useSyncExternalStore } from "react";
import { bounded } from "@/lib/sequence/media";
import {
  ASR_RATE,
  CUE_PRESETS,
  Downsampler,
  MAX_TRANSCRIBE_SECONDS,
  chunksToWords,
  downmix,
  isSilent,
  mergeCaptions,
  planWindows,
  wordsToCaptions,
  type CuePreset,
  type Word,
} from "./autocaption-core";
import { commit, getState } from "./store";
import type { WorkerIn, WorkerOut } from "./whisper.worker";

export const MODELS = {
  fast: {
    id: "onnx-community/whisper-tiny_timestamped",
    label: "Fast",
    size: "≈ 40 MB",
    bytes: 44e6,
  },
  accurate: {
    id: "onnx-community/whisper-base_timestamped",
    label: "Accurate",
    size: "≈ 80 MB",
    bytes: 81e6,
  },
} as const;
export type ModelKey = keyof typeof MODELS;

export const LANGUAGES: [string, string][] = [
  ["", "Auto-detect"],
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["nl", "Dutch"],
  ["hi", "Hindi"],
  ["ar", "Arabic"],
  ["ru", "Russian"],
  ["tr", "Turkish"],
  ["pl", "Polish"],
  ["uk", "Ukrainian"],
  ["id", "Indonesian"],
  ["vi", "Vietnamese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
];

export interface AutoCaptionOptions {
  start: number; // source seconds
  end: number;
  model: ModelKey;
  language: string; // "" = auto-detect
  preset: CuePreset;
  replace: boolean;
}

export type JobStatus =
  "idle" | "loading" | "decoding" | "transcribing" | "done" | "error" | "canceled";
export interface AutoCaptionJob {
  status: JobStatus;
  /** 0..1 progress of the current stage. */
  progress: number;
  detail: string;
  device?: "webgpu" | "wasm" | undefined;
  added?: number | undefined;
  error?: string | undefined;
}

let job: AutoCaptionJob = { status: "idle", progress: 0, detail: "" };
const subs = new Set<() => void>();
const set = (p: Partial<AutoCaptionJob>) => {
  job = { ...job, ...p };
  subs.forEach((f) => f());
};
export const getAutoCaptionJob = () => job;
export function useAutoCaptions() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => job,
    () => job,
  );
}
export const isBusy = (j: AutoCaptionJob = job) =>
  j.status === "loading" || j.status === "decoding" || j.status === "transcribing";

// ---------- worker plumbing ----------
let worker: Worker | null = null;
let workerModel = "";
let workerDevice: "webgpu" | "wasm" | undefined;
let abort: AbortController | null = null;

function canceled(): never {
  throw new DOMException("Canceled", "AbortError");
}

/** Send one message and wait for its matching reply, rejecting on worker error or abort. */
function call<T extends WorkerOut["type"]>(
  w: Worker,
  msg: WorkerIn,
  until: T,
  signal: AbortSignal,
  onMessage?: (m: WorkerOut) => void,
): Promise<Extract<WorkerOut, { type: T }>> {
  return new Promise((resolve, reject) => {
    const done = () => {
      w.removeEventListener("message", on);
      w.removeEventListener("error", onErr);
      signal.removeEventListener("abort", onAbort);
    };
    const on = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === until && (msg.type !== "transcribe" || (m as { id?: number }).id === msg.id)) {
        done();
        resolve(m as Extract<WorkerOut, { type: T }>);
      } else if (m.type === "error") {
        done();
        reject(new Error(m.message));
      } else onMessage?.(m);
    };
    const onErr = (e: ErrorEvent) => {
      done();
      reject(new Error(e.message || "The speech engine crashed."));
    };
    const onAbort = () => {
      done();
      reject(new DOMException("Canceled", "AbortError"));
    };
    if (signal.aborted) return onAbort();
    w.addEventListener("message", on);
    w.addEventListener("error", onErr);
    signal.addEventListener("abort", onAbort, { once: true });
    if (msg.type === "transcribe") w.postMessage(msg, [msg.audio.buffer]);
    else w.postMessage(msg);
  });
}

async function ensureModel(model: string, expectedBytes: number, signal: AbortSignal) {
  if (worker && workerModel === model) return worker;
  worker ??= new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  const files = new Map<string, [number, number]>();
  set({ status: "loading", progress: 0, detail: "Loading speech model…" });
  const ready = await call(worker, { type: "load", model }, "ready", signal, (m) => {
    if (m.type !== "download") return;
    files.set(m.file, [m.loaded, m.total]);
    let got = 0;
    let known = 0;
    files.forEach(([l, t]) => ((got += l), (known += t)));
    // Files report their size only once they start, so use the model's expected size until
    // the reported total is larger; cached files finish instantly.
    const total = Math.max(known, expectedBytes);
    set({
      progress: Math.min(1, got / total),
      detail: `Downloading speech model · ${(got / 1e6).toFixed(0)} of ~${(total / 1e6).toFixed(0)} MB (first time only)`,
    });
  });
  workerModel = model;
  workerDevice = ready.device;
  return worker;
}

/** Decode [start, end) of the file's primary audio track to 16 kHz mono, keeping exact timing. */
export async function decodeRange(
  file: File,
  start: number,
  end: number,
  signal: AbortSignal,
  onProgress: (p: number) => void,
): Promise<Float32Array> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const audio = await bounded(input.getPrimaryAudioTrack(), signal);
    if (!audio)
      throw new Error("This video has no audio track, so there is nothing to transcribe.");
    if (!(await bounded(audio.canDecode(), signal)))
      throw new Error(
        "This browser cannot decode the video's audio. Convert it to MP4 with AAC audio and try again.",
      );
    const video = await bounded(input.getPrimaryVideoTrack(), signal);
    const origin = await bounded((video ?? audio).getFirstTimestamp(), signal);
    const span = end - start;
    let ds: Downsampler | null = null;
    const iterator = new AudioBufferSink(audio).buffers(origin + start, origin + end);
    try {
      for (;;) {
        const next = await bounded(iterator.next(), signal);
        if (next.done) break;
        const { buffer, timestamp } = next.value;
        const rate = buffer.sampleRate;
        ds ??= new Downsampler(rate, span);
        let rel = timestamp - (origin + start);
        let from = 0;
        if (rel < 0) {
          from = Math.min(buffer.length, Math.ceil(-rel * rate));
          rel = 0;
        }
        const to = Math.min(buffer.length, from + Math.max(0, Math.floor((span - rel) * rate)));
        if (to <= from) continue;
        // Keep the output aligned with source time across gaps or overlaps between packets.
        const drift = rel - ds.size / ASR_RATE;
        if (drift > 0.02) ds.pad(drift * ASR_RATE);
        else if (drift < -0.02) from = Math.min(to, from + Math.ceil(-drift * rate));
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
          buffer.getChannelData(ch).subarray(from, to),
        );
        ds.push(downmix(channels));
        onProgress(Math.min(1, (rel + (to - from) / rate) / span));
      }
    } finally {
      void iterator.return().catch(() => {});
    }
    if (!ds || ds.size < ASR_RATE * 0.2)
      throw new Error("No audio could be decoded in this range.");
    return ds.result();
  } finally {
    input.dispose();
  }
}

/** Turn low-level download/runtime errors into something a person can act on. */
export function explainError(message: string): string {
  if (/\b429\b|rate.?limit/i.test(message))
    return "The model host (Hugging Face) is rate-limiting downloads right now. Wait a few minutes and try again — once downloaded, the model is cached and this won't recur.";
  if (/\b5\d\d\b/.test(message) && /huggingface|jsdelivr|load file/i.test(message))
    return "The model host had a temporary problem. Try again in a few minutes.";
  if (/fetch|network|Failed to load|load file|\b40[34]\b|offline/i.test(message))
    return "Couldn't download the speech model. Check your connection (and any content blockers) and try again — it's fetched once from Hugging Face and jsDelivr, then cached.";
  if (/memory|allocation|OOM/i.test(message))
    return "Ran out of memory while transcribing. Try the Fast model or a shorter range.";
  return message;
}

const fmtSecs = (s: number) =>
  s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;

export async function runAutoCaptions(opts: AutoCaptionOptions) {
  if (isBusy()) return;
  const file = getState().rt.file;
  if (!file) {
    set({ status: "error", error: "Relink the source video first.", detail: "" });
    return;
  }
  const start = Math.max(0, opts.start);
  const end = Math.min(getState().project.source?.duration ?? opts.end, opts.end);
  if (!(end - start >= 0.5)) {
    set({ status: "error", error: "Select a range at least half a second long.", detail: "" });
    return;
  }
  if (end - start > MAX_TRANSCRIBE_SECONDS) {
    set({
      status: "error",
      error: "Transcribe at most 60 minutes at a time — pick a clip instead of the whole video.",
      detail: "",
    });
    return;
  }
  abort = new AbortController();
  const signal = abort.signal;
  set({ status: "loading", progress: 0, detail: "Starting…", error: undefined, added: undefined });
  try {
    const w = await ensureModel(MODELS[opts.model].id, MODELS[opts.model].bytes, signal);
    set({ status: "decoding", progress: 0, detail: "Reading audio…", device: workerDevice });
    const samples = await decodeRange(file, start, end, signal, (p) =>
      set({ progress: p, detail: `Reading audio · ${Math.round(p * 100)}%` }),
    );
    const windows = planWindows(samples);
    const words: Word[] = [];
    const began = performance.now();
    for (let i = 0; i < windows.length; i++) {
      if (signal.aborted) canceled();
      const win = windows[i]!;
      const audio = samples.slice(win.start, win.end);
      const seconds = audio.length / ASR_RATE;
      const done = i / windows.length;
      const elapsed = (performance.now() - began) / 1000;
      const eta = i ? (elapsed / i) * (windows.length - i) : 0;
      set({
        status: "transcribing",
        progress: done,
        detail: `Transcribing ${i + 1} of ${windows.length}${eta ? ` · about ${fmtSecs(eta)} left` : ""}`,
      });
      if (isSilent(audio)) continue;
      const res = await call(
        w,
        { type: "transcribe", id: i, audio, language: opts.language || null },
        "result",
        signal,
      );
      words.push(...chunksToWords(res.chunks, start + win.start / ASR_RATE, seconds));
    }
    const cues = wordsToCaptions(words, CUE_PRESETS[opts.preset], end);
    if (getState().rt.file !== file)
      throw new Error("The source video changed while transcribing; nothing was added.");
    if (!cues.length) {
      set({
        status: "done",
        progress: 1,
        added: 0,
        detail: "No speech was detected in this range.",
      });
      return;
    }
    commit((p) => ({ ...p, captions: mergeCaptions(p.captions, cues, start, end, opts.replace) }));
    set({
      status: "done",
      progress: 1,
      added: cues.length,
      detail: `Added ${cues.length} captions.`,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      set({ status: "canceled", progress: 0, detail: "Canceled. Nothing was changed." });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    set({ status: "error", progress: 0, detail: "", error: explainError(message) });
    // A failed load leaves the worker in an unknown state; start fresh next time.
    worker?.terminate();
    worker = null;
    workerModel = "";
  } finally {
    abort = null;
  }
}

export function cancelAutoCaptions() {
  if (!abort) return;
  abort.abort();
  // Stop inference immediately; the model reloads from the browser cache next time.
  worker?.terminate();
  worker = null;
  workerModel = "";
}

export const resetAutoCaptions = () =>
  !isBusy() && set({ status: "idle", progress: 0, detail: "", error: undefined });
