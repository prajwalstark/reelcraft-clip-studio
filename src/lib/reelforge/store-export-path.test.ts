import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_FRAMING, newProject } from "./core";
import type { ExportResult } from "./exporter";

const exportClip = vi.fn();
const exportClipFast = vi.fn();
const supported = vi.fn(() => true);
vi.mock("./exporter", () => ({ exportClip: (o: unknown) => exportClip(o), downloadBlob: vi.fn() }));
vi.mock("./fast-export", () => {
  class FastExportUnavailable extends Error {}
  return {
    FastExportUnavailable,
    fastExportSupported: () => supported(),
    exportClipFast: (o: unknown) => exportClipFast(o),
  };
});
const store = await import("./store");
const { FastExportUnavailable } = await import("./fast-export");

const result: ExportResult = {
  blob: new Blob(["video"]),
  width: 2160,
  height: 3840,
  duration: 4,
  format: { mime: "video/mp4", ext: "mp4", label: "MP4 (H.264 + AAC)" },
};

async function setup(resolution: 720 | 1080 | 2160) {
  vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() });
  const p = {
    ...newProject(),
    source: {
      name: "s.mp4",
      size: 1,
      type: "video/mp4",
      lastModified: 0,
      duration: 10,
      width: 1920,
      height: 1080,
    },
    clips: [{ id: "a", title: "A", start: 0, end: 4, framing: DEFAULT_FRAMING }],
    exportSettings: { resolution, fps: 30 },
  };
  await store.importProjectJSON({ text: async () => JSON.stringify(p) } as File);
  store.setRt({ file: new File(["x"], "s.mp4"), jobs: [] });
}
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  exportClip.mockReset().mockResolvedValue(result);
  exportClipFast.mockReset().mockResolvedValue(result);
  supported.mockReset().mockReturnValue(true);
});
afterEach(() => vi.unstubAllGlobals());

it("uses the fast WebCodecs exporter with the source File and 4K settings", async () => {
  await setup(2160);
  store.enqueue(["a"]);
  await settle();
  expect(exportClipFast).toHaveBeenCalledTimes(1);
  expect(exportClipFast.mock.calls[0]![0]).toMatchObject({
    settings: { resolution: 2160, fps: 30 },
  });
  expect(exportClipFast.mock.calls[0]![0].file).toBeInstanceOf(File);
  expect(exportClip).not.toHaveBeenCalled();
  const job = store.getState().rt.jobs[0]!;
  expect(job).toMatchObject({ status: "done", path: "fast" });
});

it("falls back to real-time capture when WebCodecs can't handle a ≤1080p job", async () => {
  await setup(1080);
  exportClipFast.mockRejectedValueOnce(new FastExportUnavailable("no decoder"));
  store.enqueue(["a"]);
  await settle();
  expect(exportClip).toHaveBeenCalledTimes(1);
  expect(store.getState().rt.jobs[0]).toMatchObject({ status: "done", path: "realtime" });
});

it("never silently downgrades 4K: no real-time fallback", async () => {
  await setup(2160);
  exportClipFast.mockRejectedValueOnce(new FastExportUnavailable("no 4K encoder"));
  store.enqueue(["a"]);
  await settle();
  expect(exportClip).not.toHaveBeenCalled();
  expect(store.getState().rt.jobs[0]).toMatchObject({ status: "error", error: "no 4K encoder" });

  supported.mockReturnValue(false);
  store.setRt({ jobs: [] });
  store.enqueue(["a"]);
  await settle();
  expect(exportClip).not.toHaveBeenCalled();
  expect(store.getState().rt.jobs[0]!.error).toMatch(/4K export needs WebCodecs/);
});

it("surfaces real fast-path failures instead of retrying in real time", async () => {
  await setup(1080);
  exportClipFast.mockRejectedValueOnce(new Error("The source has no video track."));
  store.enqueue(["a"]);
  await settle();
  expect(exportClip).not.toHaveBeenCalled();
  expect(store.getState().rt.jobs[0]).toMatchObject({
    status: "error",
    error: "The source has no video track.",
  });
});
