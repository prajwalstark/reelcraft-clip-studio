import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const media = vi.hoisted(() => ({
  draw: vi.fn(async (_canvas: HTMLCanvasElement, _frame: number) => {}),
  audio: vi.fn(async () => null),
  dispose: vi.fn(),
  sessions: vi.fn(),
}));
vi.mock("@/lib/sequence/media", () => ({
  bounded: (p: Promise<unknown>) => p,
  MediaSession: class {
    constructor(...args: unknown[]) {
      media.sessions(...args);
    }
    draw = media.draw;
    audio = media.audio;
    dispose = media.dispose;
  },
}));
import { SequencePreview } from "./SequencePreview";
import { fresh, addItem, type Sequence } from "@/lib/sequence/model";
let callbacks: Map<number, FrameRequestCallback>, counter: number;
function sequence() {
  const s = fresh();
  s.assets = [
    {
      id: "a",
      name: "a.mp4",
      kind: "video",
      duration: 10,
      size: 1,
      lastModified: 0,
      origin: 0,
      width: 1920,
      height: 1080,
      hasAudio: false,
      peaks: [],
    },
  ];
  return addItem(s, "a", "V1", 0);
}
async function tick() {
  await act(async () => {
    const batch = [...callbacks.values()];
    callbacks.clear();
    batch.forEach((cb) => cb(0));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  callbacks = new Map();
  counter = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    callbacks.set(++counter, cb);
    return counter;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal(
    "AudioContext",
    class {
      currentTime = 0;
      resume = async () => {};
      close = async () => {};
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("preview performance regressions", () => {
  it("retains decoder session and scratch canvas across seeks and visual edits", async () => {
    const s = sequence(),
      files = new Map();
    const props = {
      sequence: s,
      files,
      frame: 0,
      onFrame: vi.fn(),
      disabled: false,
      seekVersion: 0,
    };
    const view = render(<SequencePreview {...props} />);
    await tick();
    const scratch = media.draw.mock.calls[0]![0] as unknown as HTMLCanvasElement;
    expect(scratch.width).toBe(640);
    expect(scratch.height).toBe(360);
    view.rerender(<SequencePreview {...props} frame={12} seekVersion={1} />);
    await tick();
    view.rerender(
      <SequencePreview
        {...props}
        sequence={{ ...s, name: "renamed" }}
        frame={12}
        seekVersion={1}
      />,
    );
    await tick();
    expect(media.sessions).toHaveBeenCalledTimes(1);
    expect(media.draw.mock.calls.every((call) => call[0] === scratch)).toBe(true);
    expect(media.dispose).not.toHaveBeenCalled();
  });
  it("does not redraw the same paused frame on animation ticks", async () => {
    render(
      <SequencePreview
        sequence={sequence()}
        files={new Map()}
        frame={0}
        onFrame={vi.fn()}
        disabled={false}
        seekVersion={0}
      />,
    );
    await tick();
    const count = media.draw.mock.calls.length;
    await tick();
    await tick();
    expect(media.draw).toHaveBeenCalledTimes(count);
  });
  it("reuses prepared audio after pause and seek, invalidating it after edits", async () => {
    const s = sequence(),
      files = new Map();
    const props = {
      sequence: s,
      files,
      frame: 0,
      onFrame: vi.fn(),
      disabled: false,
      seekVersion: 0,
    };
    const view = render(<SequencePreview {...props} />);
    await act(async () => fireEvent.click(screen.getByText("▶ Play")));
    expect(media.audio).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Pause"));
    view.rerender(<SequencePreview {...props} frame={30} seekVersion={1} />);
    await act(async () => fireEvent.click(screen.getByText("▶ Play")));
    expect(media.audio).toHaveBeenCalledTimes(1);
    const edited: Sequence = { ...s, items: s.items.map((c) => ({ ...c, volume: 0.5 })) };
    view.rerender(<SequencePreview {...props} sequence={edited} />);
    await act(async () => fireEvent.click(screen.getByText("▶ Play")));
    expect(media.audio).toHaveBeenCalledTimes(2);
  });
});
