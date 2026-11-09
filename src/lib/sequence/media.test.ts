import { describe, it, expect, vi } from "vitest";
import { bounded, mixPacket, RATE } from "./media";
import { fresh, addItem, patchItem, type Sequence } from "./model";
function setup() {
  let s: Sequence = fresh();
  s.assets = [
    {
      id: "a",
      name: "a.wav",
      kind: "audio",
      size: 1,
      lastModified: 0,
      duration: 10,
      origin: 2,
      width: 0,
      height: 0,
      hasAudio: true,
      peaks: [],
    },
  ];
  s = addItem(s, "a", "A1", 30);
  s = patchItem(s, s.items[0]!.id, { frames: 30, sourceIn: 1, volume: 0.5 });
  return s;
}
function packet(timestamp: number, values: number[], rate: number) {
  const channel = new Float32Array(values);
  return {
    timestamp,
    duration: values.length / rate,
    buffer: {
      numberOfChannels: 1,
      length: values.length,
      sampleRate: rate,
      getChannelData: () => channel,
    } as unknown as AudioBuffer,
  };
}
describe("audio timing and bounded media operations", () => {
  it("places source-in and nonzero origin on the right timeline sample", () => {
    const s = setup(),
      out = [new Float32Array(3 * RATE), new Float32Array(3 * RATE)];
    mixPacket(out, packet(3, [1, 1], 2), s, s.items[0]!, 2);
    expect(out[0]![RATE - 1]).toBe(0);
    expect(out[0]![RATE]).toBe(0.5);
    expect(out[1]![RATE]).toBe(0.5);
    expect(out[0]![2 * RATE]).toBe(0);
  });
  it("mixes overlapping tracks without overwriting previous samples", () => {
    const s = setup(),
      out = [new Float32Array(3 * RATE), new Float32Array(3 * RATE)],
      p = packet(3, [0.5, 0.5], 2);
    mixPacket(out, p, s, s.items[0]!, 2);
    mixPacket(out, p, s, s.items[0]!, 2);
    expect(out[0]![RATE]).toBe(0.5);
  });
  it("clips partial source packets at trim boundaries", () => {
    const s = setup(),
      out = [new Float32Array(3 * RATE), new Float32Array(3 * RATE)];
    mixPacket(out, packet(2.5, [1, 1, 1], 2), s, s.items[0]!, 2);
    expect(out[0]![RATE - 1]).toBe(0);
    expect(out[0]![RATE]).toBe(0.5);
    expect(out[0]![2 * RATE]).toBe(0);
  });
  it("rejects immediately on abort and consumes late promise rejection", async () => {
    const c = new AbortController();
    let reject!: (e: Error) => void;
    const underlying = new Promise<void>((_, r) => {
      reject = r;
    });
    const p = bounded(underlying, c.signal);
    c.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    reject(new Error("late decoder failure"));
  });
  it("bounds a stalled decoder", async () => {
    vi.useFakeTimers();
    try {
      const p = bounded(new Promise(() => {}), new AbortController().signal, 50);
      const assertion = expect(p).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
