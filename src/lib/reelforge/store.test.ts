import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_FRAMING, newProject } from "./core";
import { enqueue, getState, importProjectJSON, setRt, updateClip } from "./store";
import { exportClip, type ExportResult } from "./exporter";

vi.mock("./exporter", () => ({ exportClip: vi.fn(), downloadBlob: vi.fn() }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("renders each queued job from its captured clip, settings and source File", async () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn(() => "blob:test"),
    revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  const c = { id: "a", title: "A", start: 0, end: 4, framing: DEFAULT_FRAMING, speed: 2 };
  const p = {
    ...newProject(),
    source: {
      name: "first.mp4",
      size: 100,
      type: "video/mp4",
      lastModified: 0,
      duration: 10,
      width: 640,
      height: 360,
    },
    clips: [c, { ...c, id: "b", title: "B" }],
  };
  await importProjectJSON({ text: async () => JSON.stringify(p) } as File);
  const firstFile = new File(["first"], "first.mp4");
  setRt({ file: firstFile, jobs: [] });
  let finish!: (result: ExportResult) => void;
  const result: ExportResult = {
    blob: new Blob(["video"]),
    width: 1080,
    height: 1920,
    duration: 2,
    format: { mime: "video/webm", ext: "webm", label: "WebM" },
  };
  vi.mocked(exportClip)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(result);
  enqueue(["a", "b"]);
  expect(exportClip).toHaveBeenCalledTimes(1);
  updateClip("b", { speed: 0.5, title: "Changed" });
  setRt({ file: new File(["second"], "second.mp4") });
  finish(result);
  await vi.advanceTimersByTimeAsync(0);
  expect(exportClip).toHaveBeenCalledTimes(2);
  expect(vi.mocked(exportClip).mock.calls[1]![0].clip).toMatchObject({ title: "B", speed: 2 });
  expect(createObjectURL.mock.calls).toEqual([[firstFile], [firstFile]]);
  expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(getState().rt.jobs.map((j) => j.status)).toEqual(["done", "done"]);
});
