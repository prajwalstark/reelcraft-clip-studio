/// <reference lib="webworker" />
// Runs Whisper (transformers.js + ONNX Runtime Web) off the main thread. Audio arrives as
// 16 kHz mono Float32Array windows and never leaves the device; only model weights and the
// ONNX runtime are downloaded (Hugging Face / jsDelivr) and cached by the browser.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type WorkerIn =
  | { type: "load"; model: string }
  | { type: "transcribe"; id: number; audio: Float32Array; language: string | null };

export type WorkerOut =
  | { type: "download"; file: string; loaded: number; total: number }
  | { type: "ready"; device: "webgpu" | "wasm" }
  | {
      type: "result";
      id: number;
      chunks: { text: string; timestamp: [number | null, number | null] }[];
    }
  | { type: "error"; id?: number | undefined; message: string };

env.allowLocalModels = false;
env.useBrowserCache = true;

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loaded = "";

type Adapter = {
  features: Set<string>;
  isFallbackAdapter?: boolean;
  info?: { isFallbackAdapter?: boolean; vendor?: string; architecture?: string };
};

/**
 * Use WebGPU only on a real GPU with fp16 shader support. Software adapters (SwiftShader, the
 * "fallback adapter") are far slower than WebAssembly, so they are skipped.
 */
async function webgpuF16() {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<Adapter | null> } })
      .gpu;
    const adapter = await gpu?.requestAdapter();
    if (!adapter || adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter) return false;
    if (
      /swiftshader|llvmpipe|software/i.test(`${adapter.info?.vendor} ${adapter.info?.architecture}`)
    )
      return false;
    return adapter.features.has("shader-f16");
  } catch {
    return false;
  }
}

async function load(model: string) {
  if (asr && loaded === model) return;
  await asr?.dispose();
  asr = null;
  const progress_callback = (p: {
    status: string;
    file?: string;
    loaded?: number;
    total?: number;
  }) => {
    if (p.status === "progress" && p.file)
      post({ type: "download", file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
  };
  // WebGPU with fp16 weights is much faster where supported; otherwise 8-bit weights on WASM.
  if (await webgpuF16()) {
    try {
      asr = (await pipeline("automatic-speech-recognition", model, {
        device: "webgpu",
        dtype: { encoder_model: "fp16", decoder_model_merged: "q4f16" },
        progress_callback,
      })) as AutomaticSpeechRecognitionPipeline;
      loaded = model;
      post({ type: "ready", device: "webgpu" });
      return;
    } catch {
      asr = null; // fall through to WASM
    }
  }
  asr = (await pipeline("automatic-speech-recognition", model, {
    device: "wasm",
    dtype: "q8",
    progress_callback,
  })) as AutomaticSpeechRecognitionPipeline;
  loaded = model;
  post({ type: "ready", device: "wasm" });
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      await load(msg.model);
      return;
    }
    if (!asr) throw new Error("Speech model is not loaded");
    const out = await asr(msg.audio, {
      return_timestamps: "word",
      task: "transcribe",
      ...(msg.language ? { language: msg.language } : {}),
    });
    const result = Array.isArray(out) ? out[0] : out;
    const chunks = (result?.chunks ?? []).map(
      (c: { text: string; timestamp: (number | null)[] }) => ({
        text: c.text,
        timestamp: [c.timestamp[0] ?? null, c.timestamp[1] ?? null] as [
          number | null,
          number | null,
        ],
      }),
    );
    post({ type: "result", id: msg.id, chunks });
  } catch (err) {
    post({
      type: "error",
      id: msg.type === "transcribe" ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
