import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_FRAMING, newProject, type Caption, type Clip } from "@/lib/reelforge/core";
import { importProjectJSON } from "@/lib/reelforge/store";

const run = vi.fn();
vi.mock("@/lib/reelforge/autocaptions", async (orig) => {
  const real = await orig<typeof import("@/lib/reelforge/autocaptions")>();
  return { ...real, runAutoCaptions: (o: unknown) => run(o) };
});
const { AutoCaptions } = await import("./AutoCaptions");

const clip: Clip = { id: "c", title: "Short", start: 4, end: 14, framing: DEFAULT_FRAMING };

async function load(duration: number, captions: Caption[] = []) {
  const project = {
    ...newProject(),
    source: {
      name: "t.mp4",
      size: 1,
      type: "video/mp4",
      lastModified: 0,
      duration,
      width: 640,
      height: 360,
    },
    clips: [clip],
    captions,
  };
  await importProjectJSON({ text: async () => JSON.stringify(project) } as File);
}

beforeEach(() => {
  run.mockReset();
  localStorage.clear();
});
afterEach(cleanup);

it("transcribes the selected clip's range by default with the chosen settings", async () => {
  await load(60);
  render(<AutoCaptions clip={clip} />);
  fireEvent.change(screen.getByLabelText("Spoken language"), { target: { value: "en" } });
  fireEvent.change(screen.getByLabelText("Caption length"), { target: { value: "punchy" } });
  fireEvent.click(screen.getByRole("button", { name: /Generate captions/ }));
  expect(run).toHaveBeenCalledWith({
    start: 4,
    end: 14,
    model: "accurate",
    language: "en",
    preset: "punchy",
    replace: false,
  });
  expect(screen.getByText(/never uploaded/)).toBeTruthy();
});

it("offers to replace existing captions in the range, on by default", async () => {
  await load(60, [{ id: "a", start: 5, end: 6, text: "old" }]);
  render(<AutoCaptions clip={clip} />);
  const box = screen.getByLabelText(/Replace the 1 existing caption/) as HTMLInputElement;
  expect(box.checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Generate captions/ }));
  expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }));
  fireEvent.click(box);
  fireEvent.click(screen.getByRole("button", { name: /Generate captions/ }));
  expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ replace: false }));
});

it("blocks whole-video runs over 60 minutes", async () => {
  await load(2 * 3600);
  render(<AutoCaptions clip={clip} />);
  fireEvent.change(screen.getByLabelText("Transcription range"), { target: { value: "source" } });
  expect(
    (screen.getByRole("button", { name: /Generate captions/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/over 60 minutes/)).toBeTruthy();
});
