import { afterEach, describe, expect, it, vi } from "vitest";
import { exportClip, prepareAudio, seekVideo } from "./exporter";
import { DEFAULT_CAPTION_STYLE, DEFAULT_FRAMING } from "./core";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function fakeVideo(time = 0, ready = 2) {
  return Object.assign(new EventTarget(), { currentTime: time, readyState: ready, seeking: false }) as unknown as HTMLVideoElement;
}

describe("bounded export preparation", () => {
  it("resolves a decoded no-op seek at start=0 without a seeked event", async () => {
    await expect(seekVideo(fakeVideo(), 0, new AbortController().signal)).resolves.toBeUndefined();
  });
  it("installs seeked handling before assigning currentTime", async () => {
    const video = fakeVideo(0, 1);
    let current = 0;
    Object.defineProperty(video, "currentTime", { get: () => current, set: (v: number) => {
      current = v;
      Object.assign(video, { readyState: 2 });
      video.dispatchEvent(new Event("seeked"));
    } });
    await expect(seekVideo(video, 2, new AbortController().signal)).resolves.toBeUndefined();
    expect(current).toBe(2);
  });
  it("rejects an unready seek after its bounded timeout", async () => {
    vi.useFakeTimers();
    const result = expect(seekVideo(fakeVideo(0, 1), 0, new AbortController().signal, 100)).rejects.toThrow("Seeking timed out");
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels an active seek and releases waiting timers", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const result = expect(seekVideo(fakeVideo(0, 1), 0, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects an already-aborted export before allocating media", async () => {
    const controller = new AbortController();
    controller.abort();
    const create = vi.spyOn(document, "createElement");
    await expect(exportClip({ url: "blob:test", clip: { id: "test", title: "test", start: 0, end: 3, framing: DEFAULT_FRAMING }, captions: [], style: DEFAULT_CAPTION_STYLE, signal: controller.signal, onProgress: () => {} })).rejects.toMatchObject({ name: "AbortError" });
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });
  it("reports actionable audio errors instead of continuing silently", async () => {
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("denied"); } });
    await expect(prepareAudio(fakeVideo(), {} as MediaStream, new AbortController().signal)).rejects.toThrow("Allow sound/autoplay");
  });
  it("bounds suspended audio initialization and closes the failed context", async () => {
    vi.useFakeTimers();
    const close = vi.fn(async () => {});
    vi.stubGlobal("AudioContext", class {
      state = "suspended";
      close = close;
      createMediaElementSource() { return { connect: vi.fn() }; }
      createMediaStreamDestination() { return { stream: { getAudioTracks: () => [{}] } }; }
      resume() { return new Promise<void>(() => {}); }
    });
    const result = expect(prepareAudio(fakeVideo(), { addTrack: vi.fn() } as unknown as MediaStream, new AbortController().signal, 100)).rejects.toThrow("Audio could not be initialized");
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});