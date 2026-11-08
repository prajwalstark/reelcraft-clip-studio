import { expect, it, vi } from "vitest";
import { DEFAULT_CAPTION_STYLE, DEFAULT_FRAMING, type Clip } from "./core";
import { drawFrame } from "./render";
import { applyVideoTemplate, VIDEO_TEMPLATES } from "./templates";
function context() {
  const stack: Array<{ filter: string; globalAlpha: number }> = [];
  const c = {
    filter: "none",
    globalAlpha: 1,
    font: "",
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    strokeText: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    measureText: (text: string) => ({ width: text.length * 10 }),
    save() {
      stack.push({ filter: c.filter, globalAlpha: c.globalAlpha });
    },
    restore() {
      Object.assign(c, stack.pop());
    },
  };
  return { ctx: c as unknown as CanvasRenderingContext2D, c, stack };
}
const source = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
const clip: Clip = { id: "c", title: "Clip", start: 0, end: 10, framing: DEFAULT_FRAMING };
it("renders all template decorations and subtitles with balanced canvas state", () => {
  for (const preset of VIDEO_TEMPLATES) {
    const { ctx, c, stack } = context(),
      applied = applyVideoTemplate(clip, preset.id);
    drawFrame(ctx, source, 540, 960, applied.framing, null, DEFAULT_CAPTION_STYLE, 1, applied);
    expect(c.drawImage).toHaveBeenCalledOnce();
    expect(c.fillText.mock.calls.some((call) => call[0] === preset.subtitle)).toBe(true);
    expect(stack).toHaveLength(0);
    expect(c.globalAlpha).toBe(1);
    expect(c.filter).toBe("none");
    c.fillText.mockClear();
    drawFrame(ctx, source, 540, 960, applied.framing, null, DEFAULT_CAPTION_STYLE, 5, applied);
    expect(c.fillText).not.toHaveBeenCalled();
  }
});
it("shares proportionate motion/crop geometry between preview and export sizes", () => {
  const applied = applyVideoTemplate(clip, "momentum"),
    small = context(),
    large = context();
  drawFrame(small.ctx, source, 540, 960, applied.framing, null, DEFAULT_CAPTION_STYLE, 1, applied);
  drawFrame(
    large.ctx,
    source,
    1080,
    1920,
    applied.framing,
    null,
    DEFAULT_CAPTION_STYLE,
    1,
    applied,
  );
  const a = small.c.drawImage.mock.calls[0]!,
    b = large.c.drawImage.mock.calls[0]!;
  for (let i = 1; i < 5; i++) expect(b[i]).toBeCloseTo(a[i] * 2);
});
