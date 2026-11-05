// Tiny external store: undoable project + non-undoable runtime state.
import { useSyncExternalStore } from "react";
import { zipSync } from "fflate";
import {
  clipCaptions, isProject, makeClips, newProject, slug, toSRT,
  type Clip, type Project, type SourceMeta,
} from "./core";
import { downloadBlob, exportClip, type ExportFormat } from "./exporter";

export type Tab = "clip" | "frame" | "captions" | "export";
export interface Job {
  id: string;
  clipId: string;
  title: string;
  status: "queued" | "rendering" | "done" | "error" | "canceled";
  progress: number;
  blob?: Blob;
  format?: ExportFormat;
  fileName?: string;
  error?: string;
  meta?: string;
}
interface Runtime {
  file: File | null;
  url: string | null;
  sourceError: string | null;
  loading: boolean;
  selected: string[];
  activeId: string | null;
  activeCaptionId: string | null;
  time: number;
  playing: boolean;
  tab: Tab;
  safeZone: boolean;
  jobs: Job[];
  hydrated: boolean;
}
interface State { project: Project; past: Project[]; future: Project[]; rt: Runtime }

let state: State = {
  project: newProject(),
  past: [],
  future: [],
  rt: {
    file: null, url: null, sourceError: null, loading: false, selected: [], activeId: null,
    activeCaptionId: null, time: 0, playing: false, tab: "clip", safeZone: true, jobs: [], hydrated: false,
  },
};
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => (subs.add(f), () => subs.delete(f));
export const getState = () => state;
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
}

let lastKey = "";
let lastAt = 0;
/** Apply an undoable edit. Edits with the same coalesce key within 600ms merge into one undo step. */
export function commit(fn: (p: Project) => Project, key?: string) {
  const next = { ...fn(state.project), updatedAt: Date.now() };
  const now = Date.now();
  const merge = key && key === lastKey && now - lastAt < 600;
  lastKey = key ?? "";
  lastAt = now;
  state = { ...state, project: next, past: merge ? state.past : [...state.past.slice(-99), state.project], future: [] };
  fixSelection();
  emit();
  save();
}
export function undo() {
  const prev = state.past.at(-1);
  if (!prev) return;
  state = { ...state, project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future] };
  lastKey = "";
  fixSelection(); emit(); save();
}
export function redo() {
  const nx = state.future[0];
  if (!nx) return;
  state = { ...state, project: nx, past: [...state.past, state.project], future: state.future.slice(1) };
  lastKey = "";
  fixSelection(); emit(); save();
}
export function setRt(p: Partial<Runtime>) {
  state = { ...state, rt: { ...state.rt, ...p } };
  emit();
}
function fixSelection() {
  const ids = new Set(state.project.clips.map((c) => c.id));
  const sel = state.rt.selected.filter((i) => ids.has(i));
  const activeId = state.rt.activeId && ids.has(state.rt.activeId) ? state.rt.activeId : state.project.clips[0]?.id ?? null;
  state = { ...state, rt: { ...state.rt, selected: sel, activeId } };
}
export const activeClip = (s: State = state) => s.project.clips.find((c) => c.id === s.rt.activeId) ?? null;
export const updateClip = (id: string, patch: Partial<Clip>, key?: string) =>
  commit((p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), key);

// ---------- persistence ----------
const LS = "reelforge:project:v1";
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = window.setTimeout(() => {
    try { localStorage.setItem(LS, JSON.stringify(state.project)); } catch { /* quota */ }
  }, 300);
}
export function hydrate() {
  if (state.rt.hydrated) return;
  try {
    const raw = localStorage.getItem(LS);
    const p = raw ? JSON.parse(raw) : null;
    if (isProject(p)) state = { ...state, project: p };
  } catch { /* ignore */ }
  state = { ...state, rt: { ...state.rt, hydrated: true } };
  fixSelection();
  emit();
}
export function newProjectAction() {
  cancelAll();
  releaseSource();
  commit(() => newProject());
}
export function exportProjectJSON() {
  const p = state.project;
  downloadBlob(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }), `${slug(p.name)}.reelforge.json`);
}
export async function importProjectJSON(file: File) {
  const p = JSON.parse(await file.text());
  if (!isProject(p)) throw new Error("Not a ReelForge project file.");
  const f = state.rt.file;
  const matches = !!f && !!p.source && f.name === p.source.name && f.size === p.source.size;
  if (!matches) releaseSource();
  commit(() => p);
}

// ---------- source media (stays local: object URL only, never uploaded) ----------
function releaseSource() {
  if (state.rt.url) URL.revokeObjectURL(state.rt.url);
  setRt({ file: null, url: null, time: 0, playing: false });
}
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|ogg)$/i;

function probe(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    const to = setTimeout(() => rej(new Error("Timed out reading video metadata.")), 15000);
    v.onloadedmetadata = () => {
      clearTimeout(to);
      if (!v.videoWidth || !v.videoHeight) return rej(new Error("No decodable video track (audio-only or unsupported codec)."));
      if (!Number.isFinite(v.duration) || v.duration <= 0) return rej(new Error("The browser could not determine the duration of this file."));
      res({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    };
    v.onerror = () => {
      clearTimeout(to);
      rej(new Error("This browser can't decode this file. Try an MP4 (H.264/AAC) or WebM file."));
    };
    v.src = url;
  });
}

export async function loadSource(file: File) {
  if (!file.type.startsWith("video/") && !VIDEO_EXT.test(file.name)) {
    setRt({ sourceError: `"${file.name}" is not a video file.` });
    return;
  }
  setRt({ loading: true, sourceError: null });
  const url = URL.createObjectURL(file);
  try {
    const m = await probe(url);
    cancelAll();
    const prev = state.project.source;
    const relink = !!prev && prev.name === file.name && prev.size === file.size && state.project.clips.length > 0;
    if (state.rt.url) URL.revokeObjectURL(state.rt.url);
    setRt({ file, url, loading: false, time: 0, playing: false });
    const meta: SourceMeta = {
      name: file.name, size: file.size, type: file.type || "video", lastModified: file.lastModified, ...m,
    };
    if (relink) {
      commit((p) => ({ ...p, source: meta }));
    } else {
      commit((p) => ({
        ...p,
        name: p.clips.length && p.source ? p.name : file.name.replace(/\.[^.]+$/, ""),
        source: meta,
        clips: makeClips(m.duration, p.segmentSeconds),
        captions: [],
      }));
      setRt({ activeId: state.project.clips[0]?.id ?? null, selected: [] });
    }
  } catch (e) {
    URL.revokeObjectURL(url);
    setRt({ loading: false, sourceError: (e as Error).message });
  }
}

export const sourceMissing = (s: State = state) => !!s.project.source && !s.rt.url;

// ---------- export queue ----------
const controllers = new Map<string, AbortController>();
let running = false;
const patchJob = (id: string, p: Partial<Job>) =>
  setRt({ jobs: state.rt.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) });

export function enqueue(clipIds: string[]) {
  const jobs = clipIds
    .map((id) => state.project.clips.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => ({ id: Math.random().toString(36).slice(2), clipId: c!.id, title: c!.title, status: "queued" as const, progress: 0 }));
  setRt({ jobs: [...state.rt.jobs, ...jobs], tab: "export" });
  void run();
}
async function run() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = state.rt.jobs.find((j) => j.status === "queued");
      if (!job) break;
      const clip = state.project.clips.find((c) => c.id === job.clipId);
      const url = state.rt.url;
      if (!clip || !url) {
        patchJob(job.id, { status: "error", error: !url ? "Source video not loaded — relink it first." : "Clip was deleted." });
        continue;
      }
      const ac = new AbortController();
      controllers.set(job.id, ac);
      patchJob(job.id, { status: "rendering", progress: 0 });
      try {
        const p = state.project;
        const r = await exportClip({
          url, clip, captions: p.burnIn ? p.captions : null, style: p.captionStyle, signal: ac.signal,
          onProgress: (x) => patchJob(job.id, { progress: x }),
        });
        patchJob(job.id, {
          status: "done", progress: 1, blob: r.blob, format: r.format,
          fileName: `${slug(clip.title)}_${clip.framing.aspect.replace(":", "x")}.${r.format.ext}`,
          meta: `${r.width}×${r.height} · ${r.duration.toFixed(1)}s · ${(r.blob.size / 1e6).toFixed(1)} MB`,
        });
      } catch (e) {
        const aborted = (e as Error).name === "AbortError";
        patchJob(job.id, { status: aborted ? "canceled" : "error", ...(aborted ? {} : { error: (e as Error).message }) });
      } finally {
        controllers.delete(job.id);
      }
    }
  } finally {
    running = false;
  }
}
export function cancelJob(id: string) {
  const c = controllers.get(id);
  if (c) c.abort();
  else patchJob(id, { status: "canceled" });
}
export function cancelAll() {
  state.rt.jobs.forEach((j) => (j.status === "queued" || j.status === "rendering") && cancelJob(j.id));
}
export const removeJob = (id: string) => setRt({ jobs: state.rt.jobs.filter((j) => j.id !== id) });

export async function downloadZip() {
  const done = state.rt.jobs.filter((j) => j.status === "done" && j.blob);
  if (!done.length) return;
  const files: Record<string, Uint8Array> = {};
  for (const j of done) {
    let n = j.fileName!;
    let k = 2;
    while (files[n]) n = j.fileName!.replace(/(\.\w+)$/, `-${k++}$1`);
    files[n] = new Uint8Array(await j.blob!.arrayBuffer());
    const clip = state.project.clips.find((c) => c.id === j.clipId);
    if (clip) {
      const srt = toSRT(clipCaptions(state.project.captions, clip.start, clip.end));
      if (srt) files[n.replace(/\.\w+$/, ".srt")] = new TextEncoder().encode(srt);
    }
  }
  const zip = zipSync(files, { level: 0 });
  downloadBlob(new Blob([zip.slice().buffer], { type: "application/zip" }), `${slug(state.project.name)}-shorts.zip`);
}
export function downloadClipSRT(clip: Clip) {
  const srt = toSRT(clipCaptions(state.project.captions, clip.start, clip.end));
  downloadBlob(new Blob([srt], { type: "application/x-subrip" }), `${slug(clip.title)}.srt`);
}

// Shared handle to the preview <video> for seeking from the timeline/keyboard.
export const media: { video: HTMLVideoElement | null } = { video: null };
export function seek(t: number) {
  const d = state.project.source?.duration ?? 0;
  const tt = Math.max(0, Math.min(d, t));
  if (media.video) media.video.currentTime = tt;
  setRt({ time: tt });
}
