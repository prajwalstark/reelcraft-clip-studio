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
