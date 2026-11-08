import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_FRAMING, newProject } from "@/lib/reelforge/core";
import {
  activeClip,
  getState,
  importProjectJSON,
  setRt,
  undo,
  useStore,
} from "@/lib/reelforge/store";
import { TemplatesPanel } from "./TemplatesPanel";
beforeEach(async () => {
  vi.useFakeTimers();
  const c = { id: "a", title: "First", start: 0, end: 10, framing: DEFAULT_FRAMING };
  const p = {
    ...newProject(),
    source: {
      name: "test.mp4",
      size: 100,
      type: "video/mp4",
      lastModified: 0,
      duration: 20,
      width: 640,
      height: 360,
    },
    clips: [c, { ...c, id: "b", title: "Second", start: 10, end: 20 }],
  };
  await importProjectJSON({ text: async () => JSON.stringify(p) } as File);
  setRt({ activeId: "a", selected: ["a", "b"] });
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});
function Panel() {
  const c = useStore((s) => activeClip(s))!;
  return <TemplatesPanel clip={c} />;
}
it("browses without changing edits, applies and customizes an undoable style", () => {
  render(<Panel />);
  fireEvent.click(screen.getByRole("button", { name: "Select Prism Reveal" }));
  expect(activeClip()?.template).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Apply to this clip" }));
  expect(activeClip()?.template?.id).toBe("prism");
  expect(getState().project.clips[1]?.template).toBeUndefined();
  fireEvent.change(screen.getByLabelText("Template title"), {
    target: { value: "City after dark" },
  });
  fireEvent.change(screen.getByLabelText("Template subtitle"), { target: { value: "Bengaluru" } });
  expect(activeClip()?.overlay?.text).toBe("City after dark");
  expect(activeClip()?.template?.subtitle).toBe("Bengaluru");
  act(() => undo());
  expect(activeClip()?.template?.subtitle).toBe("See it differently.");
});
it("applies independently to selected clips in one undo step", () => {
  render(<Panel />);
  fireEvent.click(screen.getByRole("button", { name: "Apply to selected (2)" }));
  const [a, b] = getState().project.clips;
  expect(a?.template?.id).toBe("weekend");
  expect(b?.template?.id).toBe("weekend");
  expect(a?.template).not.toBe(b?.template);
  expect(b?.overlay?.start).toBe(10);
  act(() => undo());
  expect(getState().project.clips.every((c) => !c.template)).toBe(true);
});
it("filters the gallery and gives an empty state", () => {
  render(<Panel />);
  fireEvent.change(screen.getByLabelText("Search templates"), { target: { value: "lifestyle" } });
  expect(screen.getByRole("button", { name: "Select Weekend Journal" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Select Prism Reveal" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Search templates"), { target: { value: "missing" } });
  expect(screen.getByRole("status")).toHaveTextContent("No matching styles");
});
