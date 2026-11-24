import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addItem, fresh, type Sequence } from "@/lib/sequence/model";

const run = vi.fn();
vi.mock("@/lib/sequence/autocaptions", async (orig) => {
  const real = await orig<typeof import("@/lib/sequence/autocaptions")>();
  return { ...real, runSequenceCaptions: (...a: unknown[]) => run(...a) };
});
const { AutoCaptionPanel } = await import("./AutoCaptionPanel");

function seq(): Sequence {
  let s = fresh();
  s.assets = [
    {
      id: "talk",
      name: "talk.mp4",
      kind: "video",
      size: 1,
      lastModified: 1,
      duration: 20,
      origin: 0,
      width: 1920,
      height: 1080,
      hasAudio: true,
      peaks: [],
    },
  ];
  s = addItem(s, "talk", "V1", 0);
  return addItem(s, "talk", "V1", 600);
}
const mount = (s: Sequence, clip = s.items[1]) =>
  render(
    <AutoCaptionPanel
      sequence={s}
      files={new Map()}
      clip={clip}
      getSequence={() => s}
      apply={() => {}}
      onClose={() => {}}
    />,
  );

beforeEach(() => {
  run.mockReset();
  localStorage.clear();
});
afterEach(cleanup);

it("captions the whole sequence on V3 by default, word by word", () => {
  mount(seq());
  fireEvent.click(screen.getByRole("button", { name: "Generate captions" }));
  expect(run.mock.calls[0]![2]).toMatchObject({
    start: 0,
    end: 1200,
    track: "V3",
    reveal: "words",
    look: "subtitle",
    preset: "standard",
    replace: true,
  });
});

it("can caption just the selected clip, with other choices remembered", () => {
  mount(seq());
  fireEvent.change(screen.getByLabelText("Range"), { target: { value: "clip" } });
  fireEvent.change(screen.getByLabelText("Put captions on"), { target: { value: "V2" } });
  fireEvent.change(screen.getByLabelText("Look"), { target: { value: "boxed" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate captions" }));
  expect(run.mock.calls[0]![2]).toMatchObject({
    start: 600,
    end: 1200,
    track: "V2",
    look: "boxed",
  });
  expect(localStorage.getItem("reelcraft.seq-autocap.track")).toBe("V2");
});

it("explains a locked track and needs something with sound", () => {
  const s = seq();
  s.tracks = s.tracks.map((t) => (t.id === "V3" ? { ...t, locked: true } : t));
  mount(s);
  expect(screen.getByRole("alert").textContent).toMatch(/V3 is locked/);
  expect(screen.getByRole("button", { name: "Generate captions" })).toHaveProperty(
    "disabled",
    true,
  );
  cleanup();
  const silent = fresh();
  mount(silent, undefined);
  expect(screen.getByText("Add a clip with sound to caption it.")).toBeTruthy();
});
