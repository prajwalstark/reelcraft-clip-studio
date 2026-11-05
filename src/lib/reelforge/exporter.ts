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

export function exportClip(opts: {
  url: string;
  clip: Clip;
  captions: Caption[] | null; // source-timed captions, or null for no burn-in
  style: CaptionStyle;
  signal: AbortSignal;
  onProgress: (p: number) => void;
}): Promise<ExportResult> {
  const { url, clip, captions, style, signal, onProgress } = opts;
  const format = pickFormat();
  if (!format) return Promise.reject(new Error("This browser cannot record canvas video (MediaRecorder/captureStream missing)."));
  const { w, h } = ASPECTS[clip.framing.aspect];

  return new Promise<ExportResult>((resolve, reject) => {
    const video = document.createElement("video");
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(30);
    let audioCtx: AudioContext | null = null;
    let rec: MediaRecorder | null = null;
    let timer = 0;
    let done = false;
    const chunks: Blob[] = [];

    const cleanup = () => {
      done = true;
      clearInterval(timer);
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
      if (done || !rec) return;
      done = true;
      video.pause();
      draw();
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: format.mime.split(";")[0] ?? "video/webm" });
        cleanup();
        if (!blob.size) reject(new Error("Recorder produced an empty file."));
        else resolve({ blob, format, width: w, height: h, duration: clip.end - clip.start });
      };
      rec.stop();
    };

    video.onloadedmetadata = async () => {
      try {
        try {
          audioCtx = new AudioContext();
          const src = audioCtx.createMediaElementSource(video);
          const dest = audioCtx.createMediaStreamDestination();
          src.connect(dest); // routed to the recording only, not the speakers
          dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        } catch {
          audioCtx = null; // export continues without audio
        }
        video.currentTime = clip.start;
        await new Promise<void>((r) => video.addEventListener("seeked", () => r(), { once: true }));
        if (signal.aborted) return;
        draw();
        rec = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onerror = () => fail(new Error("MediaRecorder error during export."));
        rec.start(500);
        await audioCtx?.resume();
        await video.play();
        const span = clip.end - clip.start;
        const loop = () => {
          if (done) return;
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
        }, 100);
      } catch (e) {
        fail(e);
      }
    };
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
