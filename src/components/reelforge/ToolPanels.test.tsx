import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_FRAMING, newProject } from "@/lib/reelforge/core";
import {
  activeClip,
  getState,
  importProjectJSON,
  redo,
  undo,
  useStore,
} from "@/lib/reelforge/store";
import { AudioPanel, ColorPanel, QualityControls, SpeedControl, TitlesPanel } from "./ToolPanels";

beforeEach(async () => {
  vi.useFakeTimers();
  const project = {
    ...newProject(),
    source: {
      name: "test.mp4",
      size: 100,
      type: "video/mp4",
      lastModified: 0,
      duration: 10,
      width: 640,
      height: 360,
    },
    clips: [{ id: "c", title: "Short", start: 0, end: 10, framing: DEFAULT_FRAMING }],
  };
  await importProjectJSON({ text: async () => JSON.stringify(project) } as File);
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});
function Panels() {
  const c = useStore((s) => activeClip(s))!;
  return (
    <>
      <ColorPanel clip={c} />
      <AudioPanel clip={c} />
      <SpeedControl clip={c} />
      <TitlesPanel clip={c} />
      <QualityControls clip={c} />
    </>
  );
}
it("writes controls to the project and supports undo/redo and reset", () => {
  render(<Panels />);
  fireEvent.change(screen.getByLabelText("Brightness"), { target: { value: "1.4" } });
  expect(activeClip()?.color?.brightness).toBe(1.4);
  act(() => undo());
  expect(screen.getByLabelText("Brightness")).toHaveValue("1");
  act(() => redo());
  expect(screen.getByLabelText("Brightness")).toHaveValue("1.4");
  fireEvent.click(screen.getByRole("button", { name: "Reset color" }));
  expect(activeClip()?.color?.brightness).toBe(1);
  fireEvent.click(screen.getByLabelText("Mute clip audio"));
  expect(activeClip()?.audio?.muted).toBe(true);
  fireEvent.change(screen.getByLabelText("Clip speed"), { target: { value: "2" } });
  expect(activeClip()?.speed).toBe(2);
  expect(screen.getByText(/Output: 5.00s/)).toBeInTheDocument();
});
it("saves timed titles and selected export quality", () => {
  render(<Panels />);
  fireEvent.click(screen.getByLabelText("Show title / lower third"));
  fireEvent.change(screen.getByLabelText("Title text"), { target: { value: "My reel" } });
  fireEvent.change(screen.getByLabelText("Title start (source s)"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Title end (source s)"), { target: { value: "4" } });
  expect(activeClip()?.overlay).toMatchObject({ enabled: true, text: "My reel", start: 2, end: 4 });
  fireEvent.change(screen.getByLabelText("Export resolution"), { target: { value: "720" } });
  fireEvent.change(screen.getByLabelText("Export frame rate"), { target: { value: "24" } });
  expect(getState().project.exportSettings).toEqual({ resolution: 720, fps: 24 });
});
