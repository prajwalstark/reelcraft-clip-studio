import { describe, expect, it } from "vitest";
import { captionWords, layoutWords, popScale, wordPhases } from "./caption-words";
import type { Caption } from "./core";

const cap = (text: string, start: number, end: number, words?: Caption["words"]): Caption => ({
  id: "c",
  text,
  start,
  end,
  ...(words ? { words } : {}),
});

describe("captionWords", () => {
  const timed = cap("Welcome to ReelForge.", 2, 4, [
    { text: "Welcome", start: 2.1, end: 2.6 },
    { text: "to", start: 2.7, end: 2.9 },
    { text: "ReelForge.", start: 3, end: 3.8 },
  ]);

  it("uses spoken word timing from auto-captions", () => {
    expect(captionWords(timed).map((w) => [w.text, w.start, w.end])).toEqual([
      ["Welcome", 2.1, 2.6],
      ["to", 2.7, 2.9],
      ["ReelForge.", 3, 3.8],
    ]);
  });

  it("keeps the timing when a misheard word is corrected (same word count)", () => {
    const fixed = { ...timed, text: "Welcome to ReelForge!" };
    expect(captionWords(fixed).map((w) => [w.text, w.start])).toEqual([
      ["Welcome", 2.1],
      ["to", 2.7],
      ["ReelForge!", 3],
    ]);
  });

  it("falls back to length-weighted timing when the word count changes", () => {
    const words = captionWords({ ...timed, text: "Welcome back to ReelForge." });
    expect(words).toHaveLength(4);
    expect(words[0]!.start).toBe(2);
    expect(words.at(-1)!.end).toBeCloseTo(4, 6);
    // longer words get more time
    expect(words[3]!.end - words[3]!.start).toBeGreaterThan(words[2]!.end - words[2]!.start);
  });

  it("clamps stored timing into the caption after its in/out points are trimmed", () => {
    const words = captionWords({ ...timed, start: 2.5, end: 3.5 });
    words.forEach((w) => {
      expect(w.start).toBeGreaterThanOrEqual(2.5);
      expect(w.end).toBeLessThanOrEqual(3.5);
    });
    for (let i = 1; i < words.length; i++)
      expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.start);
  });

  it("times hand-written captions and marks manual line breaks", () => {
    const words = captionWords(cap("Hello there\nfriend", 0, 3));
    expect(words.map((w) => [w.text, w.br])).toEqual([
      ["Hello", false],
      ["there", false],
      ["friend", true],
    ]);
    expect(words[0]!.start).toBe(0);
    expect(words.at(-1)!.end).toBeCloseTo(3, 6);
  });

  it("returns nothing for blank text", () => {
    expect(captionWords(cap("   ", 0, 1))).toEqual([]);
  });
});

describe("wordPhases", () => {
  const words = captionWords(
    cap("a b c", 0, 3, [
      { text: "a", start: 0, end: 0.5 },
      { text: "b", start: 1, end: 1.5 },
      { text: "c", start: 2, end: 2.5 },
    ]),
  );
  it("marks spoken, current and upcoming words", () => {
    expect(wordPhases(words, 1.2)).toEqual(["past", "current", "future"]);
  });
  it("holds the current word through a pause", () => {
    expect(wordPhases(words, 1.8)).toEqual(["past", "current", "future"]);
  });
  it("has no current word before the first one starts", () => {
    expect(wordPhases(words, -1)).toEqual(["future", "future", "future"]);
  });
});

describe("popScale", () => {
  const w = { text: "x", start: 1, end: 2, br: false };
  it("overshoots right after the word starts and settles to 1", () => {
    expect(popScale(w, 0.9)).toBe(1);
    expect(popScale(w, 1.1)).toBeGreaterThan(1.15);
    expect(popScale(w, 1.5)).toBe(1);
  });
});

describe("layoutWords", () => {
  const measure = (s: string) => (s === " " ? 10 : s.length * 20);
  const words = "one two three four"
    .split(" ")
    .map((text, i) => ({ text, start: i, end: i + 1, br: false }));

  it("centres a line and places words left to right with spaces", () => {
    const [line] = layoutWords(words.slice(0, 2), measure, 1000, 500);
    // widths: one=60, two=60, space=10 → 130 total
    expect(line!.width).toBe(130);
    expect(line!.words.map((w) => w.x)).toEqual([435, 505]);
  });

  it("wraps at the max width and on manual breaks", () => {
    const lines = layoutWords(words, measure, 180, 500);
    expect(lines.map((l) => l.words.map((w) => w.text))).toEqual([
      ["one", "two"],
      ["three"],
      ["four"],
    ]);
    const broken = layoutWords([words[0]!, { ...words[1]!, br: true }], measure, 1000, 500);
    expect(broken).toHaveLength(2);
  });
});
