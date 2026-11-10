// @vitest-environment node
// Node's File/Blob survive IndexedDB structured cloning (jsdom's don't), like real browsers.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetVaultForTests,
  forgetMedia,
  loadMedia,
  pruneMedia,
  saveMedia,
  setRememberMedia,
  storedBytes,
} from "./media-vault";

const file = (name: string, body = "video-bytes", lastModified = 1000) =>
  new File([body], name, { type: "video/mp4", lastModified });

const memory = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
};

beforeEach(async () => {
  memory.clear();
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", fakeLocalStorage);
  await _resetVaultForTests();
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase("reelcraft-media");
    req.onsuccess = req.onerror = req.onblocked = r;
  });
});

describe("media vault", () => {
  it("keeps a file and returns it with its name, size, type and date", async () => {
    expect(await saveMedia("shorts:source", file("a.mp4"))).toEqual({ ok: true });
    const back = await loadMedia("shorts:source");
    expect(back).toBeInstanceOf(File);
    expect([back!.name, back!.size, back!.type, back!.lastModified]).toEqual([
      "a.mp4",
      11,
      "video/mp4",
      1000,
    ]);
    expect(await back!.text()).toBe("video-bytes");
  });

  it("only restores the file the project expects", async () => {
    await saveMedia("k", file("a.mp4"));
    expect(await loadMedia("k", { name: "a.mp4", size: 11, lastModified: 1000 })).not.toBeNull();
    expect(await loadMedia("k", { name: "a.mp4", size: 11, lastModified: 2000 })).toBeNull();
    expect(await loadMedia("k", { name: "b.mp4", size: 11, lastModified: 1000 })).toBeNull();
  });

  it("replaces, forgets and prunes", async () => {
    await saveMedia("seq:1", file("one.mp4"));
    await saveMedia("seq:2", file("two.mp4", "longer-video-bytes"));
    await saveMedia("seq:1", file("uno.mp4"));
    expect((await loadMedia("seq:1"))!.name).toBe("uno.mp4");
    expect(await storedBytes("seq:")).toBe(11 + 18);
    await pruneMedia("seq:", new Set(["seq:2"]));
    expect(await loadMedia("seq:1")).toBeNull();
    expect(await loadMedia("seq:2")).not.toBeNull();
    await forgetMedia("seq:2");
    expect(await storedBytes()).toBe(0);
  });

  it("respects the off switch", async () => {
    setRememberMedia(false);
    expect(await saveMedia("k", file("a.mp4"))).toMatchObject({ ok: false, reason: "off" });
    expect(await loadMedia("k")).toBeNull();
  });

  it("refuses files larger than the browser lets the site store", async () => {
    vi.stubGlobal("navigator", { storage: { estimate: async () => ({ quota: 100, usage: 95 }) } });
    const r = await saveMedia("k", file("big.mp4", "x".repeat(50)));
    expect(r).toMatchObject({ ok: false, reason: "quota" });
    expect(r.ok ? "" : r.message).toMatch(/more than this browser lets the site store/);
  });
});
