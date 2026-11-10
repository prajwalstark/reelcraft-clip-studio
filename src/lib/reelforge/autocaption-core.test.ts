import { describe, expect, it } from "vitest";
import {
  ASR_RATE,
  CUE_PRESETS,
  Downsampler,
  chunksToWords,
  downmix,
  isSilent,
  mergeCaptions,
  planWindows,
  wordsToCaptions,
  type Word,
} from "./autocaption-core";
import type { Caption } from "./core";

const sine = (rate: number, seconds: number, hz: number) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / rate),
  );

/** Dominant frequency via zero crossings. */
const freq = (x: Float32Array, rate: number) => {
  let z = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 !== x[i]! < 0) z++;
  return z / 2 / (x.length / rate);
};

describe("Downsampler", () => {
  it.each([48000, 44100, 22050, 8000])(
    "resamples %i Hz to 16 kHz with correct length and pitch",
    (rate) => {
      const ds = new Downsampler(rate, 2);
      ds.push(sine(rate, 2, 440));
      const out = ds.result();
      expect(Math.abs(out.length - 2 * ASR_RATE)).toBeLessThanOrEqual(2);
      expect(freq(out, ASR_RATE)).toBeCloseTo(440, -1);
    },
  );

  it("gives the same output whether fed in one block or many odd-sized blocks", () => {
    const input = sine(44100, 1.5, 300);
    const one = new Downsampler(44100);
    one.push(input);
    const many = new Downsampler(44100);
    for (let i = 0; i < input.length; i += 997) many.push(input.subarray(i, i + 997));
    const a = one.result();
    const b = many.result();
    expect(b.length).toBe(a.length);
    let maxDiff = 0;
    for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i]! - b[i]!));
    expect(maxDiff).toBeLessThan(1e-5);
  });

  it("attenuates content above the 8 kHz Nyquist limit instead of aliasing it at full strength", () => {
    const ds = new Downsampler(48000);
    ds.push(sine(48000, 1, 15000));
    const out = ds.result();
    const rms = Math.sqrt(out.reduce((a, v) => a + v * v, 0) / out.length);
    expect(rms).toBeLessThan(0.35); // a full-strength alias would be ≈ 0.707
  });

  it("pads silence so later audio keeps its timing", () => {
    const ds = new Downsampler(48000);
    ds.push(new Float32Array(48000).fill(0.5));
    ds.pad(ASR_RATE * 0.5);
    ds.push(new Float32Array(48000).fill(0.5));
    const out = ds.result();
    expect(Math.abs(out.length - 2.5 * ASR_RATE)).toBeLessThanOrEqual(2);
    expect(out[Math.round(1.25 * ASR_RATE)]).toBe(0);
    expect(out[Math.round(2 * ASR_RATE)]).toBeCloseTo(0.5, 5);
  });
});

describe("downmix", () => {
  it("averages channels", () => {
    expect(Array.from(downmix([Float32Array.of(1, 0), Float32Array.of(0, 1)]))).toEqual([0.5, 0.5]);
  });
});

describe("planWindows", () => {
  it("covers every sample with windows of at most the limit", () => {
    const x = sine(ASR_RATE, 95, 200);
    const w = planWindows(x);
    expect(w[0]!.start).toBe(0);
    expect(w.at(-1)!.end).toBe(x.length);
    w.forEach((win, i) => {
      expect(win.end - win.start).toBeLessThanOrEqual(28 * ASR_RATE);
      if (i) expect(win.start).toBe(w[i - 1]!.end);
    });
  });

  it("moves each cut into a pause", () => {
    const x = sine(ASR_RATE, 40, 200);
    x.fill(0, Math.round(26 * ASR_RATE), Math.round(26.6 * ASR_RATE)); // pause at 26–26.6 s
    const [first] = planWindows(x);
    expect(first!.end / ASR_RATE).toBeGreaterThan(26);
    expect(first!.end / ASR_RATE).toBeLessThan(26.6);
  });

  it("returns a single window for short audio", () => {
    expect(planWindows(new Float32Array(ASR_RATE * 5))).toEqual([{ start: 0, end: ASR_RATE * 5 }]);
  });
});

describe("isSilent", () => {
  it("detects silence and speech-level signal", () => {
    expect(isSilent(new Float32Array(1000))).toBe(true);
    expect(isSilent(sine(ASR_RATE, 0.5, 200).map((v) => v * 0.1))).toBe(false);
  });
});

describe("chunksToWords", () => {
  it("offsets word timestamps to source time and drops non-speech tags", () => {
    const words = chunksToWords(
      [
        { text: " [BLANK_AUDIO]", timestamp: [0, 1] },
        { text: " Hello", timestamp: [1, 1.4] },
        { text: " world.", timestamp: [1.4, null] },
        { text: " ♪ music ♪", timestamp: [3, 4] },
      ],
      10,
      28,
    );
    expect(words.map((w) => w.text)).toEqual(["Hello", "world."]);
    expect(words[0]).toMatchObject({ start: 11, end: 11.4 });
    expect(words[1]!.start).toBe(11.4);
    expect(words[1]!.end).toBeGreaterThan(11.4); // missing end is estimated
  });

  it("spreads a multi-word segment over its span", () => {
    const words = chunksToWords([{ text: "one two three", timestamp: [0, 3] }], 0, 28);
    expect(words).toHaveLength(3);
    expect(words[0]!.start).toBe(0);
    expect(words[2]!.end).toBeCloseTo(3, 5);
  });
});

describe("wordsToCaptions", () => {
  const w = (text: string, start: number, end: number): Word => ({ text, start, end });

  it("breaks at sentence ends, long pauses and length limits", () => {
    const words = [
      w("Hi", 0, 0.3),
      w("there.", 0.3, 0.6),
      w("This", 0.7, 0.9),
      w("is", 0.9, 1),
      w("ReelForge", 1, 1.5),
      w("after", 3, 3.3), // 1.5 s pause
      w("pause", 3.3, 3.6),
    ];
    const cues = wordsToCaptions(words, CUE_PRESETS.standard);
    expect(cues.map((c) => c.text)).toEqual(["Hi there.", "This is ReelForge", "after pause"]);
    expect(cues[0]!.start).toBe(0);
    expect(cues[2]!.start).toBe(3);
  });

  it("respects the punchy preset's character limit", () => {
    const words = "we turn one long video into many short reels"
      .split(" ")
      .map((t, i) => w(t, i * 0.3, i * 0.3 + 0.28));
    const cues = wordsToCaptions(words, CUE_PRESETS.punchy);
    cues.forEach((c) => expect(c.text.length).toBeLessThanOrEqual(18));
    expect(cues.map((c) => c.text).join(" ")).toBe(words.map((x) => x.text).join(" "));
  });

  it("never overlaps, keeps a readable minimum and stops at the range end", () => {
    const cues = wordsToCaptions(
      [w("Quick.", 0, 0.1), w("Next.", 0.3, 0.5), w("Last.", 9.9, 9.95)],
      CUE_PRESETS.standard,
      10,
    );
    for (let i = 1; i < cues.length; i++)
      expect(cues[i]!.start).toBeGreaterThanOrEqual(cues[i - 1]!.end);
    expect(cues[0]!.end).toBe(0.3); // lengthened up to the next cue, not past it
    expect(cues.at(-1)!.end).toBeLessThanOrEqual(10);
  });

  it("tidies spacing before punctuation", () => {
    const [c] = wordsToCaptions(
      [w("Wait", 0, 0.3), w(",", 0.3, 0.35), w("what?", 0.4, 0.8)],
      CUE_PRESETS.standard,
    );
    expect(c!.text).toBe("Wait, what?");
  });
});

describe("mergeCaptions", () => {
  const cap = (id: string, start: number, end: number): Caption => ({ id, start, end, text: id });
  const existing = [cap("before", 0, 2), cap("inside", 5, 6), cap("after", 12, 13)];
  const fresh = [cap("new", 4, 5)];

  it("replaces captions overlapping the range and keeps the rest, sorted", () => {
    expect(mergeCaptions(existing, fresh, 3, 10, true).map((c) => c.id)).toEqual([
      "before",
      "new",
      "after",
    ]);
  });

  it("can keep existing captions", () => {
    expect(mergeCaptions(existing, fresh, 3, 10, false).map((c) => c.id)).toEqual([
      "before",
      "new",
      "inside",
      "after",
    ]);
  });
});
