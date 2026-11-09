import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  video: vi.fn(async () => true),
  audio: vi.fn(async () => true),
  add: vi.fn(async () => {}),
  sound: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  finalize: vi.fn(async () => {}),
}));
vi.mock("mediabunny", async (importOriginal) => {
  const original = await importOriginal<typeof import("mediabunny")>();
  return {
    ...original,
    canEncodeVideo: mocks.video,
    canEncodeAudio: mocks.audio,
    BufferTarget: class {
      buffer = new ArrayBuffer(8);
    },
    CanvasSource: class {
      add = mocks.add;
      close = vi.fn();
    },
    AudioBufferSource: class {
      add = mocks.sound;
      close = vi.fn();
    },
    Output: class {
      state = "pending";
      addVideoTrack = vi.fn();
      addAudioTrack = vi.fn();
      async start() {
        this.state = "started";
      }
      async finalize() {
        await mocks.finalize();
        this.state = "finalized";
      }
      async cancel() {
        await mocks.cancel();
        this.state = "canceled";
      }
    },
  };
});
import { exportSequence, MediaSession } from "./media";
import { fresh, addItem, patchItem } from "./model";
function fixture() {
  let s = fresh();
  s.fps = 24;
  s.assets = [
    {
      id: "a",
      name: "a.mp4",
      kind: "video",
      size: 1,
      lastModified: 0,
      duration: 1,
      origin: 0,
      width: 16,
      height: 9,
      hasAudio: false,
      peaks: [],
    },
  ];
  s = addItem(s, "a", "V1", 0);
  s = patchItem(s, s.items[0]!.id, { frames: 3 });
  return s;
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.video.mockResolvedValue(true);
  mocks.audio.mockResolvedValue(true);
  mocks.add.mockResolvedValue();
  vi.spyOn(MediaSession.prototype, "audio").mockResolvedValue(null);
  vi.spyOn(MediaSession.prototype, "draw").mockResolvedValue();
});
describe("sequence export contract", () => {
  it("encodes every frame at exact timestamps without recording playback", async () => {
    const s = fixture();
    const result = await exportSequence(
      s,
      new Map([["a", new File(["x"], "a.mp4")]]),
      720,
      new AbortController().signal,
      () => {},
    );
    expect(mocks.add.mock.calls).toEqual([
      [0, 1 / 24],
      [1 / 24, 1 / 24],
      [2 / 24, 1 / 24],
    ]);
    expect(result.extension).toBe("mp4");
    expect(result.blob.type).toBe("video/mp4");
    expect(mocks.finalize).toHaveBeenCalledOnce();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("uses a correctly named WebM when MP4 video encoding is unavailable", async () => {
    mocks.video.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const r = await exportSequence(
      fixture(),
      new Map([["a", new File(["x"], "a.mp4")]]),
      720,
      new AbortController().signal,
      () => {},
    );
    expect(r.extension).toBe("webm");
    expect(r.blob.type).toBe("video/webm");
  });
  it("cancels the muxer and does not finalize after abort", async () => {
    const c = new AbortController();
    mocks.add.mockImplementationOnce(async () => {
      c.abort();
    });
    await expect(
      exportSequence(
        fixture(),
        new Map([["a", new File(["x"], "a.mp4")]]),
        720,
        c.signal,
        () => {},
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.finalize).not.toHaveBeenCalled();
  });
  it("fails before encoding when media is missing or audio decoding fails", async () => {
    await expect(
      exportSequence(fixture(), new Map(), 720, new AbortController().signal, () => {}),
    ).rejects.toThrow("Relink");
    vi.mocked(MediaSession.prototype.audio).mockRejectedValue(new Error("Cannot decode audio"));
    await expect(
      exportSequence(
        fixture(),
        new Map([["a", new File(["x"], "a.mp4")]]),
        720,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Cannot decode audio");
    expect(mocks.add).not.toHaveBeenCalled();
  });
});
