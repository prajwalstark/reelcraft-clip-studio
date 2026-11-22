import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addItem, fresh, patchItem, type Sequence } from "@/lib/sequence/model";
import { TransformOverlay } from "./TransformOverlay";

function seq(): Sequence {
  let s = fresh();
  s.assets = [
    {
      id: "a",
      name: "wide.mp4",
      kind: "video",
      size: 1,
      lastModified: 1,
      duration: 10,
      origin: 0,
      width: 1920,
      height: 1080,
      hasAudio: false,
      peaks: [],
    },
  ];
  s = addItem(s, "a", "V1", 0);
  s = addItem(s, "a", "V2", 0);
  // V2: half size in the top-right quarter.
  return patchItem(s, s.items[1]!.id, { scale: 0.5, x: 0.75, y: 0.25 });
}

// jsdom has no PointerEvent; a MouseEvent with a pointerId carries everything used here.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  vi.stubGlobal("PointerEvent", PointerEventShim);
}

// jsdom has no layout: the monitor is 640×360 at the page origin.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 640,
    height: 360,
    right: 640,
    bottom: 360,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const setup = (s: Sequence, selected?: string, active = true) => {
  const props = {
    onSelect: vi.fn(),
    onTransform: vi.fn(),
    onDragging: vi.fn(),
  };
  render(
    <TransformOverlay sequence={s} frame={0} selected={selected} active={active} {...props} />,
  );
  return { ...props, root: screen.getByRole("group") };
};
const pointer = (x: number, y: number, extra: Record<string, unknown> = {}) => ({
  clientX: x,
  clientY: y,
  pointerId: 1,
  button: 0,
  ...extra,
});

describe("TransformOverlay", () => {
  it("clicking the picture selects the clip on top", () => {
    const s = seq();
    const { root, onSelect } = setup(s);
    fireEvent.pointerDown(root, pointer(500, 60)); // inside V2
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ track: "V2" }));
    fireEvent.pointerUp(root, pointer(500, 60));
    fireEvent.pointerDown(root, pointer(100, 300)); // V1 only
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ track: "V1" }));
  });

  it("a click on a clip covering the selected one selects the clip on top", () => {
    const s = seq();
    const { root, onSelect, onTransform } = setup(s, s.items[0]!.id); // V1 selected
    fireEvent.pointerDown(root, pointer(480, 90)); // V2 is on top here
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ track: "V2" }));
    fireEvent.pointerMove(root, pointer(400, 90));
    expect(onTransform.mock.calls[0]![0]).toBe(s.items[1]!.id);
  });

  it("drags the selected clip as one gesture, snapping to the centre", () => {
    const s = seq();
    const v2 = s.items[1]!;
    const { root, onTransform, onDragging } = setup(s, v2.id);
    expect(screen.getByTestId("transform-box")).toBeTruthy();
    fireEvent.pointerDown(root, pointer(480, 90)); // centre of V2
    fireEvent.pointerMove(root, pointer(380, 90)); // 100 px left → x 0.75 − 100/640
    fireEvent.pointerMove(root, pointer(322, 182)); // near the frame centre → snaps
    fireEvent.pointerUp(root, pointer(322, 182));
    const calls = onTransform.mock.calls;
    expect(calls[0]![2].x).toBeCloseTo(0.75 - 100 / 640);
    expect(calls[1]![2]).toEqual({ x: 0.5, y: 0.5 });
    expect(new Set(calls.map((c) => c[3])).size).toBe(1); // same gesture id
    expect(onDragging.mock.calls).toEqual([[true], [false]]);
  });

  it("moves freely with Alt held", () => {
    const s = seq();
    const { root, onTransform } = setup(s, s.items[1]!.id);
    fireEvent.pointerDown(root, pointer(480, 90));
    fireEvent.pointerMove(root, pointer(322, 182, { altKey: true }));
    expect(onTransform.mock.calls[0]![2].x).toBeCloseTo(0.75 - 158 / 640);
  });

  it("scales from a corner handle around the centre", () => {
    const s = seq();
    const { onTransform } = setup(s, s.items[1]!.id);
    const handle = document.querySelector('[data-handle="se"]')!;
    // Centre of V2 is (480, 90); the se corner is (640, 180). Halfway in → scale 0.25.
    fireEvent.pointerDown(handle, pointer(640, 180));
    fireEvent.pointerMove(handle, pointer(560, 135));
    expect(onTransform.mock.calls[0]![2].scale).toBeCloseTo(0.25);
  });

  it("nudges with the keyboard", () => {
    const s = seq();
    const { root, onTransform } = setup(s, s.items[1]!.id);
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    fireEvent.keyDown(root, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(root, { key: "+" });
    const [left, down, bigger] = onTransform.mock.calls.map((c) => c[2]);
    expect(left.x).toBeCloseTo(0.745);
    expect(down.y).toBeCloseTo(0.3);
    expect(bigger.scale).toBeCloseTo(0.51);
  });

  it("does nothing while inactive (playing or busy) or on a locked track", () => {
    const s = seq();
    const a = setup(s, s.items[1]!.id, false);
    fireEvent.pointerDown(a.root, pointer(480, 90));
    expect(a.onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId("transform-box")).toBeNull();
    cleanup();
    s.tracks = s.tracks.map((t) => (t.id === "V2" ? { ...t, locked: true } : t));
    const b = setup(s, s.items[1]!.id);
    expect(screen.queryByTestId("transform-box")).toBeNull();
    fireEvent.pointerDown(b.root, pointer(480, 90));
    fireEvent.pointerMove(b.root, pointer(300, 90));
    expect(b.onTransform).not.toHaveBeenCalled();
  });
});
