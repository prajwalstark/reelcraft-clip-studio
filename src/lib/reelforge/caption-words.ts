// Word-level caption timing and layout for animated ("word-by-word") captions.
// Pure functions: the canvas compositor in render.ts draws what these return, so preview
// and export share one implementation and everything here is unit-testable.
import type { Caption, CaptionAnimation } from "./core";

export interface TimedWord {
  text: string;
  start: number; // source seconds
  end: number;
  /** True when this word starts a new line (a manual line break or the next caption). */
  br: boolean;
}

const tokenize = (text: string) =>
  text.split("\n").flatMap((line, li) =>
    line
      .split(/\s+/)
      .filter(Boolean)
      .map((t, i) => ({ text: t, br: li > 0 && i === 0 })),
  );

/**
 * Per-word timing for a caption. Uses the stored timings from auto-captions when they still
 * line up with the text (same number of words, mostly inside the caption) — so fixing a
 * misheard word keeps its timing. Otherwise spreads the caption's time over its words by
 * length, which also covers hand-written and imported SRT/VTT captions.
 */
export function captionWords(c: Caption): TimedWord[] {
  const tokens = tokenize(c.text);
  if (!tokens.length) return [];
  const span = Math.max(0.001, c.end - c.start);
  const stored = c.words;
  if (stored && stored.length === tokens.length) {
    const inside = stored.filter((w) => w.end > c.start && w.start < c.end).length;
    if (inside >= stored.length / 2) {
      let prev = c.start;
      return tokens.map((t, i) => {
        const w = stored[i]!;
        const start = Math.min(c.end, Math.max(prev, w.start, c.start));
        const end = Math.min(c.end, Math.max(start, w.end));
        prev = start;
        return { ...t, start, end };
      });
    }
  }
  const weights = tokens.map((t) => t.text.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let t0 = c.start;
  return tokens.map((t, i) => {
    const d = (span * weights[i]!) / total;
    const w = { ...t, start: t0, end: t0 + d };
    t0 += d;
    return w;
  });
}

export type WordPhase = "past" | "current" | "future";

/**
 * Which words are spoken, being spoken or still to come at time `t`. The current word is the
 * last one that has started, so the highlight holds through short pauses between words.
 */
export function wordPhases(words: TimedWord[], t: number): WordPhase[] {
  let current = -1;
  words.forEach((w, i) => {
    if (w.start <= t) current = i;
  });
  return words.map((_, i) => (i < current ? "past" : i === current ? "current" : "future"));
}

/** Scale for the "pop" animation: a quick overshoot when the word starts, settling to 1. */
export function popScale(word: TimedWord, t: number) {
  const k = (t - word.start) / 0.22;
  if (k < 0 || k >= 1) return 1;
  return 1 + 0.24 * Math.sin(k * Math.PI) * (1 - k * 0.5);
}

export interface PlacedWord extends TimedWord {
  x: number; // left edge, px
  width: number;
}
export interface CaptionLine {
  words: PlacedWord[];
  width: number;
}

/**
 * Wrap words into centred lines no wider than `maxW`. `measure` returns the rendered width
 * of a string (ctx.measureText in the browser), `space` the width of one space.
 */
export function layoutWords(
  words: TimedWord[],
  measure: (s: string) => number,
  maxW: number,
  centerX: number,
): CaptionLine[] {
  const space = measure(" ");
  const lines: { words: (TimedWord & { width: number })[]; width: number }[] = [];
  let cur: (TimedWord & { width: number })[] = [];
  let curW = 0;
  for (const w of words) {
    const width = measure(w.text);
    const next = cur.length ? curW + space + width : width;
    if (cur.length && (w.br || next > maxW)) {
      lines.push({ words: cur, width: curW });
      cur = [];
      curW = 0;
    }
    curW = cur.length ? curW + space + width : width;
    cur.push({ ...w, width });
  }
  if (cur.length) lines.push({ words: cur, width: curW });
  return lines.map((l) => {
    let x = centerX - l.width / 2;
    return {
      width: l.width,
      words: l.words.map((w) => {
        const placed = { ...w, x };
        x += w.width + space;
        return placed;
      }),
    };
  });
}

export const ANIMATIONS: { id: CaptionAnimation; label: string; hint: string }[] = [
  { id: "none", label: "None", hint: "Whole caption at once" },
  { id: "karaoke", label: "Karaoke", hint: "Spoken words fill with the accent colour" },
  { id: "highlight", label: "Highlight", hint: "A pill sits behind the word being spoken" },
  { id: "pop", label: "Pop", hint: "The current word bounces in the accent colour" },
  { id: "reveal", label: "Reveal", hint: "Words appear as they are spoken" },
];
