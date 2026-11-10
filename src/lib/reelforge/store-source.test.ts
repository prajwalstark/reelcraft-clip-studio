import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_FRAMING, newProject } from "./core";

const vault = {
  saveMedia: vi.fn(async () => ({ ok: true as const })),
  loadMedia: vi.fn(async () => null as File | null),
  forgetMedia: vi.fn(async () => {}),
  pruneMedia: vi.fn(async () => {}),
  setRememberMedia: vi.fn(),
};
vi.mock("@/lib/media-vault", () => vault);
const store = await import("./store");

const source = {
  name: "talk.mp4",
  size: 1234,
  type: "video/mp4",
  lastModified: 99,
  duration: 60,
  width: 1920,
  height: 1080,
};

async function withProject() {
  const p = {
    ...newProject(),
    source,
    clips: [{ id: "a", title: "A", start: 0, end: 30, framing: DEFAULT_FRAMING }],
    captions: [{ id: "c", start: 1, end: 2, text: "hi" }],
    captionStyle: { ...newProject().captionStyle, animation: "pop" as const, color: "#ff0000" },
    exportSettings: { resolution: 2160 as const, fps: 24 as const },
  };
  await store.importProjectJSON({ text: async () => JSON.stringify(p) } as File);
}

beforeEach(() => {
  Object.values(vault).forEach((f) => f.mockClear());
  store.setRt({ file: null, url: null, restoring: false, keep: { status: "idle" } });
});

it("Remove video clears its clips, captions and stored copy but keeps preferences", async () => {
  await withProject();
  store.removeSource();
  const p = store.getState().project;
  expect(p.source).toBeNull();
  expect(p.clips).toEqual([]);
  expect(p.captions).toEqual([]);
  expect(p.captionStyle).toMatchObject({ animation: "pop", color: "#ff0000" });
  expect(p.exportSettings).toEqual({ resolution: 2160, fps: 24 });
  expect(vault.forgetMedia).toHaveBeenCalledWith("shorts:source");
  expect(store.getState().rt.keep.status).toBe("idle");
});

it("after a refresh, asks browser storage for exactly the saved source", async () => {
  await withProject();
  vault.loadMedia.mockClear();
  const pending = store.restoreSource();
  expect(store.getState().rt.restoring).toBe(true);
  await pending;
  expect(vault.loadMedia).toHaveBeenCalledWith(
    "shorts:source",
    expect.objectContaining({ name: "talk.mp4", size: 1234, lastModified: 99 }),
  );
  // Nothing stored → the relink screen stays available; work is untouched.
  expect(store.getState().rt.restoring).toBe(false);
  expect(store.sourceMissing()).toBe(true);
  expect(store.getState().project.clips).toHaveLength(1);
});

it("does nothing when there's no saved source or a video is already loaded", async () => {
  store.removeSource();
  await store.restoreSource();
  expect(vault.loadMedia).not.toHaveBeenCalled();
});

it("turning 'remember' off deletes every kept copy", () => {
  store.setKeepMedia(false);
  expect(vault.setRememberMedia).toHaveBeenCalledWith(false);
  expect(vault.pruneMedia).toHaveBeenCalledWith("", new Set());
  expect(store.getState().rt.keep.status).toBe("off");
});

it("New project also deletes the kept copy", async () => {
  await withProject();
  store.newProjectAction();
  expect(vault.forgetMedia).toHaveBeenCalledWith("shorts:source");
});
