// Real-time browser export: canvas compositing + source audio via WebAudio -> MediaRecorder.
import { ASPECTS, type Caption, type CaptionStyle, type Clip } from "./core";
import { drawFrame } from "./render";

const CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export interface ExportFormat { mime: string; ext: "mp4" | "webm"; label: string }

export function pickFormat(): ExportFormat | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
  for (const m of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) {
      const mp4 = m.startsWith("video/mp4");
      return { mime: m, ext: mp4 ? "mp4" : "webm", label: mp4 ? "MP4 (H.264)" : "WebM fallback (VP9/VP8 + Opus)" };
    }
  }
  return null;
}

export interface ExportResult { blob: Blob; format: ExportFormat; width: number; height: number; duration: number }

const canceled = () => new DOMException("Export canceled", "AbortError");

/** Wait for a decoded frame, including no-op seeks at zero. Never wait indefinitely. */
export function seekVideo(video: HTMLVideoElement, time: number, signal: AbortSignal, timeoutMs = 10_000): Promise<void> {
  if (signal.aborted) return Promise.reject(canceled());
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(poll);
      video.removeEventListener("seeked", check);
      video.removeEventListener("loadeddata", check);
      video.removeEventListener("error", error);
      signal.removeEventListener("abort", abort);
    };
    const finish = (err?: Error) => { cleanup(); if (err) reject(err); else resolve(); };
    const check = () => {
      if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.05) finish();
    };
    const error = () => finish(new Error("Cannot decode the selected frame. Try an MP4 (H.264/AAC) source."));
    const abort = () => finish(canceled());
    const timeout = setTimeout(() => finish(new Error("Seeking timed out. Reload the source video and try exporting again.")), timeoutMs);
    const poll = setInterval(check, 50);
    video.addEventListener("seeked", check);
    video.addEventListener("loadeddata", check);
    video.addEventListener("error", error);
    signal.addEventListener("abort", abort, { once: true });
    try { video.currentTime = time; check(); } catch (err) { finish(err instanceof Error ? err : new Error(String(err))); }
  });
}

/** Audio setup must succeed; exporting silently without sound is not acceptable. */
export async function prepareAudio(video: HTMLVideoElement, stream: MediaStream, signal: AbortSignal, timeoutMs = 10_000): Promise<AudioContext> {
  if (signal.aborted) throw canceled();
  let context: AudioContext | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    context = new AudioContext();
    const source = context.createMediaElementSource(video);
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    const tracks = destination.stream.getAudioTracks();
    if (!tracks.length) throw new Error("No audio recording track available");
    tracks.forEach((track) => stream.addTrack(track));
    await Promise.race([
      context.resume(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Audio activation timed out")), timeoutMs);
        abort = () => reject(canceled());
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
    if (signal.aborted) throw canceled();
    if (context.state !== "running") throw new Error("Audio context is not running");
    return context;
  } catch (error) {
    if (context) await context.close().catch(() => {});
    if (signal.aborted) throw canceled();
    throw new Error("Audio could not be initialized. Allow sound/autoplay for this site, then click Export again. Try Chrome or an MP4 with AAC audio if this persists.", { cause: error });
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}

export function exportClip(opts: {
  url: string;
  clip: Clip;
  captions: Caption[] | null; // source-timed captions, or null for no burn-in
  style: CaptionStyle;
  signal: AbortSignal;
  onProgress: (p: number) => void;
}): Promise<ExportResult> {
  const { url, clip, captions, style, signal, onProgress } = opts;
  if (signal.aborted) return Promise.reject(canceled());
  const format = pickFormat();
  if (!format) return Promise.reject(new Error("This browser cannot record canvas video (MediaRecorder/captureStream missing)."));
  const { w, h } = ASPECTS[clip.framing.aspect];

  return new Promise<ExportResult>((resolve, reject) => {
    const video = document.createElement("video");
    video.playsInline = true;
    video.preload = "auto";
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("Canvas rendering unavailable. Try Chrome and export again.")); return; }
    const stream = canvas.captureStream(30);
    let audioCtx: AudioContext | null = null;
    let rec: MediaRecorder | null = null;
    let timer = 0;
    let done = false;
    let finishing = false;
    let lastTime = clip.start;
    let lastAdvance = performance.now();
    const metadataTimeout = setTimeout(() => fail(new Error("Source loading timed out. Reload the video and try again.")), 15_000);
    const chunks: Blob[] = [];

    const cleanup = () => {
      done = true;
      clearInterval(timer);
      clearTimeout(metadataTimeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      try { video.pause(); } catch { /* noop */ }
      stream.getTracks().forEach((t) => t.stop());
      audioCtx?.close().catch(() => {});
      video.removeAttribute("src");
      video.load();
      signal.removeEventListener("abort", onAbort);
    };
    const fail = (e: unknown) => {
      if (done) return;
      if (rec && rec.state !== "inactive") { rec.onstop = null; rec.stop(); }
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    const onAbort = () => fail(new DOMException("Export canceled", "AbortError"));
    signal.addEventListener("abort", onAbort);
    video.onerror = () => fail(new Error("The source video could not be decoded for export."));

    const draw = () => drawFrame(ctx, video, w, h, clip.framing, captions, style, video.currentTime);

    const finish = () => {
      if (done || finishing || !rec) return;
      finishing = true;
      video.pause();
      draw();
      rec.onstop = () => {
        if (done) return;
        const blob = new Blob(chunks, { type: format.mime.split(";")[0] ?? "video/webm" });
        cleanup();
        if (!blob.size) reject(new Error("Recorder produced an empty file."));
        else resolve({ blob, format, width: w, height: h, duration: clip.end - clip.start });
      };
      rec.stop();
    };

    video.onloadedmetadata = async () => {
      clearTimeout(metadataTimeout);
      try {
        audioCtx = await prepareAudio(video, stream, signal);
        if (done) { void audioCtx.close().catch(() => {}); return; }
        await seekVideo(video, clip.start, signal);
        if (done || signal.aborted) { onAbort(); return; }
        draw();
        rec = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onerror = () => fail(new Error("MediaRecorder error during export."));
        rec.start(500);
        await video.play();
        if (done) return;
        lastAdvance = performance.now();
        const span = clip.end - clip.start;
        const loop = () => {
          if (done || finishing) return;
          draw();
          onProgress(Math.min(1, Math.max(0, (video.currentTime - clip.start) / span)));
          if (video.currentTime >= clip.end || video.ended) finish();
          else if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(loop);
          else requestAnimationFrame(loop);
        };
        loop();
        // Safety net for end detection if frame callbacks are throttled.
        timer = window.setInterval(() => {
          if (!done && (video.currentTime >= clip.end || video.ended)) finish();
          if (video.currentTime > lastTime + 0.001) { lastTime = video.currentTime; lastAdvance = performance.now(); }
          if (!done && !finishing && performance.now() - lastAdvance > 15_000) fail(new Error("Export playback stalled. Keep the tab visible, reload the source, and try again."));
        }, 25);
      } catch (e) {
        fail(e);
      }
    };
    video.src = url;
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
