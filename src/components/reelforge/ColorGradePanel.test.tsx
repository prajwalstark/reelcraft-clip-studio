import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DEFAULT_FRAMING, newProject } from "@/lib/reelforge/core";
import { activeClip, getState, importProjectJSON, undo, useStore } from "@/lib/reelforge/store";
import { ColorGradePanel } from "./ColorGradePanel";

function Panel() {
  const c = useStore((s) => activeClip(s))!;
  return <ColorGradePanel clip={c} />;
}
const clip = () => activeClip(getState());

beforeEach(async () => {
  const p = {
    ...newProject(),
    source: {
      name: "s.mp4",
      size: 1,
      type: "video/mp4",
      lastModified: 0,
      duration: 10,
      width: 640,
      height: 360,
    },
    clips: [
      { id: "a", title: "A", start: 0, end: 5, framing: DEFAULT_FRAMING },
      { id: "b", title: "B", start: 5, end: 10, framing: DEFAULT_FRAMING },
    ],
  };
  await importProjectJSON({ text: async () => JSON.stringify(p) } as File);
});
afterEach(cleanup);

it("edits primaries, applies to all clips, undoes and resets back to no grade", () => {
  render(<Panel />);
  const grade = () => getState().project.clips.map((c) => c.colorGrade);
  fireEvent.change(screen.getByRole("slider", { name: "Saturation" }), {
    target: { value: "1.4" },
  });
  expect(clip()!.colorGrade).toMatchObject({ saturation: 1.4 });
  // keyboard nudges the Gain puck toward red (right)
  fireEvent.keyDown(screen.getByRole("slider", { name: "Gain colour" }), { key: "ArrowRight" });
  expect(clip()!.colorGrade!.gain.x).toBeCloseTo(0.02);
  fireEvent.click(screen.getByRole("button", { name: "Apply to all" }));
  expect(grade()[1]).toMatchObject({ saturation: 1.4 });
  undo();
  expect(grade()[1]).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: /^Reset$/ }));
  expect(clip()!.colorGrade).toBeUndefined();
});

it("returning every control to neutral stores no grade at all", () => {
  render(<Panel />);
  const sat = screen.getByRole("slider", { name: "Saturation" });
  fireEvent.change(sat, { target: { value: "1.2" } });
  expect(clip()!.colorGrade).toBeDefined();
  fireEvent.change(sat, { target: { value: "1" } });
  expect(clip()!.colorGrade).toBeUndefined();
});

it("switches curve tabs and channels", () => {
  render(<Panel />);
  fireEvent.click(screen.getByRole("radio", { name: "r" }));
  expect(screen.getByRole("group", { name: /^r curve/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Hue vs Sat" }));
  expect(screen.getByRole("group", { name: /^hueSat curve/ })).toBeTruthy();
  expect(screen.getByText(/Raise a hue to saturate it/)).toBeTruthy();
});
