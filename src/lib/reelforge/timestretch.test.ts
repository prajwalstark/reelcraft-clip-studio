import { describe, expect, it } from "vitest";
import { timeStretch } from "./timestretch";

const RATE = 48000;
const tone = (hz: number, seconds: number, rate = RATE) =>
  Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate),
  );
/** Dominant frequency via zero crossings, ignoring the edges. */
const freq = (x: Float32Array, rate = RATE) => {
  const a = Math.floor(x.length * 0.1);
  const b = Math.floor(x.length * 0.9);
  let z = 0;
  for (let i = a + 1; i < b; i++) if (x[i - 1]! < 0 !== x[i]! < 0) z++;
  return z / 2 / ((b - a) / rate);
};
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe("timeStretch", () => {
  it.each([0.5, 1.5, 2])("changes duration by 1/%s and keeps the pitch", (speed) => {
    const [out] = timeStretch([tone(220, 2)], RATE, speed);
    expect(out!.length).toBe(Math.round((2 * RATE) / speed));
    expect(freq(out!)).toBeGreaterThan(220 * 0.97);
    expect(freq(out!)).toBeLessThan(220 * 1.03);
    // no dropouts or blow-ups: level stays close to the source's
    expect(rms(out!)).toBeGreaterThan(0.3);
    expect(rms(out!)).toBeLessThan(0.42);
  });

  it("returns an unchanged copy at speed 1", () => {
    const src = tone(440, 0.5);
    const [out] = timeStretch([src], RATE, 1);
    expect(out).not.toBe(src);
    expect(Array.from(out!)).toEqual(Array.from(src));
  });

  it("keeps channels aligned and of equal length", () => {
    const l = tone(300, 1);
    const r = l.map((v) => -v);
    const [a, b] = timeStretch([l, r], RATE, 1.5);
    expect(a!.length).toBe(b!.length);
    let maxSum = 0;
    for (let i = 0; i < a!.length; i++) maxSum = Math.max(maxSum, Math.abs(a![i]! + b![i]!));
    expect(maxSum).toBeLessThan(1e-5); // R is still exactly -L
  });
});
