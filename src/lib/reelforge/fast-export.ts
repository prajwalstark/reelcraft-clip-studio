// Frame-exact offline export for the Shorts editor (up to 4K).
// Frames are decoded at their exact timestamps with Mediabunny (WebCodecs), composited with the
// same drawFrame() the preview uses, and encoded offline — no playback, so no dropped frames.
// Speed depends on the device: hardware video support makes it faster than real time. Audio is decoded, time-stretched for speed changes
// (pitch preserved), shaped with the clip's volume/fades and encoded alongside.
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  VideoSampleSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type VideoSample,
} from "mediabunny";
import { bounded } from "@/lib/sequence/media";
import type { Caption, CaptionStyle, Clip } from "./core";
import {
  audioGain,
  audioOf,
  outputDuration,
  outputSize,
  settingsOf,
  speedOf,
  type ExportSettings,
} from "./editing";
import type { ExportFormat, ExportResult } from "./exporter";
import { drawFrame } from "./render";
import { timeStretch } from "./timestretch";

type Planar = Float32Array<ArrayBuffer>[];
const AUDIO_RATE = 48000;
const AUDIO_BITRATE = 160_000;

/** The fast path cannot run here; the caller may fall back to real-time capture. */
export class FastExportUnavailable extends Error {
  override name = "FastExportUnavailable";
}

export const fastExportSupported = () =>
  typeof VideoDecoder !== "undefined" &&
  typeof VideoEncoder !== "undefined" &&
  typeof AudioEncoder !== "undefined";

export interface FastExportOptions {
  file: File;
  clip: Clip;
  captions: Caption[] | null;
  style: CaptionStyle;
  settings?: ExportSettings | undefined;
  signal: AbortSignal;
  onProgress: (p: number) => void;
}

/** Output-time → source-time frame timestamps for a clip (exported for tests). */
export function frameTimes(clip: Clip, fps: number) {
  const frames = Math.max(1, Math.round(outputDuration(clip) * fps));
  const speed = speedOf(clip);
  const last = clip.end - 1e-3;
  return Array.from({ length: frames }, (_, i) => Math.min(last, clip.start + (i / fps) * speed));
}

/** Decode [clip.start, clip.end) of the audio track to planar stereo at its native rate. */
async function decodeAudio(
  track: Awaited<ReturnType<Input["getPrimaryAudioTrack"]>>,
  origin: number,
  clip: Clip,
  signal: AbortSignal,
) {
  if (!track) return null;
  const span = clip.end - clip.start;
  let rate = 0;
  let out: Planar = [];
  const it = new AudioBufferSink(track).buffers(origin + clip.start, origin + clip.end);
  try {
    for (;;) {
      const next = await bounded(it.next(), signal);
      if (next.done) break;
      const { buffer, timestamp } = next.value;
      if (!rate) {
        rate = buffer.sampleRate;
        out = [new Float32Array(Math.ceil(span * rate)), new Float32Array(Math.ceil(span * rate))];
      }
      const offset = Math.round((timestamp - origin - clip.start) * rate);
      for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
        const dst = out[ch]!;
        for (let i = Math.max(0, -offset); i < data.length && offset + i < dst.length; i++)
          dst[offset + i] = data[i]!;
      }
    }
  } finally {
    void it.return().catch(() => {});
  }
  return rate ? { rate, channels: out } : null;
}

/** Resample to 48 kHz (what every web encoder accepts), stretch for speed, apply volume/fades. */
async function shapeAudio(
  decoded: { rate: number; channels: Planar },
  clip: Clip,
): Promise<Planar> {
  let channels: Planar = decoded.channels;
  if (decoded.rate !== AUDIO_RATE) {
    const src = new AudioBuffer({
      numberOfChannels: 2,
      length: channels[0]!.length,
      sampleRate: decoded.rate,
    });
    channels.forEach((c, i) => src.copyToChannel(c, i));
    const offline = new OfflineAudioContext(
      2,
      Math.ceil((src.length * AUDIO_RATE) / decoded.rate),
      AUDIO_RATE,
    );
    const node = offline.createBufferSource();
    node.buffer = src;
    node.connect(offline.destination);
    node.start();
    const rendered = await offline.startRendering();
    channels = [rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()];
  }
  const speed = speedOf(clip);
  if (speed !== 1) channels = timeStretch(channels, AUDIO_RATE, speed);
  const length = Math.round(outputDuration(clip) * AUDIO_RATE);
  const shaped = channels.map((c) => {
    const o = new Float32Array(length);
    o.set(c.subarray(0, length));
    return o;
  });
  // Volume and fades, evaluated per 1 ms block on the same curve as preview/real-time export.
  const block = AUDIO_RATE / 1000;
  for (let b = 0; b < length; b += block) {
    const g = audioGain(clip, clip.start + (b / AUDIO_RATE) * speed);
    for (const ch of shaped)
      for (let i = b; i < Math.min(length, b + block); i++)
        ch[i]! = Math.max(-1, Math.min(1, ch[i]! * g));
  }
  return shaped;
}

export async function exportClipFast(opts: FastExportOptions): Promise<ExportResult> {
  const { file, clip, captions, style, signal, onProgress } = opts;
  if (!fastExportSupported())
    throw new FastExportUnavailable("WebCodecs is not available in this browser.");
  const settings = settingsOf(opts.settings);
  const { w, h, fps, bitrate } = outputSize(clip, settings);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let output: Output | undefined;
  try {
    const vtrack = await bounded(input.getPrimaryVideoTrack(), signal);
    if (!vtrack) throw new Error("The source has no video track.");
    if (!(await bounded(vtrack.canDecode(), signal)))
      throw new FastExportUnavailable(
        "This browser cannot decode the source video codec with WebCodecs.",
      );
    const atrack = await bounded(input.getPrimaryAudioTrack(), signal);
    // A source with sound must keep it: if its audio can't be decoded, don't export silently.
    if (atrack && !(await bounded(atrack.canDecode(), signal)))
      throw new FastExportUnavailable(
        "This browser cannot decode the source audio with WebCodecs.",
      );
    const origin = await bounded(vtrack.getFirstTimestamp(), signal);
    // A muted (or zero-volume) clip exports without an audio track.
    const sound = audioOf(clip);
    const withAudio = !!atrack && !sound.muted && sound.volume > 0;

    const supports = async (v: "avc" | "vp9", a: "aac" | "opus") =>
      (await bounded(canEncodeVideo(v, { width: w, height: h, bitrate }), signal)) &&
      (!withAudio ||
        (await bounded(
          canEncodeAudio(a, {
            numberOfChannels: 2,
            sampleRate: AUDIO_RATE,
            bitrate: AUDIO_BITRATE,
          }),
          signal,
        )));
    const mp4 = await supports("avc", "aac");
    if (!mp4 && !(await supports("vp9", "opus"))) {
      const msg = `This browser cannot encode ${w}×${h} video${withAudio ? " with audio" : ""} using WebCodecs.`;
      // 4K has no real-time fallback; lower resolutions may still use real-time capture.
      if (settings.resolution === 2160)
        throw new Error(
          `${msg} Choose 1080p, or try Chrome/Edge on a device with a 4K-capable encoder. No lower-resolution file was substituted.`,
        );
      throw new FastExportUnavailable(msg);
    }

    // Audio first (small), so a decode problem fails before minutes of video encoding.
    let audio: Planar | null = null;
    if (withAudio) {
      const decoded = await decodeAudio(atrack, origin, clip, signal);
      if (decoded) audio = await shapeAudio(decoded, clip);
    }
    onProgress(0.04);
    signal.throwIfAborted();

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering unavailable. Try Chrome and export again.");
    const target = new BufferTarget();
    output = new Output({ format: mp4 ? new Mp4OutputFormat() : new WebMOutputFormat(), target });
    const vsource = new CanvasSource(canvas, { codec: mp4 ? "avc" : "vp9", bitrate });
    output.addVideoTrack(vsource, { frameRate: fps });
    const asource = audio
      ? new AudioBufferSource({ codec: mp4 ? "aac" : "opus", bitrate: AUDIO_BITRATE })
      : null;
    if (asource) output.addAudioTrack(asource);
    await bounded(output.start(), signal);

    // Decoded samples are drawn straight into the compositor (no intermediate canvas copy);
    // VideoSample.draw applies the source's rotation/flip, so phone footage stays upright.
    const times = frameTimes(clip, fps);
    const frames = new VideoSampleSink(vtrack).samplesAtTimestamps(times.map((t) => origin + t));
    let last: VideoSample | null = null;
    let audioSent = 0;
    let pendingEncode: Promise<void> | null = null;
    try {
      for (let i = 0; i < times.length; i++) {
        signal.throwIfAborted();
        const next = await bounded(frames.next(), signal);
        const sample = next.done ? null : next.value;
        if (sample && sample !== last) {
          last?.close();
          last = sample;
        }
        if (last) {
          const frame = last;
          const source = {
            width: frame.displayWidth,
            height: frame.displayHeight,
            draw: (c: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number) =>
              frame.draw(c, dx, dy, dw, dh),
          };
          drawFrame(ctx, source, w, h, clip.framing, captions, style, times[i]!, clip);
        } else {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, w, h);
        }
        // add() snapshots the canvas synchronously and returns a backpressure promise; keeping
        // one encode in flight lets the next frame decode while this one encodes.
        if (pendingEncode) await bounded(pendingEncode, signal);
        pendingEncode = vsource.add(i / fps, 1 / fps);
        // Interleave ~1 s of audio per second of video so the muxer can write as it goes.
        if (asource && audio) {
          const until = Math.min(audio[0]!.length, Math.round(((i + 1) / fps + 1) * AUDIO_RATE));
          if (until - audioSent >= AUDIO_RATE || i === times.length - 1) {
            const end = i === times.length - 1 ? audio[0]!.length : until;
            if (end > audioSent) {
              const chunk = new AudioBuffer({
                numberOfChannels: 2,
                length: end - audioSent,
                sampleRate: AUDIO_RATE,
              });
              audio.forEach((c, ch) => chunk.copyToChannel(c.subarray(audioSent, end), ch));
              await bounded(asource.add(chunk), signal);
              audioSent = end;
            }
          }
        }
        if (i % 6 === 0) onProgress(0.04 + 0.92 * ((i + 1) / times.length));
      }
      if (pendingEncode) await bounded(pendingEncode, signal);
    } finally {
      last?.close();
      void frames.return().catch(() => {});
    }
    vsource.close();
    asource?.close();
    await bounded(output.finalize(), signal, 120_000);
    signal.throwIfAborted();
    if (!target.buffer?.byteLength) throw new Error("The encoder returned an empty file.");
    onProgress(1);
    const format: ExportFormat = mp4
      ? { mime: "video/mp4", ext: "mp4", label: "MP4 (H.264 + AAC)" }
      : { mime: "video/webm", ext: "webm", label: "WebM (VP9 + Opus)" };
    return {
      blob: new Blob([target.buffer], { type: format.mime }),
      format,
      width: w,
      height: h,
      duration: outputDuration(clip),
    };
  } finally {
    input.dispose();
    if (output && output.state !== "finalized") void output.cancel().catch(() => {});
  }
}
