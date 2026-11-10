import { expect, it, vi } from "vitest";
import { DEFAULT_CAPTION_STYLE, DEFAULT_FRAMING, type Clip } from "./core";
import { DEFAULT_COLOR, titleOf } from "./editing";
import { drawFrame } from "./render";

it("applies color only to video, draws titles during their source interval, and restores canvas state", () => {
  const calls: Array<[string, string]> = [],
    stack: string[] = [];
  const ctx = {
    filter: "none",
    fillRect: vi.fn(),
    save(this: { filter: string }) {
      stack.push(this.filter);
    },
    restore(this: { filter: string }) {
      this.filter = stack.pop()!;
    },
    drawImage(this: { filter: string }) {
      calls.push(["video", this.filter]);
    },
    fillText(this: { filter: string }, text: string) {
      calls.push([text, this.filter]);
    },
    measureText: () => ({ width: 100 }),
  } as unknown as CanvasRenderingContext2D;
  const c: Clip = {
    id: "c",
    title: "Clip",
    start: 0,
    end: 10,
    framing: DEFAULT_FRAMING,
    color: { ...DEFAULT_COLOR, blur: 6 },
  };
  c.overlay = { ...titleOf(c), enabled: true, text: "Title", start: 2, end: 4 };
  const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
  drawFrame(ctx, video, 540, 960, c.framing, null, DEFAULT_CAPTION_STYLE, 3, c);
  expect(calls[0]![1]).toContain("blur(");
  expect(calls[1]).toEqual(["Title", "none"]);
  calls.length = 0;
  drawFrame(ctx, video, 540, 960, c.framing, null, DEFAULT_CAPTION_STYLE, 4, c);
  expect(calls.map((x) => x[0])).toEqual(["video"]);
  expect(stack).toHaveLength(0);
});

it("draws word-by-word captions: accent on spoken words (karaoke) and hides upcoming words (reveal)", () => {
  const drawn: Array<[string, string, number]> = [];
  const ctx = {
    filter: "none",
    globalAlpha: 1,
    fillStyle: "",
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    strokeText: vi.fn(),
    fillText(this: { fillStyle: string; globalAlpha: number }, text: string) {
      drawn.push([text, this.fillStyle, this.globalAlpha]);
    },
    measureText: (s: string) => ({ width: s.length * 10 }),
  } as unknown as CanvasRenderingContext2D;
  const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
  const captions = [
    {
      id: "a",
      start: 0,
      end: 3,
      text: "one two three",
      words: [
        { text: "one", start: 0, end: 0.8 },
        { text: "two", start: 1, end: 1.8 },
        { text: "three", start: 2, end: 2.8 },
      ],
    },
  ];
  const style = { ...DEFAULT_CAPTION_STYLE, color: "#ffffff", accent: "#ff0000" };
  drawFrame(
    ctx,
    video,
    540,
    960,
    DEFAULT_FRAMING,
    captions,
    { ...style, animation: "karaoke" },
    1.2,
  );
  expect(drawn).toEqual([
    ["one", "#ff0000", 1],
    ["two", "#ff0000", 1],
    ["three", "#ffffff", 1],
  ]);
  drawn.length = 0;
  drawFrame(
    ctx,
    video,
    540,
    960,
    DEFAULT_FRAMING,
    captions,
    { ...style, animation: "reveal" },
    1.2,
  );
  expect(drawn.map((d) => d[0])).toEqual(["one", "two"]);
  drawn.length = 0;
  drawFrame(ctx, video, 540, 960, DEFAULT_FRAMING, captions, { ...style, animation: "none" }, 1.2);
  expect(drawn.map((d) => d[0])).toEqual(["one two three"]);
});

it("picks readable text on the highlight pill", async () => {
  const { contrastText } = await import("./render");
  expect(contrastText("#c8ff3d")).toBe("#0b0b0d");
  expect(contrastText("#1d4ed8")).toBe("#ffffff");
});
