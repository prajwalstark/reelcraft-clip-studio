import {
  ALL_FORMATS,
  Input,
  BlobSource,
  CanvasSink,
  AudioBufferSink,
  CanvasSource,
  AudioBufferSource,
  Output,
  BufferTarget,
  Mp4OutputFormat,
  WebMOutputFormat,
  Quality,
  canEncodeVideo,
  canEncodeAudio,
} from "mediabunny";
import type { WrappedCanvas, WrappedAudioBuffer } from "mediabunny";
import {
  type Asset,
  type Sequence,
  type Item,
  id,
  MAX_SECONDS,
  assetOf,
  clipLevel,
  levelAt,
  visualItems,
  totalFrames,
  dimensions,
  trackOf,
  end,
} from "./model";
export type Files = Map<string, File>;
export const RATE = 48000;
export function bounded<T>(promise: Promise<T>, signal: AbortSignal, ms = 30000): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(new DOMException("Operation canceled", "AbortError")));
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error("Media operation timed out. Try another format or shorter source.")),
        ),
      ms,
    );
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      fn();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(
      (v) => finish(() => resolve(v)),
      (e) => finish(() => reject(e)),
    );
  });
}
export async function probe(file: File, signal: AbortSignal): Promise<Asset> {
  const base = {
    id: id(),
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    peaks: [] as number[],
  };
  if (file.type.startsWith("image/")) {
    // createImageBitmap cannot be canceled; close even if cancellation wins the race.
    const task = createImageBitmap(file);
    task.then(
      (b) => {
        if (signal.aborted) b.close();
      },
      () => {},
    );
    const b = await bounded(task, signal);
    try {
      return {
        ...base,
        kind: "image",
        duration: MAX_SECONDS,
        origin: 0,
        width: b.width,
        height: b.height,
        hasAudio: false,
      };
    } finally {
      b.close();
    }
  }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const dispose = () => input.dispose();
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const video = await bounded(input.getPrimaryVideoTrack(), signal),
      audio = await bounded(input.getPrimaryAudioTrack(), signal);
    if (!video && !audio) throw new Error("No supported video or audio track found.");
    if (video && !(await bounded(video.canDecode(), signal)))
      throw new Error("This browser cannot decode this video codec. Convert it to H.264 first.");
    if (audio && !(await bounded(audio.canDecode(), signal)))
      throw new Error("This browser cannot decode the audio. Convert it to AAC or Opus first.");
    const origin = await bounded((video ?? audio)!.getFirstTimestamp(), signal);
    const duration =
      (await bounded(input.computeDuration(video ? [video] : [audio!]), signal)) - origin;
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("Media has no finite duration.");
    const peaks: number[] = [];
    if (audio) {
      const sink = new AudioBufferSink(audio);
      const timestamps = Array.from({ length: 128 }, (_, i) => origin + (duration * i) / 128);
      const iterator = sink.buffersAtTimestamps(timestamps);
      try {
        for (let i = 0; i < timestamps.length; i++) {
          const next = await bounded(iterator.next(), signal);
          if (next.done) break;
          let peak = 0;
          if (next.value)
            for (let ch = 0; ch < next.value.buffer.numberOfChannels; ch++) {
              const samples = next.value.buffer.getChannelData(ch);
              for (let j = 0; j < samples.length; j++) peak = Math.max(peak, Math.abs(samples[j]!));
            }
          peaks.push(Math.min(1, peak));
        }
      } finally {
        void iterator.return().catch(() => {});
      }
    }
    return {
      ...base,
      kind: video ? "video" : "audio",
      duration,
      origin,
      width: video?.displayWidth ?? 0,
      height: video?.displayHeight ?? 0,
      hasAudio: !!audio,
      peaks,
    };
  } finally {
    signal.removeEventListener("abort", dispose);
    input.dispose();
  }
}

/** Stereo mix at exact sequence timestamps. Mono is duplicated; multichannel sources use their first two channels. */
export function mixPacket(
  out: Float32Array[],
  packet: WrappedAudioBuffer,
  s: Sequence,
  c: Item,
  origin: number,
) {
  const sourceStart = origin + c.sourceIn,
    timelineStart = c.start / s.fps;
  const first = Math.max(
    0,
    Math.ceil(timelineStart * RATE),
    Math.ceil((timelineStart + packet.timestamp - sourceStart) * RATE),
  );
  const last = Math.min(
    out[0]!.length,
    Math.ceil((end(c) / s.fps) * RATE),
    Math.ceil((timelineStart + packet.timestamp + packet.duration - sourceStart) * RATE),
  );
  const channels = out.map((_, ch) =>
    packet.buffer.getChannelData(Math.min(ch, packet.buffer.numberOfChannels - 1)),
  );
  const gainAt = levelAt(s, c, true);
  for (let n = first; n < last; n++) {
    const p =
      (n / RATE - timelineStart + sourceStart - packet.timestamp) * packet.buffer.sampleRate;
    const i = Math.max(0, Math.floor(p)),
      f = p - i;
    if (i >= packet.buffer.length) continue;
    const gain = gainAt((n / RATE) * s.fps);
    for (let ch = 0; ch < out.length; ch++) {
      const data = channels[ch]!;
      out[ch]![n]! += (data[i]! * (1 - f) + data[Math.min(i + 1, data.length - 1)]! * f) * gain;
    }
  }
}
export class MediaSession {
  private inputs = new Map<string, Input>();
  private pictures = new Map<string, ImageBitmap>();
  private sinks = new Map<string, CanvasSink>();
  private iterators = new Map<string, AsyncGenerator<WrappedCanvas | null, void, unknown>>();
  private closed = false;
  constructor(
    readonly s: Sequence,
    readonly files: Files,
    readonly signal: AbortSignal,
  ) {
    signal.addEventListener("abort", this.dispose, { once: true });
  }
  dispose = () => {
    if (this.closed) return;
    this.closed = true;
    this.signal.removeEventListener("abort", this.dispose);
    for (const input of this.inputs.values()) input.dispose();
    for (const b of this.pictures.values()) b.close();
    for (const it of this.iterators.values()) void it.return().catch(() => {});
    this.inputs.clear();
    this.pictures.clear();
    this.sinks.clear();
    this.iterators.clear();
  };
  private file(a: Asset) {
    this.signal.throwIfAborted();
    if (this.closed) throw new Error("Media session closed.");
    const f = this.files.get(a.id);
    if (!f) throw new Error(`Relink ${a.name} before playing or exporting.`);
    return f;
  }
  private input(a: Asset) {
    let input = this.inputs.get(a.id);
    if (!input) {
      input = new Input({ source: new BlobSource(this.file(a)), formats: ALL_FORMATS });
      this.inputs.set(a.id, input);
    }
    return input;
  }
  async draw(canvas: HTMLCanvasElement, frame: number, sequential = false) {
    this.signal.throwIfAborted();
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable.");
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const c of visualItems(this.s, frame)) {
      const a = assetOf(this.s, c);
      let image: CanvasImageSource;
      if (a.kind === "image") {
        let b = this.pictures.get(a.id);
        if (!b) {
          const task = createImageBitmap(this.file(a));
          task.then(
            (x) => {
              if (this.closed) x.close();
            },
            () => {},
          );
          b = await bounded(task, this.signal);
          this.pictures.set(a.id, b);
        }
        image = b;
      } else {
        const key = sequential ? c.id : a.id;
        let sink = this.sinks.get(key);
        if (!sink) {
          const track = await bounded(this.input(a).getPrimaryVideoTrack(), this.signal);
          if (!track || !(await bounded(track.canDecode(), this.signal)))
            throw new Error(`Cannot decode ${a.name}.`);
          sink = new CanvasSink(track, { poolSize: 1, width: Math.min(a.width, canvas.width * 2) });
          this.sinks.set(key, sink);
        }
        let wrapped: WrappedCanvas | null | undefined;
        if (sequential) {
          let it = this.iterators.get(c.id);
          if (!it) {
            const times = Array.from(
              { length: c.frames },
              (_, i) => a.origin + c.sourceIn + i / this.s.fps,
            );
            it = sink.canvasesAtTimestamps(times);
            this.iterators.set(c.id, it);
          }
          const next = await bounded(it.next(), this.signal);
          wrapped = next.done ? null : next.value;
        } else
          wrapped = await bounded(
            sink.getCanvas(a.origin + c.sourceIn + (frame - c.start) / this.s.fps),
            this.signal,
          );
        if (!wrapped) throw new Error(`No decoded frame in ${a.name} at the requested time.`);
        image = wrapped.canvas;
      }
      this.signal.throwIfAborted();
      const ratio =
        (c.fit === "cover" ? Math.max : Math.min)(
          canvas.width / a.width,
          canvas.height / a.height,
        ) * c.scale;
      const w = a.width * ratio,
        h = a.height * ratio;
      ctx.globalAlpha = clipLevel(this.s, c, frame);
      ctx.drawImage(image, canvas.width * c.x - w / 2, canvas.height * c.y - h / 2, w, h);
      if (sequential && frame === end(c) - 1) {
        const iterator = this.iterators.get(c.id);
        if (iterator) await bounded(iterator.return(), this.signal);
        this.iterators.delete(c.id);
        this.sinks.delete(c.id);
      }
    }
    ctx.globalAlpha = 1;
  }
  async audio(progress: (value: number) => void = () => {}): Promise<AudioBuffer | null> {
    const clips = this.s.items.filter(
      (c) => assetOf(this.s, c).hasAudio && c.volume > 0 && !trackOf(this.s, c.track).muted,
    );
    if (!clips.length) return null;
    const length = Math.ceil((totalFrames(this.s) / this.s.fps) * RATE),
      out = [new Float32Array(length), new Float32Array(length)];
    for (let index = 0; index < clips.length; index++) {
      const c = clips[index]!,
        a = assetOf(this.s, c),
        track = await bounded(this.input(a).getPrimaryAudioTrack(), this.signal);
      if (!track || !(await bounded(track.canDecode(), this.signal)))
        throw new Error(`Cannot decode audio in ${a.name}; export stopped to avoid losing sound.`);
      const iterator = new AudioBufferSink(track).buffers(
        a.origin + c.sourceIn,
        a.origin + c.sourceIn + c.frames / this.s.fps,
      );
      try {
        while (true) {
          const next = await bounded(iterator.next(), this.signal);
          if (next.done) break;
          mixPacket(out, next.value, this.s, c, a.origin);
        }
      } finally {
        void iterator.return().catch(() => {});
      }
      progress((index + 1) / clips.length);
    }
    this.signal.throwIfAborted();
    const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: RATE });
    out.forEach((data, ch) => {
      for (let i = 0; i < data.length; i++) data[i] = Math.max(-1, Math.min(1, data[i]!));
      buffer.copyToChannel(data, ch);
    });
    return buffer;
  }
}
export async function exportSequence(
  s: Sequence,
  files: Files,
  res: 720 | 1080,
  signal: AbortSignal,
  progress: (message: string) => void,
) {
  const frames = totalFrames(s);
  if (!frames) throw new Error("Add clips before exporting.");
  for (const c of s.items)
    if (!files.has(c.assetId)) throw new Error(`Relink ${assetOf(s, c).name} before exporting.`);
  const session = new MediaSession(s, files, signal);
  let output: Output | undefined;
  try {
    progress("Mixing audio…");
    const audio = await session.audio((p) => progress(`Mixing audio ${Math.round(p * 100)}%`));
    const size = dimensions(s, res),
      quality = new Quality({ bitrate: res === 1080 ? 8e6 : 4e6 }),
      audioQuality = new Quality({ bitrate: 128e3 });
    const supported = async (v: "avc" | "vp9", a: "aac" | "opus") =>
      (await bounded(canEncodeVideo(v, { ...size, frameRate: s.fps, quality }), signal)) &&
      (!audio ||
        (await bounded(
          canEncodeAudio(a, { numberOfChannels: 2, sampleRate: RATE, quality: audioQuality }),
          signal,
        )));
    const mp4 = await supported("avc", "aac");
    if (!mp4 && !(await supported("vp9", "opus")))
      throw new Error("This browser has no compatible encoder. Try current Chrome or Edge.");
    const canvas = document.createElement("canvas");
    Object.assign(canvas, size);
    const target = new BufferTarget();
    output = new Output({ format: mp4 ? new Mp4OutputFormat() : new WebMOutputFormat(), target });
    const video = new CanvasSource(canvas, { codec: mp4 ? "avc" : "vp9", quality });
    output.addVideoTrack(video, { frameRate: s.fps });
    const sound = audio
      ? new AudioBufferSource({ codec: mp4 ? "aac" : "opus", quality: audioQuality })
      : null;
    if (sound) output.addAudioTrack(sound);
    await bounded(output.start(), signal);
    for (let frame = 0; frame < frames; frame++) {
      signal.throwIfAborted();
      await session.draw(canvas, frame, true);
      await bounded(video.add(frame / s.fps, 1 / s.fps), signal);
      if (sound && audio && frame % s.fps === 0) {
        const start = (frame / s.fps) * RATE,
          len = Math.min(RATE, audio.length - start);
        const chunk = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: RATE });
        for (let ch = 0; ch < 2; ch++)
          chunk.copyToChannel(audio.getChannelData(ch).subarray(start, start + len), ch);
        await bounded(sound.add(chunk), signal);
      }
      if (frame % 12 === 0)
        progress(`Encoding ${mp4 ? "MP4" : "WebM"} ${Math.round(((frame + 1) / frames) * 100)}%`);
    }
    video.close();
    sound?.close();
    progress("Finalizing file…");
    await bounded(output.finalize(), signal, 60000);
    signal.throwIfAborted();
    if (!target.buffer) throw new Error("Encoder returned an empty file.");
    return {
      blob: new Blob([target.buffer], { type: mp4 ? "video/mp4" : "video/webm" }),
      extension: mp4 ? "mp4" : "webm",
    };
  } finally {
    session.dispose();
    if (output && output.state !== "finalized") void output.cancel().catch(() => {});
  }
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
