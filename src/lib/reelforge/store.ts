import { clipSRT, exportSnapshot, readProject, settingsOf } from "./editing";
// Tiny external store: undoable project + non-undoable runtime state.
import { useSyncExternalStore } from "react";
import { zipSync } from "fflate";
import {
  makeClips, newProject, slug, uid,
  type Clip, type Project, type SourceMeta,
} from "./core";
import { downloadBlob, exportClip, type ExportFormat } from "./exporter";
import { exportClipFast, fastExportSupported, FastExportUnavailable } from "./fast-export";

export type Tab = "templates" | "clip" | "frame" | "captions" | "export" | "color" | "audio" | "titles" | "markers";
export interface Job {
  id: string;
  clipId: string;
  title: string;
  status: "queued" | "rendering" | "done" | "error" | "canceled";
  progress: number;
  snapshot: ReturnType<typeof exportSnapshot>;
  sourceFile: File;
  blob?: Blob;
  format?: ExportFormat;
  fileName?: string;
  error?: string;
  meta?: string;
  /** Which exporter produced (or is producing) the file. */
  path?: "fast" | "realtime";
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
  timelineZoom: number;
  snapping: boolean;
  stepFps: number;
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
    activeCaptionId: null, time: 0, playing: false, tab: "clip", safeZone: true, timelineZoom: 1, snapping: true, stepFps: 30, jobs: [], hydrated: false,
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

export function addMarker(time: number) {
  commit((p) => ({
    ...p,
    markers: [
      ...(p.markers ?? []),
      { id: uid(), time, name: `Marker ${(p.markers?.length ?? 0) + 1}` },
    ].sort((a, b) => a.time - b.time),
  }));
}

// A different source/project cannot share undo history with the currently linked File.
function replaceProject(project: Project) {
  lastKey = "";
  state = { ...state, project, past: [], future: [] };
  fixSelection(); emit(); save();
}

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
    if (p) state = { ...state, project: readProject(p) };
  } catch { /* ignore */ }
  state = { ...state, rt: { ...state.rt, hydrated: true } };
  fixSelection();
  emit();
}
export function newProjectAction() {
  cancelAll();
  releaseSource();
  replaceProject(newProject());
}
export function exportProjectJSON() {
  const p = state.project;
  downloadBlob(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }), `${slug(p.name)}.reelforge.json`);
}
export async function importProjectJSON(file: File) {
  const p = readProject(JSON.parse(await file.text()));
  cancelAll();
  const f = state.rt.file;
  const matches = !!f && !!p.source && f.name === p.source.name && f.size === p.source.size;
  if (!matches) releaseSource();
  replaceProject(p);
}

// ---------- source media (stays local: object URL only, never uploaded) ----------
function releaseSource() {
  media.video?.pause();
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
        markers: [],
      }));
      replaceProject(state.project);
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
  const file = state.rt.file;
  if (!file) return;
  const jobs: Job[] = clipIds.flatMap(id => {
    const clip = state.project.clips.find(c => c.id === id);
    if (!clip) return [];
    return [{ id: Math.random().toString(36).slice(2), clipId: id, title: clip.title,
      status: 'queued', progress: 0, snapshot: exportSnapshot(state.project, clip), sourceFile: file }];
  });
  media.video?.pause();
  setRt({ jobs: [...state.rt.jobs, ...jobs], tab: "export", playing: false });
  void run();
}
async function run() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = state.rt.jobs.find((j) => j.status === "queued");
      if (!job) break;
      const { clip, captions, style, settings } = job.snapshot;
      const url = URL.createObjectURL(job.sourceFile);
      const ac = new AbortController();
      controllers.set(job.id, ac);
      patchJob(job.id, { status: "rendering", progress: 0 });
      try {
        const onProgress = (x: number) => patchJob(job.id, { progress: x });
        const realtime = () => {
          patchJob(job.id, { path: "realtime", progress: 0 });
          return exportClip({
            url,
            clip,
            captions,
            style,
            settings,
            signal: ac.signal,
            onProgress,
          });
        };
        let r: Awaited<ReturnType<typeof exportClip>>;
        if (!fastExportSupported()) {
          if (settingsOf(settings).resolution === 2160)
            throw new Error(
              "4K export needs WebCodecs, which this browser doesn't provide. Choose 1080p or use Chrome/Edge.",
            );
          r = await realtime();
        } else {
          try {
            // Fast path: WebCodecs, frame-exact, faster than real time, up to 4K.
            patchJob(job.id, { path: "fast" });
            r = await exportClipFast({
              file: job.sourceFile,
              clip,
              captions,
              style,
              settings,
              signal: ac.signal,
              onProgress,
            });
          } catch (e) {
            // Fall back to real-time capture only when WebCodecs can't handle this source/size.
            if (!(e instanceof FastExportUnavailable) || settingsOf(settings).resolution === 2160)
              throw e;
            r = await realtime();
          }
        }
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
        URL.revokeObjectURL(url);
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
    const srt = j.snapshot.srt;
    if (srt) files[n.replace(/\.\w+$/, ".srt")] = new TextEncoder().encode(srt);
  }
  const zip = zipSync(files, { level: 0 });
  downloadBlob(new Blob([zip.slice().buffer], { type: "application/zip" }), `${slug(state.project.name)}-shorts.zip`);
}
export function downloadClipSRT(clip: Clip) {
  const srt = clipSRT(state.project.captions, clip);
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
